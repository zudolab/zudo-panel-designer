// Focused fixed-material integration flow (#169). All document observation is
// through the read-only bridge; state changes below are ordinary clicks,
// keyboard input, and browser drag events.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bridge, dragLayerRowAfter, importPanelJson, MOD, openEditor } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUFACTURING_FIXTURE = path.join(__dirname, 'fixtures', 'preview-manufacturing.json');

async function importFixture(page: Parameters<typeof openEditor>[0]): Promise<void> {
  await importPanelJson(page, MANUFACTURING_FIXTURE);
  await expect.poll(() => bridge(page).getLayerCount()).toBe(11);
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
  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();
  expect(await bridge(page).getMaterialLayer(rectId!)).toMatchObject({
    material: 'copper',
    color: 1,
  });
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
