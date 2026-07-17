// Multi-resize smoke coverage (#52): >1 selected layers scale UNIFORMLY via
// the combined bbox's corner handles. Real trusted input only (page.mouse) —
// synthetic dispatchEvent PointerEvents are unreliable against React's event
// delegation. State is asserted through the window.__zpdTest bridge (getDoc),
// never by pixel-probing the canvas.
import { expect, test, type Page } from '@playwright/test';
import type { ShapeLayer } from '@zpd/core';
import { bridge, MOD, openEditor, toScreenPoint } from './helpers';

// demo-doc.ts geometry: demo-rect (8,14) 24×16, demo-ellipse (30,40) 22×22.
// Their combined bbox is x 8..52 / y 14..62 → se corner (52,62), nw anchor
// (8,14), diagonal v0 = (44,48).
const RECT = { x: 8, y: 14, width: 24, height: 16 };
const ELLIPSE = { x: 30, y: 40, width: 22, height: 22 };
const CORNER = { x: 52, y: 62 };
const ANCHOR = { x: 8, y: 14 };

async function shapeById(page: Page, id: string): Promise<ShapeLayer> {
  const doc = await bridge(page).getDoc();
  return doc.layers.find((l) => l.id === id) as ShapeLayer;
}

// Select demo-rect, Shift-click demo-ellipse into the selection, then drag the
// combined bbox's se corner handle by 0.25·v0 — the diagonal projection the
// tool uses makes that a uniform factor of 1.25 about the nw anchor.
async function selectBothAndDragSeCorner(page: Page): Promise<void> {
  const rectCenter = await toScreenPoint(page, { x: 20, y: 22 });
  await page.mouse.click(rectCenter.x, rectCenter.y);
  const ellipseCenter = await toScreenPoint(page, { x: 41, y: 51 });
  await page.keyboard.down('Shift');
  await page.mouse.click(ellipseCenter.x, ellipseCenter.y);
  await page.keyboard.up('Shift');
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'demo-ellipse']);

  const start = await toScreenPoint(page, CORNER);
  const end = await toScreenPoint(page, {
    x: CORNER.x + (CORNER.x - ANCHOR.x) * 0.25,
    y: CORNER.y + (CORNER.y - ANCHOR.y) * 0.25,
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
}

test('@smoke multi-resize: corner drag scales BOTH layers proportionally via getDoc()', async ({
  page,
}) => {
  await openEditor(page);
  await selectBothAndDragSeCorner(page);

  const rect = await shapeById(page, 'demo-rect');
  const ellipse = await shapeById(page, 'demo-ellipse');

  // ONE uniform factor drives every dimension of every member: derive it from
  // the rect's width, then require the other three dims to match it — this is
  // the "both layers' dims changed proportionally" acceptance check, robust
  // to sub-px pointer rounding.
  const f = rect.width / RECT.width;
  expect(f).toBeGreaterThan(1.2);
  expect(f).toBeLessThan(1.3);
  expect(rect.height / RECT.height).toBeCloseTo(f, 3);
  expect(ellipse.width / ELLIPSE.width).toBeCloseTo(f, 3);
  expect(ellipse.height / ELLIPSE.height).toBeCloseTo(f, 3);

  // scale is about the OPPOSITE (nw) corner: the rect touches the anchor so
  // it grows in place, and the ellipse's offset scales by the same factor
  expect(rect.x).toBeCloseTo(RECT.x, 3);
  expect(rect.y).toBeCloseTo(RECT.y, 3);
  expect(ellipse.x).toBeCloseTo(ANCHOR.x + (ELLIPSE.x - ANCHOR.x) * f, 3);
  expect(ellipse.y).toBeCloseTo(ANCHOR.y + (ELLIPSE.y - ANCHOR.y) * f, 3);

  // the whole gesture is ONE undo entry: a single undo restores BOTH layers
  await page.keyboard.press(`${MOD}+z`);
  expect(await shapeById(page, 'demo-rect')).toMatchObject(RECT);
  expect(await shapeById(page, 'demo-ellipse')).toMatchObject(ELLIPSE);
});
