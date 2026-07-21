// Multi/group rotate gesture integration coverage (#158, confirming #152's
// gesture + #157's history plumbing). Real trusted input only (page.mouse /
// page.keyboard), except for the one pointercancel dispatch that has no
// Playwright API — see that test's comment. State is asserted through the
// window.__zpdTest bridge (getDoc/getLayerTree/getHistory), oracled against
// @zpd/core's own rotateLayersAboutPivot — never by pixel-probing the canvas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isGroupNode,
  rotatedRectAABB,
  rotateLayersAboutPivot,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { expect, test, type Page } from '@playwright/test';
import { bridge, importPanelJson, MOD, openEditor, toScreenPoint } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// demo-doc.ts geometry — mirrored here rather than re-derived from the live
// doc, same convention as editor-rotate.spec.ts.
const RECT: ShapeLayer = {
  id: 'demo-rect',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 8,
  y: 14,
  width: 24,
  height: 16,
  color: 2,
};
const ELLIPSE: ShapeLayer = {
  id: 'demo-ellipse',
  name: 'Ellipse',
  type: 'shape',
  shape: 'ellipse',
  x: 30,
  y: 40,
  width: 22,
  height: 22,
  color: 1,
};
const RECT_CENTER = { x: 20, y: 22 };
const ELLIPSE_CENTER = { x: 41, y: 51 };
// Merged AABB of RECT (8..32, 14..30) and ELLIPSE (30..52, 40..62): x 8..52,
// y 14..62 -> the combined bbox multiRotateBbox unions over (renderer.ts).
const COMBINED_BBOX = { x: 8, y: 14, width: 44, height: 48 };
const PIVOT = { x: 30, y: 38 }; // COMBINED_BBOX's center — the gesture pivot
// Mirrors renderer.ts's ROTATE_HANDLE_OFFSET_PX: the combined knob floats
// this many SCREEN px beyond the combined bbox's top-edge midpoint — same
// recipe as the single-rotate handle, just fed the merged bbox.
const ROTATE_HANDLE_OFFSET_PX = 20;

async function click(page: Page, mm: { x: number; y: number }, modifiers: string[] = []) {
  const pt = await toScreenPoint(page, mm);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(pt.x, pt.y);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

async function selectRectAndEllipse(page: Page): Promise<void> {
  await click(page, RECT_CENTER);
  await click(page, ELLIPSE_CENTER, ['Shift']);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'demo-ellipse']);
}

async function knobScreenPos(page: Page): Promise<{ x: number; y: number }> {
  const topMid = await toScreenPoint(page, {
    x: COMBINED_BBOX.x + COMBINED_BBOX.width / 2,
    y: COMBINED_BBOX.y,
  });
  return { x: topMid.x, y: topMid.y - ROTATE_HANDLE_OFFSET_PX };
}

// Drags the combined knob from straight-above-pivot (pointer angle -90°) to
// `endMm`, optionally with Shift held for the whole gesture — same recipe as
// editor-rotate.spec.ts's selectAndRotateTo45, just anchored on the merged
// bbox instead of a single shape's own bbox.
async function dragCombinedKnob(
  page: Page,
  endMm: { x: number; y: number },
  opts: { shift?: boolean; finish?: 'up' | 'cancel' } = {},
): Promise<void> {
  const { shift = false, finish = 'up' } = opts;
  const knob = await knobScreenPos(page);
  const end = await toScreenPoint(page, endMm);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  if (finish === 'up') {
    await page.mouse.up();
  } else {
    // No Playwright API dispatches a native pointercancel — this is the ONE
    // synthetic-event exception in this file. It is safe here (unlike a
    // synthetic pointerdown/move, which the suite avoids because React's
    // delegated listeners need real hit-test-bearing coordinates): the
    // down+move above are fully real/trusted, and endPointerSession (the
    // shared onPointerUp/onPointerCancel handler) reads no position data at
    // all — it just closes out whatever the real moves already streamed.
    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="editor-canvas"]');
      if (!canvas) throw new Error('editor-canvas not found');
      canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true }));
    });
    // Hygiene: release the real mouse button Playwright still thinks is
    // down, so later actions in the test aren't seen as an ongoing drag.
    await page.mouse.up();
  }
  if (shift) await page.keyboard.up('Shift');
}

