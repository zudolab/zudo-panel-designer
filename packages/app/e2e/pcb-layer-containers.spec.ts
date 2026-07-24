// Focused fixed-material integration flow (#169). All document observation is
// through the read-only bridge; state changes below are ordinary clicks,
// keyboard input, and browser drag events.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  bridge,
  dragLayerRowAfter,
  importPanelJson,
  MOD,
  openEditor,
  toScreenPoint,
} from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUFACTURING_FIXTURE = path.join(__dirname, 'fixtures', 'preview-manufacturing.json');

async function importFixture(page: Parameters<typeof openEditor>[0]): Promise<void> {
  await importPanelJson(page, MANUFACTURING_FIXTURE);
  await expect.poll(() => bridge(page).getLayerCount()).toBe(11);
}

// Off-panel (the fixture's 40.3x128.5mm panel) and clear of every fixture
// shape, including 'fully-off-panel' (x:-8..-1) -- a plain click here always
// lands on empty canvas space, which select.tsx's pointerDown clears the
// selection for (see editor/tools/select.tsx's "Empty space" branch).
async function deselectAll(page: Parameters<typeof openEditor>[0]): Promise<void> {
  const pt = await toScreenPoint(page, { x: -20, y: 60 });
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(() => bridge(page).getSelectedIds()).toEqual([]);
}

test('@smoke fixed PCB containers preserve material, persistence, and physical order', async ({
  page,
}) => {
  await openEditor(page);
  await importFixture(page);

  // The persisted physical order is bottom-to-top; the UI reverses it for a
  // topmost-first Layers panel. Fixed headers offer visibility/collapse only.
  expect((await bridge(page).getPcbLayerStack()).map((root) => root.role)).toEqual([
    'copper',
    'solder-mask',
    'silkscreen',
  ]);
  const materialSections = page.locator('[data-material-role]');
  await expect(materialSections).toHaveCount(3);
  await expect(
    materialSections.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-material-role'))),
  ).resolves.toEqual(['silkscreen', 'solder-mask', 'copper']);
  for (const role of ['copper', 'solder-mask', 'silkscreen']) {
    const root = page.locator(`[data-material-role="${role}"]`);
    const header = root.locator(':scope > div');
    await expect(header).not.toHaveAttribute('draggable');
    await expect(header.getByTitle('Delete')).toHaveCount(0);
    await expect(header.getByTitle('Ungroup')).toHaveCount(0);
    await expect(header.getByTitle('Bring forward')).toHaveCount(0);
  }

  const historyBeforeCollapse = await bridge(page).getHistory();
  await page.getByRole('button', { name: 'Collapse Copper' }).click();
  await expect(page.getByRole('button', { name: 'Expand Copper' })).toBeVisible();
  expect(await bridge(page).getHistory()).toEqual(historyBeforeCollapse); // session only
  await page.getByRole('button', { name: 'Expand Copper' }).click();

  await page.getByRole('button', { name: 'Hide Solder mask' }).click();
  await expect.poll(async () => (await bridge(page).getPcbLayerStack())[1]?.hidden).toBe(true);
  expect((await bridge(page).serialize()).layers[1]?.hidden).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await bridge(page).getPcbLayerStack())[1]?.hidden).toBe(false);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(async () => (await bridge(page).getPcbLayerStack())[1]?.hidden).toBe(true);

  // Default creations route by tool kind, regardless of their legacy palette
  // value. The fixture itself supplies a deterministic stale-color proof.
  // Explicit deselect precondition (#191): with a selection-relative
  // insertion policy now live, this default-routing assertion only holds
  // with nothing selected -- nothing here has selected a layer yet, but the
  // precondition is made explicit rather than relying on that incidentally.
  await deselectAll(page);
  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();
  expect(await bridge(page).getMaterialLayer(rectId!)).toMatchObject({
    material: 'copper',
    color: 1,
  });
  // Add-rectangle selects the rect it just created (#191) -- deselect again
  // before the text tool so its own default routing is exercised too,
  // rather than anchoring above the still-selected copper rect.
  await deselectAll(page);
  await page.keyboard.press('t');
  await page.mouse.click(300, 300);
  const textId = await bridge(page).getSelectedId();
  expect(await bridge(page).getMaterialLayer(textId!)).toMatchObject({
    material: 'silkscreen',
    color: 2,
  });
  expect(await bridge(page).getMaterialLayer('gold-base')).toMatchObject({
    material: 'copper',
    color: 1,
  });
  expect(await bridge(page).getMaterialLayer('opening-over-gold')).toMatchObject({
    material: 'solder-mask',
    color: 0,
  });
  expect(await bridge(page).getMaterialLayer('white-over-black')).toMatchObject({
    material: 'silkscreen',
    color: 2,
  });

  // Real HTML5 DnD moves ordinary artwork across roots. Membership changes
  // immediately, then undo/redo restores both material and placement.
  await dragLayerRowAfter(page, 'Gold base', 'White over black');
  await expect
    .poll(async () => (await bridge(page).getMaterialLayer('gold-base'))?.material)
    .toBe('silkscreen');
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => (await bridge(page).getMaterialLayer('gold-base'))?.material)
    .toBe('copper');
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(async () => (await bridge(page).getMaterialLayer('gold-base'))?.material)
    .toBe('silkscreen');

  // The v5 export is the canonical stack and survives autosave reload.
  expect((await bridge(page).serialize()).version).toBe(5);
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__zpdTest !== undefined);
  expect((await bridge(page).serialize()).version).toBe(5);
  expect((await bridge(page).getPcbLayerStack()).map((root) => root.role)).toEqual([
    'copper',
    'solder-mask',
    'silkscreen',
  ]);
  expect((await bridge(page).getMaterialLayer('gold-base'))?.material).toBe('silkscreen');
});

