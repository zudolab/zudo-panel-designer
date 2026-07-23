// Modifier vocabulary + conditional empty-space deselect smoke coverage
// (#47), plus plain multi-move (#49) — distinct from the alt-drag DUPLICATE
// case editor-select.spec.ts already covers. Real trusted input only
// (page.mouse / page.keyboard) — synthetic dispatchEvent PointerEvents are
// unreliable against React's event delegation. State is asserted through the
// window.__zpdTest bridge, never by pixel-probing the canvas.
//
// Semantics mirrored here match select-marquee.test.ts's unit coverage of
// select.tsx's onPointerDown (see "modifier clicks on layers" / "a
// meta/ctrl empty click PRESERVES..." / "a right-click PRESERVES..."):
// Shift and Meta/Ctrl both toggle just the CLICKED layer's own membership
// (add if absent, remove if present) and leave the rest of the selection
// untouched — the two modifiers are deliberately interchangeable, not
// differently-scoped operations.
import { expect, test, type Page } from '@playwright/test';
import { bridge, MOD, openEditor, toScreenPoint } from './helpers';

// demo-doc.ts geometry: demo-rect (8,14) 24×16 -> center (20,22);
// demo-ellipse (30,40) 22×22 -> center (41,51).
const RECT = { x: 8, y: 14, width: 24, height: 16 };
const ELLIPSE = { x: 30, y: 40, width: 22, height: 22 };
const RECT_CENTER = { x: 20, y: 22 };
const ELLIPSE_CENTER = { x: 41, y: 51 };
// #97 made pattern squares click-selectable (two-tier hit-test), so a point
// over the cover-default pattern no longer reads as empty space — a plain
// click there now selects the pattern (editor-movable-pattern.spec.ts covers
// that). Genuine empty space must sit OUTSIDE the cover square too: for the
// 12HP demo doc the square spans x ≈ -33.8..94.7 (patternCoverGeometry), so
// x -42 clears it with margin while staying inside the fitted canvas gutter.
const EMPTY_SPACE = { x: -42, y: 60 };

async function click(
  page: Page,
  mm: { x: number; y: number },
  opts: { modifiers?: string[]; button?: 'left' | 'right' } = {},
): Promise<void> {
  const pt = await toScreenPoint(page, mm);
  const { modifiers = [], button = 'left' } = opts;
  for (const key of modifiers) await page.keyboard.down(key);
  if (button === 'right') {
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
  } else {
    await page.mouse.click(pt.x, pt.y);
  }
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

test('@smoke Shift-click adds to, then toggles out of, the selection', async ({ page }) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  await click(page, ELLIPSE_CENTER, { modifiers: ['Shift'] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse', 'demo-rect']);

  // Shift toggles WITHIN the selection too, not just add — clicking a member
  // that's already selected removes just that one.
  await click(page, RECT_CENTER, { modifiers: ['Shift'] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse']);
});

test('@smoke Meta/Ctrl-click toggles exactly one layer, leaving the rest untouched', async ({
  page,
}) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  await click(page, ELLIPSE_CENTER, { modifiers: [MOD] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse', 'demo-rect']);

  await click(page, ELLIPSE_CENTER, { modifiers: [MOD] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);
});

test('@smoke a plain primary click on empty canvas clears the selection', async ({ page }) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  await click(page, EMPTY_SPACE);
  expect(await bridge(page).getSelectedIds()).toEqual([]);
});

test('@smoke a Meta/Ctrl-click on empty canvas preserves the selection', async ({ page }) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  await click(page, EMPTY_SPACE, { modifiers: [MOD] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);
});

test('@smoke a right-click preserves the selection, on empty canvas and on another layer', async ({
  page,
}) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  await click(page, EMPTY_SPACE, { button: 'right' });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);

  // Right-click wins over hit-testing entirely (select.tsx returns before any
  // hit-test on e.button !== 0) — clicking a DIFFERENT layer still preserves.
  await click(page, ELLIPSE_CENTER, { button: 'right' });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);
});

test('@smoke plain multi-move: dragging one member moves the whole selection as ONE undo entry', async ({
  page,
}) => {
  await openEditor(page);

  await click(page, RECT_CENTER);
  await click(page, ELLIPSE_CENTER, { modifiers: ['Shift'] });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse', 'demo-rect']);
  const layerCountBefore = await bridge(page).getLayerCount();

  // No Alt: a plain move, distinct from the alt-drag DUPLICATE case
  // editor-select.spec.ts already covers — the layer count must not change.
  const dxMm = 10;
  const dyMm = 8;
  const start = await toScreenPoint(page, RECT_CENTER);
  const end = await toScreenPoint(page, { x: RECT_CENTER.x + dxMm, y: RECT_CENTER.y + dyMm });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  expect(await bridge(page).getLayerCount()).toBe(layerCountBefore);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse', 'demo-rect']);

  const rect = await bridge(page).getMaterialLayer('demo-rect');
  const ellipse = await bridge(page).getMaterialLayer('demo-ellipse');
  if (rect?.type !== 'shape' || ellipse?.type !== 'shape') {
    throw new Error('expected demo-rect and demo-ellipse to remain shape layers');
  }
  // Both moved by the SAME delta — one gesture, relative spacing preserved.
  expect(rect.x).toBeCloseTo(RECT.x + dxMm, 3);
  expect(rect.y).toBeCloseTo(RECT.y + dyMm, 3);
  expect(ellipse.x).toBeCloseTo(ELLIPSE.x + dxMm, 3);
  expect(ellipse.y).toBeCloseTo(ELLIPSE.y + dyMm, 3);

  // ONE undo restores BOTH layers to their original positions.
  await page.keyboard.press(`${MOD}+z`);
  expect(await bridge(page).getMaterialLayer('demo-rect')).toMatchObject(RECT);
  expect(await bridge(page).getMaterialLayer('demo-ellipse')).toMatchObject(ELLIPSE);
});