test('@smoke combined rotate: flat multi-selection and an equivalent group produce the same doc state; Shift snaps to 45°; one undo entry fully reverts', async ({
  page,
}) => {
  await openEditor(page);
  await selectRectAndEllipse(page);
  const historyBefore = await bridge(page).getHistory();

  // Knob starts at pointer angle -90° from PIVOT; releasing at -35° (30mm
  // out) is a +55° sweep that Shift snaps to exactly +45°, regardless of
  // screen-px rounding (same trick as editor-rotate.spec.ts).
  const rad = (-35 * Math.PI) / 180;
  const endMm = { x: PIVOT.x + 30 * Math.cos(rad), y: PIVOT.y + 30 * Math.sin(rad) };
  await dragCombinedKnob(page, endMm, { shift: true });

  const expected = rotateLayersAboutPivot(
    [RECT, ELLIPSE],
    { 'demo-rect': RECT_CENTER, 'demo-ellipse': ELLIPSE_CENTER },
    PIVOT,
    45,
  );
  const expectedRect = expected.find((l) => l.id === 'demo-rect') as ShapeLayer;
  const expectedEllipse = expected.find((l) => l.id === 'demo-ellipse') as ShapeLayer;
  expect(expectedRect.rotation).toBe(45);

  const flatDoc = await bridge(page).getDoc();
  const flatRect = flatDoc.layers.find((l) => l.id === 'demo-rect') as ShapeLayer;
  const flatEllipse = flatDoc.layers.find((l) => l.id === 'demo-ellipse') as ShapeLayer;
  expect(flatRect.rotation).toBe(45);
  expect(flatRect.x).toBeCloseTo(expectedRect.x, 3);
  expect(flatRect.y).toBeCloseTo(expectedRect.y, 3);
  expect(flatEllipse.rotation).toBe(45);
  expect(flatEllipse.x).toBeCloseTo(expectedEllipse.x, 3);
  expect(flatEllipse.y).toBeCloseTo(expectedEllipse.y, 3);

  // ONE undo entry for the WHOLE drag (every intermediate pointermove
  // streamed through replace(), not commit()).
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length + 1);
  await page.keyboard.press(`${MOD}+z`);
  const reverted = await bridge(page).getDoc();
  expect(reverted.layers.find((l) => l.id === 'demo-rect')).toMatchObject(RECT);
  expect(reverted.layers.find((l) => l.id === 'demo-ellipse')).toMatchObject(ELLIPSE);

  // Same selection, now wrapped in a one-level group: the combined bbox/
  // pivot/knob are identical (grouping carries no positionOffset), so the
  // IDENTICAL gesture must produce the IDENTICAL leaf geometry — parity
  // between a flat multi-selection and a group selection.
  await page.keyboard.press(`${MOD}+g`);
  expect(await bridge(page).getSelectedIds()).toHaveLength(1);
  await dragCombinedKnob(page, endMm, { shift: true });

  const groupedDoc = await bridge(page).getDoc();
  const tree = await bridge(page).getLayerTree();
  const group = tree.find((n) => n.kind === 'group');
  if (!group || group.kind !== 'group') throw new Error('expected demo-rect/demo-ellipse to be grouped');
  expect(group.children.map((c) => c.id)).toEqual(['demo-rect', 'demo-ellipse']);

  const groupedRect = groupedDoc.layers
    .flatMap((n) => (isGroupNode(n) ? n.children : [n]))
    .find((l) => l.id === 'demo-rect') as ShapeLayer;
  const groupedEllipse = groupedDoc.layers
    .flatMap((n) => (isGroupNode(n) ? n.children : [n]))
    .find((l) => l.id === 'demo-ellipse') as ShapeLayer;
  expect(groupedRect).toMatchObject({ x: flatRect.x, y: flatRect.y, rotation: flatRect.rotation });
  expect(groupedEllipse).toMatchObject({
    x: flatEllipse.x,
    y: flatEllipse.y,
    rotation: flatEllipse.rotation,
  });
});

