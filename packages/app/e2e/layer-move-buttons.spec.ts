// Reproduces #192: the layers-panel ▲/▼ buttons must cross material
// containers at a boundary, not silently clamp. New file on purpose — kept
// separate from pcb-layer-containers.spec.ts (sibling #191 owns that file).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { bridge, importPanelJson, MOD, openEditor } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUFACTURING_FIXTURE = path.join(__dirname, 'fixtures', 'preview-manufacturing.json');

async function importFixture(page: Page): Promise<void> {
  await importPanelJson(page, MANUFACTURING_FIXTURE);
  await expect.poll(() => bridge(page).getLayerCount()).toBe(11);
}

// Same row-lookup convention as helpers.ts's dragLayerRowAfter (aria-label
// `Select layer ${name}`), scoped up to the <li> row so the title-scoped
// move buttons resolve to the one row, not every row on the panel.
function moveButton(page: Page, layerName: string, direction: 'up' | 'down'): Locator {
  const title = direction === 'up' ? 'Bring forward' : 'Send backward';
  return page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: `Select layer ${layerName}` }) })
    .getByTitle(title);
}

test('@smoke send-backward walks an object out of Solder mask into Copper’s top, with material flip; a single undo restores it', async ({
  page,
}) => {
  await openEditor(page);
  await importFixture(page);

  // Fixture's solder-mask stack (bottom -> top): [opening-over-gold,
  // mask-opening]. mask-opening starts at the LOCAL top of solder-mask, so
  // reaching Copper takes two ▼ presses: one local reorder, then the
  // boundary cross (#192's own scenario — "press ▼ until it reaches
  // Copper's top").
  expect(await bridge(page).getMaterialLayer('mask-opening')).toMatchObject({
    material: 'solder-mask',
    color: 0,
  });
  const solderMaskBefore = (await bridge(page).getPcbLayerStack()).find(
    (c) => c.role === 'solder-mask',
  )!;
  expect(solderMaskBefore.children.map((n) => n.id)).toEqual(['opening-over-gold', 'mask-opening']);

  const historyBefore = await bridge(page).getHistory();

  // Press 1: local reorder within solder-mask (mask-opening -> index 0).
  await moveButton(page, 'Plain mask opening', 'down').click();
  await expect
    .poll(async () =>
      (await bridge(page).getPcbLayerStack()).find((c) => c.role === 'solder-mask')!.children.map(
        (n) => n.id,
      ),
    )
    .toEqual(['mask-opening', 'opening-over-gold']);
  expect(await bridge(page).getMaterialLayer('mask-opening')).toMatchObject({
    material: 'solder-mask',
    color: 0,
  });

  // Press 2: boundary hit -> crosses into Copper's top (end of its local
  // stack), with the material (and color) flip that crossing intends.
  await moveButton(page, 'Plain mask opening', 'down').click();
  await expect
    .poll(async () => (await bridge(page).getMaterialLayer('mask-opening'))?.material)
    .toBe('copper');
  expect(await bridge(page).getMaterialLayer('mask-opening')).toMatchObject({
    material: 'copper',
    color: 1,
  });
  const stackAfterCross = await bridge(page).getPcbLayerStack();
  expect(stackAfterCross.find((c) => c.role === 'solder-mask')!.children.map((n) => n.id)).toEqual([
    'opening-over-gold',
  ]);
  const copperChildren = stackAfterCross.find((c) => c.role === 'copper')!.children;
  expect(copperChildren[copperChildren.length - 1]?.id).toBe('mask-opening');

  // The whole 2-step walk added exactly two history entries — no phantom
  // entries and no batching across the two distinct commits.
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length + 2);

  // A single undo restores container membership AND material together (the
  // cross was one commit, so one undo fully reverses it).
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => (await bridge(page).getMaterialLayer('mask-opening'))?.material)
    .toBe('solder-mask');
  expect(await bridge(page).getMaterialLayer('mask-opening')).toMatchObject({
    material: 'solder-mask',
    color: 0,
  });
  const stackAfterUndo = await bridge(page).getPcbLayerStack();
  expect(stackAfterUndo.find((c) => c.role === 'solder-mask')!.children.map((n) => n.id)).toEqual([
    'mask-opening',
    'opening-over-gold',
  ]);
});
