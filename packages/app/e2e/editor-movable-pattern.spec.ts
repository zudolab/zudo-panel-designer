// Movable pattern square (#97): click-select via the two-tier hit rule, drag
// a SELECTED pattern partially off-panel (on-panel paint = square ∩ panel,
// the rest ghosts), arrow-key nudge, undo restore. Real trusted input only
// (page.mouse / page.keyboard). Doc state asserts through the window.__zpdTest
// bridge; paint asserts scan REGIONS, never single pixels — dot-grid content
// has gaps, so single-pixel probes would be flaky (see helpers.ts).
import { PALETTE } from '@zpd/core';
import { expect, type Page, test } from '@playwright/test';
import {
  bridge,
  countPixelsDiffering,
  MOD,
  openEditor,
  readCanvasRegion,
  toScreenPoint,
} from './helpers';

// Matches renderer.ts's WORKSPACE_BG ('#26282c').
const WORKSPACE_BG: readonly [number, number, number] = [38, 40, 44];
// The panel's base fill is the black soldermask (renderer.ts paints
// PALETTE[0] under the layer pass).
const PANEL_BASE = hexToRgb(PALETTE[0].hex);
const TOLERANCE = 8;

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Count of region pixels that are NOT `rgb` — 0 means "solid rgb here".
async function regionCount(
  page: Page,
  aMm: { x: number; y: number },
  bMm: { x: number; y: number },
  rgb: readonly [number, number, number],
): Promise<number> {
  const a = await toScreenPoint(page, aMm);
  const b = await toScreenPoint(page, bMm);
  return countPixelsDiffering(await readCanvasRegion(page, a, b), rgb, TOLERANCE);
}

async function getPattern(page: Page) {
  const layer = (await bridge(page).getDoc()).layers.find(
    (l) => l.id === 'layer-default-dot-grid',
  );
  if (layer?.type !== 'pattern') throw new Error('expected the default pattern layer');
  return layer;
}

test('@smoke movable pattern: click-selects, drag off-panel keeps intersection + ghost, nudge, undo restores', async ({
  page,
}) => {
  await openEditor(page);

  // 1. Plain click on empty panel area: the y 2..11 band is free of every
  // demo layer, so the two-tier hit falls through to the cover pattern and
  // the CLICK selects it (#97's click rule).
  const clickPt = await toScreenPoint(page, { x: 25, y: 5 });
  await page.mouse.click(clickPt.x, clickPt.y);
  expect(await bridge(page).getSelectedIds()).toEqual(['layer-default-dot-grid']);

  const before = await getPattern(page);

  // Probe regions (mm), both spanning more than the demo dot pitch (5mm) so
  // dot presence/absence is deterministic:
  // - STRIP: on-panel band the +40mm drag will UNCOVER (demo layers start at
  //   x 8 / y 14, and the moved square's left edge lands at ~6.2 — the strip
  //   stays clear of the selection chrome drawn along that edge).
  const stripA = { x: 0.8, y: 3 };
  const stripB = { x: 4.8, y: 12 };
  // - GUTTER: right of the panel, beyond the ORIGINAL square's right edge
  //   (~94.7) but inside the MOVED square — and >32px from the panel edge so
  //   the drop-shadow blur (renderer.ts shadowBlur 24) can't bleed into it.
  const gutterA = { x: 100, y: 55 };
  const gutterB = { x: 110, y: 70 };

  // Baseline: the strip is covered by the square (dots over the base fill);
  // the gutter is beyond the square — pure workspace background even though
  // the ghost pass is ON by default (#97: the square bounds the ghost).
  expect(await regionCount(page, stripA, stripB, PANEL_BASE)).toBeGreaterThan(0);
  expect(await regionCount(page, gutterA, gutterB, WORKSPACE_BG)).toBe(0);

  // 2. Drag the SELECTED pattern +40mm right — a move, not a marquee (#97's
  // drag rule: only an UNSELECTED pattern press marquees).
  const dragStart = await toScreenPoint(page, { x: 25, y: 5 });
  const dragEnd = await toScreenPoint(page, { x: 65, y: 5 });
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 10 });
  await page.mouse.up();

  const moved = await getPattern(page);
  expect(moved.x).toBeCloseTo(before.x + 40, 1);
  expect(moved.y).toBeCloseTo(before.y, 1);
  expect(moved.size).toBe(before.size); // move never resizes
  expect(await bridge(page).getSelectedIds()).toEqual(['layer-default-dot-grid']);

  // 3. Only square ∩ panel renders on-panel: the uncovered strip is now the
  // bare base fill (no dots) …
  expect(await regionCount(page, stripA, stripB, PANEL_BASE)).toBe(0);
  // … and the square's off-panel part ghosts in the gutter (dimmed dots).
  expect(await regionCount(page, gutterA, gutterB, WORKSPACE_BG)).toBeGreaterThan(0);

  // 4. Arrow-key nudge moves the selected pattern too (#97 nudge inclusion).
  await page.keyboard.press('ArrowRight');
  expect((await getPattern(page)).x).toBeCloseTo(moved.x + 0.1, 3);

  // 5. Undo the nudge, then the drag — position and paint fully restore.
  await page.keyboard.press(`${MOD}+z`);
  expect((await getPattern(page)).x).toBeCloseTo(moved.x, 3);
  await page.keyboard.press(`${MOD}+z`);
  const restored = await getPattern(page);
  expect(restored.x).toBeCloseTo(before.x, 5);
  expect(restored.y).toBeCloseTo(before.y, 5);
  expect(await regionCount(page, stripA, stripB, PANEL_BASE)).toBeGreaterThan(0);
  expect(await regionCount(page, gutterA, gutterB, WORKSPACE_BG)).toBe(0);
});