// Same +55° sweep / Shift-snap-to-45° recipe as the parity test above, reused
// by both pointerup and pointercancel variants below so their outcomes are
// directly comparable against the SAME oracle. NOTE: an earlier version of
// this test compared 'up' vs 'cancel' by reusing a single `page` across a
// mid-test reload (openEditor called twice on the same page). That triggered
// an unrelated Playwright/browser artifact — a SECOND drag-and-drop-style
// gesture replayed on a page that had already completed one earlier, even
// after a full page.goto() reload, silently failed to open a NEW history
// entry (ctx.beginGesture() never fired) while ctx.replace() still applied
// the bake — repros identically with two plain pointerup runs, no
// pointercancel involved. Since every genuinely fresh single-gesture run
// (this file's other tests, and manual isolation) behaves correctly, that is
// a test-harness artifact of reusing one page across two full gestures, not
// a product bug — so each variant below gets its own fresh `test()` (and
// therefore its own fresh browser context) instead.
const SWEEP_TO_45_MM = (() => {
  const rad = (-35 * Math.PI) / 180;
  return { x: PIVOT.x + 30 * Math.cos(rad), y: PIVOT.y + 30 * Math.sin(rad) };
})();

function expected45(): { rect: ShapeLayer; ellipse: ShapeLayer } {
  const rotated = rotateLayersAboutPivot(
    [RECT, ELLIPSE],
    { 'demo-rect': RECT_CENTER, 'demo-ellipse': ELLIPSE_CENTER },
    PIVOT,
    45,
  );
  return {
    rect: rotated.find((l) => l.id === 'demo-rect') as ShapeLayer,
    ellipse: rotated.find((l) => l.id === 'demo-ellipse') as ShapeLayer,
  };
}

test('@smoke a combined-rotate drag ending in pointerup writes one history entry with the expected bake', async ({
  page,
}) => {
  await openEditor(page);
  await selectRectAndEllipse(page);
  const historyBefore = await bridge(page).getHistory();

  await dragCombinedKnob(page, SWEEP_TO_45_MM, { shift: true, finish: 'up' });

  const { rect: expectedRect, ellipse: expectedEllipse } = expected45();
  const doc = await bridge(page).getDoc();
  const rect = doc.layers.find((l) => l.id === 'demo-rect') as ShapeLayer;
  const ellipse = doc.layers.find((l) => l.id === 'demo-ellipse') as ShapeLayer;
  expect(rect).toMatchObject({ rotation: 45 });
  expect(rect.x).toBeCloseTo(expectedRect.x, 3);
  expect(rect.y).toBeCloseTo(expectedRect.y, 3);
  expect(ellipse).toMatchObject({ rotation: 45 });
  expect(ellipse.x).toBeCloseTo(expectedEllipse.x, 3);
  expect(ellipse.y).toBeCloseTo(expectedEllipse.y, 3);
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length + 1);
});

test('@smoke a combined-rotate drag ending in pointercancel behaves exactly like pointerup', async ({
  page,
}) => {
  await openEditor(page);
  await selectRectAndEllipse(page);
  const historyBefore = await bridge(page).getHistory();

  await dragCombinedKnob(page, SWEEP_TO_45_MM, { shift: true, finish: 'cancel' });

  const { rect: expectedRect, ellipse: expectedEllipse } = expected45();
  const doc = await bridge(page).getDoc();
  const rect = doc.layers.find((l) => l.id === 'demo-rect') as ShapeLayer;
  const ellipse = doc.layers.find((l) => l.id === 'demo-ellipse') as ShapeLayer;
  expect(rect).toMatchObject({ rotation: 45 });
  expect(rect.x).toBeCloseTo(expectedRect.x, 3);
  expect(rect.y).toBeCloseTo(expectedRect.y, 3);
  expect(ellipse).toMatchObject({ rotation: 45 });
  expect(ellipse.x).toBeCloseTo(expectedEllipse.x, 3);
  expect(ellipse.y).toBeCloseTo(expectedEllipse.y, 3);
  // Same ONE entry as pointerup — the streamed replaces already hold the
  // last applied change; closing via cancel adds no trailing commit either.
  expect((await bridge(page).getHistory()).past.length).toBe(historyBefore.past.length + 1);

  // The gesture is truly OVER: a further pointermove with no new pointerdown
  // must not keep streaming replace() calls.
  const docAfterCancel = await bridge(page).getDoc();
  await page.mouse.move(20, 20);
  await page.mouse.move(500, 500, { steps: 5 });
  expect(await bridge(page).getDoc()).toEqual(docAfterCancel);
});

