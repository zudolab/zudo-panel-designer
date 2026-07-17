// Marquee selection smoke coverage (#47). Real trusted input only
// (page.mouse) — synthetic dispatchEvent PointerEvents are unreliable against
// React's event delegation. State is asserted through the window.__zpdTest
// bridge, never by pixel-probing the canvas.
import { expect, test } from '@playwright/test';
import { bridge, openEditor, toScreenPoint } from './helpers';

async function marqueeDrag(
  page: Parameters<typeof toScreenPoint>[0],
  fromMm: { x: number; y: number },
  toMm: { x: number; y: number },
): Promise<void> {
  const start = await toScreenPoint(page, fromMm);
  const end = await toScreenPoint(page, toMm);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
}

test('@smoke marquee drag selects 2 of 3 layers via getSelectedIds()', async ({ page }) => {
  await openEditor(page);

  // Demo doc geometry (demo-doc.ts): demo-rect spans x 8..32 / y 14..30,
  // demo-ellipse spans x 30..52 / y 40..62, demo-path's bbox starts at y 62.
  // A marquee from (4,10) to (56,58) INTERSECTS rect and ellipse (the ellipse
  // only partially — intersection semantics, not containment) and stops above
  // the path, so exactly 2 of those 3 layers select. The dot-grid pattern
  // layer underneath is panel-wide but must not join the selection.
  await marqueeDrag(page, { x: 4, y: 10 }, { x: 56, y: 58 });

  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'demo-ellipse']);
});

test('@smoke marquee over a panel-wide pattern does NOT select it', async ({ page }) => {
  await openEditor(page);

  // The band y 2..11 is free of every demo layer (the topmost, demo-rect,
  // starts at y 14) but lies fully inside the panel, i.e. fully inside the
  // panel-wide dot-grid pattern layer's bounds. hit-test.ts's invariant says
  // patterns are only selectable via the layer list — the marquee must agree.
  await marqueeDrag(page, { x: 5, y: 2 }, { x: 50, y: 11 });

  expect(await bridge(page).getSelectedIds()).toEqual([]);
});