test('@smoke selection-relative insertion places new objects directly above the selection (#191)', async ({
  page,
}) => {
  await openEditor(page);
  await importFixture(page);

  // A Solder-mask object selected -> Add rectangle lands directly above it,
  // INSIDE Solder mask -- not always Copper (the tool's own default role).
  await page.getByRole('button', { name: 'Select layer Opening over gold' }).click();
  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();
  let solderMask = (await bridge(page).getPcbLayerStack()).find((c) => c.role === 'solder-mask')!;
  expect(solderMask.children.map((n) => n.id)).toEqual(['opening-over-gold', rectId, 'mask-opening']);
  expect(await bridge(page).getMaterialLayer(rectId!)).toMatchObject({
    material: 'solder-mask',
    color: 0,
  });

  // A multi-selection spanning Copper + Silkscreen anchors to the visually
  // topmost maximal root: Silkscreen sits above Copper in stack/paint order,
  // so the new ellipse lands in Silkscreen, not Copper, and Copper is
  // untouched by this insertion.
  //
  // MOD (not Shift): the layer list's Shift-click is a tree-aware RANGE
  // select across all VISIBLE rows between the anchor and the click
  // (selection.ts's nextListSelection) -- with Solder mask's rows sitting
  // between Copper's and Silkscreen's in the (reversed, topmost-first) list,
  // a Shift-range here would sweep in every row in between, not just these
  // two. MOD+click is the additive per-row toggle (toggleLeafSelection).
  await page.getByRole('button', { name: 'Select layer Gold base' }).click();
  await page
    .getByRole('button', { name: 'Select layer White over black' })
    .click({ modifiers: [MOD] });
  expect(await bridge(page).getSelectedIds()).toEqual(
    expect.arrayContaining(['gold-base', 'white-over-black']),
  );
  const copperBefore = (await bridge(page).getPcbLayerStack()).find((c) => c.role === 'copper')!;

  await page.getByLabel('Add ellipse').click();
  const ellipseId = await bridge(page).getSelectedId();
  expect(ellipseId).not.toBeNull();
  const stackAfterEllipse = await bridge(page).getPcbLayerStack();
  const silkscreen = stackAfterEllipse.find((c) => c.role === 'silkscreen')!;
  expect(silkscreen.children.map((n) => n.id)).toEqual([
    'white-over-black',
    ellipseId,
    'font-ready-text',
  ]);
  const copperAfter = stackAfterEllipse.find((c) => c.role === 'copper')!;
  expect(copperAfter.children.map((n) => n.id)).toEqual(copperBefore.children.map((n) => n.id));

  // Selection cleared -> back to exact pre-#191 default routing (Copper).
  await deselectAll(page);
  await page.getByLabel('Add rectangle').click();
  const defaultRectId = await bridge(page).getSelectedId();
  expect(await bridge(page).getMaterialLayer(defaultRectId!)).toMatchObject({
    material: 'copper',
    color: 1,
  });
  solderMask = (await bridge(page).getPcbLayerStack()).find((c) => c.role === 'solder-mask')!;
  expect(solderMask.children.some((n) => n.id === defaultRectId)).toBe(false);
});