test('@smoke a zero-change combined-rotate drag writes no history entry', async ({ page }) => {
  await openEditor(page);
  await selectRectAndEllipse(page);
  const historyBefore = await bridge(page).getHistory();
  const docBefore = await bridge(page).getDoc();

  const knob = await knobScreenPos(page);
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  // Move further OUTWARD along the same ray from PIVOT through the knob:
  // pointerDeg only depends on angle, not radius, so this is a real,
  // non-trivial pointermove that nonetheless keeps the angle (and therefore
  // the snapped delta) at EXACTLY 0.
  await page.mouse.move(knob.x, knob.y - 20, { steps: 5 });
  await page.mouse.up();

  expect(await bridge(page).getHistory()).toEqual(historyBefore);
  expect(await bridge(page).getDoc()).toEqual(docBefore);
});

// text-geometry.ts deliberately caches a pivot ONLY for text that already
// carries a non-zero rotation (see getTextGeometry's `if (rotation === 0)`
// early-return, which never persists an entry — unrotated text is always
// remeasured fresh, on purpose, since it has no pivot worth preserving). The
// demo doc's own demo-text starts unrotated, so peekTextGeometry() would
// stay null forever for it — this seeds a STANDALONE doc with a text layer
// that already has a small starting rotation, so its pivot is cached and
// readable via the bridge BEFORE the combined-rotate gesture even begins.
const TEXT_LAYER: TextLayer = {
  id: 'pivot-text',
  name: 'Pivot text',
  type: 'text',
  content: 'ZPD',
  fontFamily: 'sans-serif',
  sizeMm: 9,
  x: 8,
  y: 90,
  rotation: 12,
  color: 2,
};

test('@smoke a rotated text member bakes about its canvas-measured pivot (doc state, not pixels)', async ({
  page,
}) => {
  await page.addInitScript((textLayer) => {
    localStorage.setItem(
      'zpd.doc.v1',
      JSON.stringify({
        version: 1,
        savedAt: 0,
        config: {
          version: 4,
          app: 'zpd',
          panel: { hp: 12, widthMm: 60.6, heightMm: 128.5 },
          palette: ['Black', 'Gold', 'White'],
          layers: [
            {
              id: 'demo-rect',
              name: 'Rect',
              type: 'shape',
              shape: 'rect',
              x: 8,
              y: 14,
              width: 24,
              height: 16,
              color: 2,
            },
            textLayer,
          ],
          guides: [],
        },
      }),
    );
  }, TEXT_LAYER);
  await openEditor(page);
  // Text metrics are measured asynchronously (font load + canvas measure —
  // see text-geometry.ts); poll rather than assume they're ready the instant
  // the bridge appears (matches editor-rotate.spec.ts's delayed-font test).
  await expect
    .poll(() => bridge(page).getTextGeometry('pivot-text'))
    .toMatchObject({ loading: false });
  const textGeom = await bridge(page).getTextGeometry('pivot-text');
  if (!textGeom) throw new Error('pivot-text has no measured geometry');

  await click(page, RECT_CENTER);
  // Rotation orbits a shape about its OWN center, so textGeom.pivot (the
  // local box's center) is still the correct click target even though the
  // layer already carries a 12° rotation — the center point itself doesn't
  // move when a shape spins about it.
  const textCenter = { x: textGeom.pivot.x, y: textGeom.pivot.y };
  await click(page, textCenter, ['Shift']);
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect', 'pivot-text']);

  // Combined bbox = RECT's AABB merged with the text's own CANVAS-MEASURED
  // local box ROTATED by its current 12° (rotatedRectAABB) — exactly
  // multiRotateBbox's own math (renderer.ts), never core's rough text-bbox
  // estimate. RECT carries no rotation, so rotatedRectAABB is a no-op for it.
  const rectAabb = rotatedRectAABB({ x: RECT.x, y: RECT.y, width: RECT.width, height: RECT.height }, 0);
  const textAabb = rotatedRectAABB(textGeom.box, TEXT_LAYER.rotation);
  const minX = Math.min(rectAabb.x, textAabb.x);
  const minY = Math.min(rectAabb.y, textAabb.y);
  const maxX = Math.max(rectAabb.x + rectAabb.width, textAabb.x + textAabb.width);
  const maxY = Math.max(rectAabb.y + rectAabb.height, textAabb.y + textAabb.height);
  const pivot = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const topMid = await toScreenPoint(page, { x: pivot.x, y: minY });
  const knob = { x: topMid.x, y: topMid.y - ROTATE_HANDLE_OFFSET_PX };

  const rad = (-45 * Math.PI) / 180; // -90 start, -45 end -> +45 sweep, exact even unsnapped
  const end = await toScreenPoint(page, {
    x: pivot.x + 30 * Math.cos(rad),
    y: pivot.y + 30 * Math.sin(rad),
  });
  await page.keyboard.down('Shift');
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const doc = await bridge(page).getDoc();
  const textLayer = doc.layers.find((l) => l.id === 'pivot-text') as {
    x: number;
    y: number;
    rotation?: number;
  };
  // Starts at 12°, +45° sweep -> 57°, not 45 (the pre-existing rotation is
  // NOT reset by the gesture — it folds the delta in, same as every other
  // rotatable kind).
  expect(textLayer.rotation).toBe(57);

  // Oracle: the SAME bake, fed the text's real canvas-measured pivot as its
  // own center — proves the app used that measured pivot, not a naive
  // model-only estimate (which would produce a visibly different x/y shift).
  const expected = rotateLayersAboutPivot(
    [RECT, TEXT_LAYER],
    { 'demo-rect': RECT_CENTER, 'pivot-text': textGeom.pivot },
    pivot,
    45,
  );
  const expectedText = expected.find((l) => l.id === 'pivot-text') as { x: number; y: number };
  expect(textLayer.x).toBeCloseTo(expectedText.x, 3);
  expect(textLayer.y).toBeCloseTo(expectedText.y, 3);
});

