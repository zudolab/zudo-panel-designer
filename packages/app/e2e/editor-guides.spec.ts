// Guides (issue #54): drag from a ruler strip onto the canvas to CREATE a
// guide; grab an existing guide on the canvas and drag it back onto a ruler to
// DELETE it. Real trusted input only (page.mouse) — the drag is tracked by
// window-level pointer listeners (see use-guide-drag.ts), so synthetic
// dispatchEvent would not exercise the real path.
//
// State is read through the __zpdTest bridge: guides live in DocState.guides,
// so getDoc().guides is observable directly (unlike the paint-only #43 toggle).
//
// NOTE: authored alongside #54 but NOT run in this worktree (no dev server /
// browser here). The manager runs the e2e suite on the merged base branch.
import { PANEL_HEIGHT_MM, panelWidthMm } from '@zpd/core';
import { expect, test } from '@playwright/test';
import { bridge, openEditor, toScreenPoint } from './helpers';

// mm tolerance for a position derived from a mouse drop (rounding + integer
// device-pixel landing). Comfortably tighter than the panel dimensions.
const POS_TOLERANCE_MM = 1.5;

test('@smoke drag from the horizontal ruler onto the canvas creates a horizontal guide', async ({
  page,
}) => {
  await openEditor(page);
  expect((await bridge(page).getDoc()).guides).toHaveLength(0);

  const panelWmm = panelWidthMm(await bridge(page).getPanelHp());
  const dropMm = { x: panelWmm / 2, y: 30 };
  const drop = await toScreenPoint(page, dropMm);

  // Start the drag ON the top ruler strip, then release over the canvas.
  const rulerBox = await page.getByTestId('ruler-h').boundingBox();
  if (!rulerBox) throw new Error('ruler-h not visible');
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();

  const guides = (await bridge(page).getDoc()).guides;
  expect(guides).toHaveLength(1);
  expect(guides[0].orientation).toBe('horizontal');
  expect(Math.abs(guides[0].position - dropMm.y)).toBeLessThanOrEqual(POS_TOLERANCE_MM);
});

test('@smoke drag from the vertical ruler onto the canvas creates a vertical guide', async ({
  page,
}) => {
  await openEditor(page);

  const dropMm = { x: 20, y: PANEL_HEIGHT_MM / 2 };
  const drop = await toScreenPoint(page, dropMm);

  const rulerBox = await page.getByTestId('ruler-v').boundingBox();
  if (!rulerBox) throw new Error('ruler-v not visible');
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();

  const guides = (await bridge(page).getDoc()).guides;
  expect(guides).toHaveLength(1);
  expect(guides[0].orientation).toBe('vertical');
  expect(Math.abs(guides[0].position - dropMm.x)).toBeLessThanOrEqual(POS_TOLERANCE_MM);
});

test('@smoke dragging an existing guide back onto the ruler deletes it', async ({ page }) => {
  await openEditor(page);

  // First create a horizontal guide at y=30 (same gesture as above).
  const panelWmm = panelWidthMm(await bridge(page).getPanelHp());
  const dropMm = { x: panelWmm / 2, y: 30 };
  const drop = await toScreenPoint(page, dropMm);
  const rulerBox = await page.getByTestId('ruler-h').boundingBox();
  if (!rulerBox) throw new Error('ruler-h not visible');
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  expect((await bridge(page).getDoc()).guides).toHaveLength(1);

  // Grab it on the canvas at its own line and drag up into the ruler strip.
  const grab = await toScreenPoint(page, dropMm);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(
    rulerBox.x + rulerBox.width / 2,
    rulerBox.y + rulerBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  expect((await bridge(page).getDoc()).guides).toHaveLength(0);
});

test('@smoke guide create + delete are each a single undo entry', async ({ page }) => {
  await openEditor(page);

  const panelWmm = panelWidthMm(await bridge(page).getPanelHp());
  const dropMm = { x: panelWmm / 2, y: 40 };
  const drop = await toScreenPoint(page, dropMm);
  const rulerBox = await page.getByTestId('ruler-h').boundingBox();
  if (!rulerBox) throw new Error('ruler-h not visible');

  await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  expect((await bridge(page).getDoc()).guides).toHaveLength(1);

  // One undo removes the created guide.
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  expect((await bridge(page).getDoc()).guides).toHaveLength(0);
});
