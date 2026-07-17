// "Show content outside the panel" (issue #43): a sidebar "View" toggle,
// default ON, that ghost-paints off-panel layer content at ~35% alpha. Real
// trusted input only (page.mouse / page.keyboard) — synthetic dispatchEvent
// is unreliable against React's event delegation (see editor-core.spec.ts).
// This is a canvas pixel-probe test, not a bridge-state test: the toggle only
// changes what gets PAINTED, not any document state, so window.__zpdTest
// (read-only, doc/camera/selection only) can't observe it — only the pixel
// data can.
import { PANEL_HEIGHT_MM, panelWidthMm } from '@zpd/core';
import { expect, type Page, test } from '@playwright/test';
import type { Camera } from '../src/editor/camera';
import { bridge, openEditor, toScreenPoint } from './helpers';

// Matches renderer.ts's WORKSPACE_BG ('#26282c').
const BACKGROUND_RGB: [number, number, number] = [38, 40, 44];
// Comfortably above canvas anti-aliasing/shadow-blur noise, comfortably below
// the ~60-unit-per-channel delta a real ghosted fill produces (see below).
const COLOR_TOLERANCE = 8;

// Reads a single device pixel from the real canvas element at a page-viewport
// point (the same coordinate space page.mouse and toScreenPoint() use) — not
// a screenshot diff, so it's exact and fast. getBoundingClientRect() +
// devicePixelRatio are read live inside the page to stay correct regardless
// of the canvas's backing-store scale.
async function readCanvasPixel(
  page: Page,
  screenPt: { x: number; y: number },
): Promise<[number, number, number, number]> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('[data-testid="editor-canvas"]') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('editor-canvas not found');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round((x - rect.left) * dpr);
    const py = Math.round((y - rect.top) * dpr);
    const data = ctx.getImageData(px, py, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, screenPt);
}

function expectMatchesBackground(rgba: [number, number, number, number]) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(rgba[i] - BACKGROUND_RGB[i])).toBeLessThanOrEqual(COLOR_TOLERANCE);
  }
}

function expectDiffersFromBackground(rgba: [number, number, number, number]) {
  const differs = BACKGROUND_RGB.some((c, i) => Math.abs(rgba[i] - c) > COLOR_TOLERANCE);
  expect(differs).toBe(true);
}

test('@smoke show-outside-panel toggle ghosts off-panel shapes but never patterns', async ({
  page,
}) => {
  await openEditor(page);

  const panelHp = await bridge(page).getPanelHp();
  const panelWmm = panelWidthMm(panelHp);

  // A gutter point well to the left of the panel, offset in screen space so
  // it clears the panel's drop-shadow blur (renderer.ts: shadowBlur 24) —
  // only the default dot-grid pattern layer's overscan would ever reach
  // here, and pattern layers are excluded from the ghost pass on purpose.
  const camera = (await bridge(page).getCamera()) as Camera | null;
  if (!camera) throw new Error('camera not ready');
  const gutterMm = { x: -32 / camera.pxPerMm, y: PANEL_HEIGHT_MM / 2 };
  const gutterPt = await toScreenPoint(page, gutterMm);

  // The gutter reads background BEFORE any interaction too (default ON) —
  // confirms the pattern-skip rule holds from the very first paint.
  expectMatchesBackground(await readCanvasPixel(page, gutterPt));

  // Add a rect, then drag it fully past the panel's right edge so its whole
  // body is off-panel — a deterministic, easy-to-probe "shape spills off the
  // panel" case (a partial drag would work too; full keeps the probe simple).
  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();
  const rectBefore = (await bridge(page).getDoc()).layers.find((l) => l.id === rectId);
  if (rectBefore?.type !== 'shape') throw new Error('expected a shape layer to be selected');

  const dragStart = await toScreenPoint(page, {
    x: rectBefore.x + rectBefore.width / 2,
    y: rectBefore.y + rectBefore.height / 2,
  });
  const dragEndMmX = panelWmm + rectBefore.width; // guarantees the whole rect clears the panel
  const dragEnd = await toScreenPoint(page, {
    x: dragEndMmX,
    y: rectBefore.y + rectBefore.height / 2,
  });
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
  await page.mouse.up();

  const rectAfter = (await bridge(page).getDoc()).layers.find((l) => l.id === rectId);
  if (rectAfter?.type !== 'shape') throw new Error('rect layer disappeared during drag');
  expect(rectAfter.x).toBeGreaterThan(panelWmm); // sanity: fully off-panel now

  const shapeMm = { x: rectAfter.x + rectAfter.width / 2, y: rectAfter.y + rectAfter.height / 2 };
  const shapePt = await toScreenPoint(page, shapeMm);

  // 1. ON (default): the off-panel shape pixel differs from the workspace
  //    background — it's the rect's gold fill ghosted at ~35% alpha.
  expectDiffersFromBackground(await readCanvasPixel(page, shapePt));

  // Toggle OFF via real trusted input — the checkbox is the only sidebar
  // control under this label (CollapsibleSection "View").
  await page.getByLabel('Show content outside the panel').click();

  // 2. OFF: rendering is byte-identical to today — that same pixel matches
  //    the workspace background exactly.
  expectMatchesBackground(await readCanvasPixel(page, shapePt));

  // 3. The pattern-only gutter point stays background in BOTH states — the
  //    default dot-grid pattern layer never ghosts, toggle on or off.
  expectMatchesBackground(await readCanvasPixel(page, gutterPt));
});
