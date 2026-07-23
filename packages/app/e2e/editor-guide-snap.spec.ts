// Guide-snapping smoke coverage (#55): the select tool's move gesture snaps a
// dragged layer's bbox edge onto a document guide within catch range — #53's
// layered "grid first, guides win ties" rule, wired into select.tsx's move
// gesture. State is asserted through the window.__zpdTest bridge (read-only —
// see helpers.ts / test-bridge.ts), never by pixel-probing or bridge mutation.
//
// This exercises the REAL end-to-end path now that #54 has landed the ruler
// drag-to-create UI on the base branch: a guide is created by a genuine
// ruler-drag (page.mouse), then a genuine layer drag is asserted to snap onto
// it. Orientation follows #54's actual convention (verified by the passing
// editor-guides.spec.ts): the VERTICAL ruler strip (`ruler-v`) creates a
// VERTICAL guide — an x-position line — which is exactly the axis a rightward
// layer drag needs to snap its right edge against.
//
// Why the assertion proves GUIDE snap and not merely grid snap: #54 rounds a
// dropped guide's position to 0.01mm (guides.ts positionForPoint), while the
// move gesture's grid step is 0.1mm. Dropping the guide at an off-0.1mm x and
// asserting the rect's right edge lands on that value to 0.01mm precision is a
// landing grid-snapping alone cannot produce.
import { PANEL_HEIGHT_MM } from '@zpd/core';
import { expect, test } from '@playwright/test';
import { bridge, openEditor, toScreenPoint } from './helpers';

test('@smoke dragging a layer near a guide snaps its edge onto the guide (#53 + #55)', async ({
  page,
}) => {
  await openEditor(page);
  expect((await bridge(page).getDoc()).guides).toHaveLength(0);

  // Create a VERTICAL guide by dragging from the vertical ruler strip and
  // dropping on the canvas. Target an off-0.1mm x (40.37) a few mm past the
  // demo-rect's right edge (32) so a rightward drag can reach it, and so the
  // landing is distinguishable from a pure 0.1mm grid snap.
  const guideTargetXMm = 40.37;
  const drop = await toScreenPoint(page, { x: guideTargetXMm, y: PANEL_HEIGHT_MM / 2 });
  const rulerBox = await page.getByTestId('ruler-v').boundingBox();
  if (!rulerBox) throw new Error('ruler-v not visible');
  await page.mouse.move(rulerBox.x + rulerBox.width / 2, rulerBox.y + rulerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();

  const guide = (await bridge(page).getDoc()).guides.find((g) => g.orientation === 'vertical');
  expect(guide, 'ruler-v drag should have created a vertical guide').toBeTruthy();
  const guidePos = guide!.position;

  // Drag demo-rect (x 8..32, y 14..30) rightward so its right edge targets the
  // guide. Grab a clearly-interior point (its centre, 20/22 — not a handle),
  // and release where the right edge would land exactly on the guide; the 8px
  // catch radius then locks it precisely onto the guide's coordinate.
  const from = await toScreenPoint(page, { x: 20, y: 22 });
  const to = await toScreenPoint(page, { x: 20 + (guidePos - 32), y: 22 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  const rect = await bridge(page).getMaterialLayer('demo-rect');
  if (rect?.type !== 'shape') throw new Error('demo-rect missing or wrong type');
  // Right edge lands on the guide to 0.01mm — tighter than the 0.1mm grid,
  // so this passes only because the guide caught it.
  expect(rect.x + rect.width).toBeCloseTo(guidePos, 2);
});