test('@smoke save -> reload round-trips every leaf rotation, including a rotated image and a rotated path', async ({
  page,
}) => {
  await openEditor(page);

  // Range-select every non-pattern leaf via the layers panel (top-of-stack-
  // first visible order: Reference image, Text, Path, Ellipse, Rect, then
  // the default pattern) — avoids needing exact canvas geometry for a path,
  // which has no fill and a thin stroke, and is far more robust than trying
  // to hit its bezier curve with a canvas click.
  await page.getByRole('button', { name: 'Select layer Reference image' }).click();
  await page.getByRole('button', { name: 'Select layer Rect' }).click({ modifiers: ['Shift'] });
  expect(await bridge(page).getSelectedIds()).toEqual([
    'demo-rect',
    'demo-ellipse',
    'demo-path',
    'demo-text',
    'demo-image',
  ]);

  // The numeric rotate input (#157) drives the SAME bakeMultiRotate as the
  // canvas knob, without needing to compute a combined-bbox screen position
  // for a 5-member selection that includes an irregular path.
  const rotateInput = page.getByLabel('Rotate selection (°)');
  await expect(rotateInput).toBeVisible();
  await rotateInput.fill('30');
  await rotateInput.press('Enter');

  const before = await bridge(page).getDoc();
  const imageBefore = before.layers.find((l) => l.id === 'demo-image') as { rotation?: number };
  const pathBefore = before.layers.find((l) => l.id === 'demo-path') as {
    points: { x: number; y: number }[];
  };
  expect(imageBefore.rotation).toBeCloseTo(30, 1);
  // A pure rotate must not change the path's POINT COUNT — only their coords.
  expect(pathBefore.points).toHaveLength(3);
  const treeBefore = await bridge(page).getLayerTree();

  const exported = await bridge(page).serialize();
  const tmpPath = path.join(__dirname, '..', 'test-results', 'group-rotate-roundtrip.json');
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(exported));

  await importPanelJson(page, tmpPath);

  const after = await bridge(page).getDoc();
  expect(after.panelHp).toBe(before.panelHp);
  const imageAfter = after.layers.find((l) => l.id === 'demo-image') as { rotation?: number };
  const pathAfter = after.layers.find((l) => l.id === 'demo-path') as {
    points: { x: number; y: number }[];
  };
  expect(imageAfter.rotation).toBeCloseTo(imageBefore.rotation as number, 6);
  expect(pathAfter.points).toEqual(pathBefore.points);

  // Full-tree identity: the v4 export/import round trip changes nothing
  // structurally (every leaf, and their order, survives byte-for-byte on the
  // fields that matter).
  expect(await bridge(page).getLayerTree()).toEqual(treeBefore);
});
