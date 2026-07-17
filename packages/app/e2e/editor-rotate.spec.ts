// Rotate handle + rotated-shape resize smoke coverage (#51). Real trusted
// input only (page.mouse) — synthetic dispatchEvent PointerEvents are
// unreliable against React's event delegation. State is asserted through the
// window.__zpdTest bridge (getDoc), never by pixel-probing the canvas.
import { expect, test, type Page } from '@playwright/test';
import { resizeRotatedRect, type ShapeLayer } from '@zpd/core';
import { bridge, openEditor, toScreenPoint } from './helpers';

// Must match renderer.ts's ROTATE_HANDLE_OFFSET_PX: the rotate knob floats
// this many SCREEN px beyond the top-edge midpoint, along the rotated "up".
const ROTATE_HANDLE_OFFSET_PX = 20;

// select.tsx's MIN_RESIZE_MM — resizeRotatedRect's clamp during a tool drag.
const MIN_RESIZE_MM = 0.5;

// demo-doc.ts: demo-rect is a shape at (8,14) 24×16 → bbox center (20,22).
const RECT = { x: 8, y: 14, width: 24, height: 16 };
const CENTER = { x: 20, y: 22 };

async function demoRect(page: Page): Promise<ShapeLayer> {
  const doc = await bridge(page).getDoc();
  return doc.layers.find((l) => l.id === 'demo-rect') as ShapeLayer;
}

// Select demo-rect, then Shift-drag its rotate handle to EXACTLY 45°: the
// knob starts ROTATE_HANDLE_OFFSET_PX px above the top-edge midpoint (pointer
// angle −90° from the center), and we release the pointer at −35° — a +55°
// sweep that Shift snaps to +45°, measured from the drag-start rotation (0).
// Snapping makes the resulting rotation exact regardless of px rounding.
async function selectAndRotateTo45(page: Page): Promise<void> {
  const inside = await toScreenPoint(page, { x: 20, y: 22 });
  await page.mouse.click(inside.x, inside.y);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  const topMid = await toScreenPoint(page, { x: RECT.x + RECT.width / 2, y: RECT.y });
  const knob = { x: topMid.x, y: topMid.y - ROTATE_HANDLE_OFFSET_PX };
  const endRad = (-35 * Math.PI) / 180;
  const end = await toScreenPoint(page, {
    x: CENTER.x + 30 * Math.cos(endRad),
    y: CENTER.y + 30 * Math.sin(endRad),
  });

  await page.keyboard.down('Shift');
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test('@smoke rotate handle: Shift-drag sets demo-rect rotation to 45° in getDoc()', async ({
  page,
}) => {
  await openEditor(page);
  await selectAndRotateTo45(page);

  const rect = await demoRect(page);
  expect(rect.rotation).toBe(45);
  // rotation happens about the bbox CENTER — the rect's stored geometry
  // (x/y/width/height) must be untouched by a pure rotate gesture
  expect(rect).toMatchObject(RECT);
});

test('@smoke resize a ROTATED shape: dims follow resizeRotatedRect via getDoc()', async ({
  page,
}) => {
  await openEditor(page);
  await selectAndRotateTo45(page);

  // The se handle now sits at the ROTATED bottom-right corner: raw (32,30) is
  // (+12,+8) from the center, which a 45° cw rotation sends to that offset
  // rotated — compute it rather than hardcoding trig results.
  const rad = (45 * Math.PI) / 180;
  const cornerMm = {
    x: CENTER.x + (12 * Math.cos(rad) - 8 * Math.sin(rad)),
    y: CENTER.y + (12 * Math.sin(rad) + 8 * Math.cos(rad)),
  };
  const camera = await bridge(page).getCamera();
  if (!camera) throw new Error('camera not ready');
  const startFloat = await toScreenPoint(page, cornerMm);
  const endFloat = await toScreenPoint(page, { x: cornerMm.x + 5, y: cornerMm.y + 5 });
  // Round the endpoints to whole px ourselves so the drag delta the app sees
  // is exactly recoverable: dMm below then matches the tool's math instead of
  // depending on how the browser rounds fractional mouse coordinates. The
  // ≤0.71px grab-point shift stays well inside the 8px handle square.
  const start = { x: Math.round(startFloat.x), y: Math.round(startFloat.y) };
  const end = { x: Math.round(endFloat.x), y: Math.round(endFloat.y) };
  const dMm = { x: (end.x - start.x) / camera.pxPerMm, y: (end.y - start.y) / camera.pxPerMm };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  // Oracle: #48's core math with the tool's own clamp — the tool applies the
  // same screen delta through resizeRotatedRect (float hygiene only; no grid
  // snap on rotated rects, see select.tsx).
  const expected = resizeRotatedRect(RECT, 45, 'se', dMm.x, dMm.y, MIN_RESIZE_MM);
  const rect = await demoRect(page);
  expect(rect.rotation).toBe(45); // resize must not disturb the rotation
  expect(rect.x).toBeCloseTo(expected.x, 3);
  expect(rect.y).toBeCloseTo(expected.y, 3);
  expect(rect.width).toBeCloseTo(expected.width, 3);
  expect(rect.height).toBeCloseTo(expected.height, 3);
});
