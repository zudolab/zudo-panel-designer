// Built-in select tool (V) — the reference tool for Wave 5 to copy. It shows
// every part of the contract: hit-testing, one-undo-entry gestures
// (beginGesture + streamed replace), reading LIVE ctx state mid-gesture, and
// screen<->mm conversion. Move / resize (8 handles, rotation-aware) / rotate /
// path node editing all live here; a later wave refines this ONE file without
// touching the registry.
import {
  duplicateLayersAbove,
  flattenLayerNodes,
  hitTestLayer,
  mergeBboxes,
  mintId,
  movePathAnchor,
  movePathHandle,
  rectCenter,
  rectsIntersect,
  resizeRotatedRect,
  rotatedRectAABB,
  scaleLayer,
  snapAxis,
  snapScalar,
  snapToGrid,
  translatePathLayer,
  type DocState,
  type Layer,
  type Pt,
  type Rect,
  type ResizeHandle,
  type SnapOptions,
} from '@zpd/core';
import {
  canRotate,
  cornerHandleRects,
  drawHoverOutline,
  layerBbox,
  layerRotation,
  multiResizeBbox,
  resizeHandleRects,
  rotateHandleScreenPos,
} from '../renderer';
import { registerTool } from '../registry/tools';
import { getTextGeometry, reconcileTextGeometry } from '../text-geometry';
import type { DraftRenderContext, ToolContext, ToolPointerEvent } from '../types';

const SNAP_MM = 0.1;
const MIN_RESIZE_MM = 0.5;
const ANCHOR_GRAB_PX = 7;
const HANDLE_GRAB_PX = 6;
const ROTATE_GRAB_PX = 8;
// Click-vs-drag threshold (#47): 4 CSS px measured in CLIENT (screen) space so
// it is zoom-invariant — at any zoom, a sub-4px press-and-release is a click.
// Mouse only; the 8px touch threshold is a deliberate, recorded exclusion
// (zpd is a desktop web app; e2e drives page.mouse).
const DRAG_THRESHOLD_PX = 4;
const MARQUEE_FILL = 'rgba(77,163,255,0.10)';
const MARQUEE_STROKE = 'rgba(77,163,255,0.9)';

const snap = (v: number) => snapToGrid(v, SNAP_MM);

// Catch radius for guides, in SCREEN px, converted to mm at the current zoom
// (#55; core/snap.ts explicitly leaves this to the tool so the same guide
// feels equally easy to hit whether zoomed in or out — core itself stays in
// mm and has no notion of zoom).
const GUIDE_SNAP_PX = 8;

function snapOptions(ctx: ToolContext): SnapOptions {
  return {
    gridMm: SNAP_MM,
    toleranceMm: GUIDE_SNAP_PX / ctx.camera.pxPerMm,
    guides: ctx.doc.guides,
  };
}

// Union (rotated-AABB) bbox of a move gesture's targets, at their pointerdown
// geometry — the candidate set snapAxis checks against guides. null when no
// target has measurable bounds (never happens in practice; every layer type,
// patterns included since #97, has a bbox).
function targetsBbox(targets: readonly MoveTarget[]): Rect | null {
  const rects: Rect[] = [];
  for (const { orig } of targets) {
    const bbox = layerBbox(orig);
    if (bbox) rects.push(rotatedRectAABB(bbox, layerRotation(orig)));
  }
  return rects.length ? mergeBboxes(rects) : null;
}

// Mirrors core/resize.ts's private HANDLE_AXES map (not exported): which edge
// on each axis a handle drags. 'end' = the far edge (x+width / y+height),
// 'start' = the near edge (x / y), undefined = that axis is untouched by this
// handle.
const RESIZE_HANDLE_AXES: Record<ResizeHandle, { x?: 'start' | 'end'; y?: 'start' | 'end' }> = {
  n: { y: 'start' },
  s: { y: 'end' },
  e: { x: 'end' },
  w: { x: 'start' },
  ne: { x: 'end', y: 'start' },
  nw: { x: 'start', y: 'start' },
  se: { x: 'end', y: 'end' },
  sw: { x: 'start', y: 'end' },
};

// Axis-aligned resize snap (#55). The x/y/width/height baseline below is the
// EXACT pre-#55 grid-only computation (`snap` on each field independently),
// left COMPLETELY UNTOUCHED unless a guide actually catches — so an ungated
// drag (no guide in range) is bit-identical to before, even for an off-grid
// origin (numeric inspectors allow one; a guide-aware recompute that always
// ran, even with no guide, would silently diverge from the baseline there:
// `x`'s independent grid rounding and a size computed from unrounded `r`
// would no longer add up to the same edge — see #55 review). Only on an
// actual guide catch do we recompute: guides are absolute mm positions,
// meaningless applied to a relative width/height, so the free edge snaps as
// an ABSOLUTE coordinate and width/height is then derived around the SAME
// anchor coordinate being returned, so the two always add up to the intended
// edge (the opposite/anchor edge stays exactly orig.x+orig.width /
// orig.y+orig.height for a 'start' handle, and exactly the returned `x`/`y`
// for an 'end' handle).
function resizeSnapPatch(
  orig: Rect,
  r: Rect,
  handle: ResizeHandle,
  ctx: ToolContext,
): { x: number; y: number; width: number; height: number } {
  const axes = RESIZE_HANDLE_AXES[handle];
  const opts = snapOptions(ctx);
  let x = snap(r.x);
  let y = snap(r.y);
  let width = snap(r.width);
  let height = snap(r.height);

  if (axes.x === 'end') {
    const snapped = snapScalar(r.x + r.width, 'x', opts);
    if (snapped.guide) width = Math.max(MIN_RESIZE_MM, roundMm(snapped.value - x));
  } else if (axes.x === 'start') {
    const snapped = snapScalar(r.x, 'x', opts);
    if (snapped.guide) {
      const anchorRight = orig.x + orig.width;
      width = Math.max(MIN_RESIZE_MM, roundMm(anchorRight - snapped.value));
      x = roundMm(anchorRight - width);
    }
  }

  if (axes.y === 'end') {
    const snapped = snapScalar(r.y + r.height, 'y', opts);
    if (snapped.guide) height = Math.max(MIN_RESIZE_MM, roundMm(snapped.value - y));
  } else if (axes.y === 'start') {
    const snapped = snapScalar(r.y, 'y', opts);
    if (snapped.guide) {
      const anchorBottom = orig.y + orig.height;
      height = Math.max(MIN_RESIZE_MM, roundMm(anchorBottom - snapped.value));
      y = roundMm(anchorBottom - height);
    }
  }

  return { x, y, width, height };
}

// One member of an in-flight move drag. `orig` is the layer as it was at
// pointerdown (or, after an Alt-duplicate re-target, the source it was cloned
// from — same geometry) so deltas always apply against the drag-start state.
interface MoveTarget {
  id: string;
  orig: Layer;
}

type Drag =
  | {
      kind: 'move';
      startMm: Pt;
      // The whole selection — pattern members included since #97 — moves as
      // one gesture (#49); a single-layer drag is just a one-element list.
      targets: MoveTarget[];
      // Latched on the FIRST pointermove past DRAG_THRESHOLD_PX — the one
      // moment Alt is sampled for duplicate (#49). Pressing Alt later must
      // not retro-clone, and an Alt-click that never crosses clones nothing.
      crossed: boolean;
      // Plain pointerdown on a member of a multi-selection keeps the whole
      // selection so the drag can move it; if the gesture turns out to be a
      // CLICK (never crossed the threshold), collapse to this id on release.
      collapseTo: string | null;
    }
  | {
      kind: 'resize';
      layerId: string;
      handle: ResizeHandle;
      orig: Rect;
      startMm: Pt;
      // Layer rotation latched at pointerdown — the whole gesture resolves in
      // this one frame (mid-drag the rect changes, the rotation doesn't).
      rotation: number;
    }
  | {
      kind: 'multi-resize';
      // Corner id by construction — edge handles are never offered for a
      // multi-selection (#52; cornerHandleRects is the only grab source).
      handle: ResizeHandle;
      // Combined bbox latched at pointerdown — the whole gesture's factor and
      // anchors resolve against this one frame, like `orig` in resize.
      bbox: Rect;
      startMm: Pt;
      // Pattern-free (#97 keeps patterns OUT of multi-scale: core's scaleLayer
      // deliberately passes them through — see scale.ts): they stay selected,
      // just unaffected. Unlike multi-move, which includes them.
      targets: MoveTarget[];
    }
  | {
      kind: 'rotate';
      layerId: string;
      centerMm: Pt; // bbox center at pointerdown — the rotation pivot
      startPointerDeg: number; // pointer angle about the center at pointerdown
      startRotation: number; // layer rotation at pointerdown
    }
  | { kind: 'anchor'; layerId: string; index: number }
  | { kind: 'handle'; layerId: string; index: number; which: 'hin' | 'hout' };

interface MarqueeState {
  startScreen: Pt;
  startMm: Pt;
  currentMm: Pt;
  // Armed on pointerdown, materialized only past DRAG_THRESHOLD_PX — a plain
  // empty-space click just deselects and never flashes a marquee.
  active: boolean;
  additive: boolean; // shift/meta/ctrl held: union with the down-time selection
  baseIds: readonly string[];
  // A press on an UNSELECTED pattern square arms the marquee like empty space
  // (#97's drag rule), but when the gesture never materializes a marquee the
  // release (toggle-)selects this pattern instead — the two-tier click rule.
  clickSelectId: string | null;
}

let drag: Drag | null = null;
let gestureOpen = false;
let marquee: MarqueeState | null = null;
let hoveredId: string | null = null;
let downScreen: Pt | null = null;

function ensureGesture(ctx: ToolContext): void {
  if (!gestureOpen) {
    gestureOpen = true;
    ctx.beginGesture();
  }
}

function pastThreshold(screen: Pt, origin: Pt): boolean {
  return Math.hypot(screen.x - origin.x, screen.y - origin.y) >= DRAG_THRESHOLD_PX;
}

// Normalized (positive-size) marquee rect in mm — drags go in any direction.
export function marqueeRect(startMm: Pt, currentMm: Pt): Rect {
  return {
    x: Math.min(startMm.x, currentMm.x),
    y: Math.min(startMm.y, currentMm.y),
    width: Math.abs(currentMm.x - startMm.x),
    height: Math.abs(currentMm.y - startMm.y),
  };
}

// Marquee hit math (#47, resolves #40's open question): INTERSECTION
// semantics, not containment — a layer whose AABB merely overlaps the marquee
// is selected. Bounds come from renderer.ts's layerBbox (the canonical bounds
// source, #45) so chrome and marquee agree to the pixel for text. Hidden
// layers are skipped, and pattern layers stay skipped ON PURPOSE (#97's
// eligibility sweep): they're background-ish, and a cover-default square
// would otherwise join essentially every marquee. Patterns are selected by
// direct click (the two-tier rule in hit-test.ts) or the layer list.
export function marqueeHitIds(layers: readonly Layer[], rectMm: Rect): string[] {
  reconcileTextGeometry(layers);
  const ids: string[] = [];
  for (const layer of layers) {
    if (layer.hidden || layer.type === 'pattern') continue;
    const bbox = layerBbox(layer);
    if (!bbox) continue;
    if (rectsIntersect(rectMm, rotatedRectAABB(bbox, layerRotation(layer)))) ids.push(layer.id);
  }
  return ids;
}

function updateLayer(ctx: ToolContext, id: string, patch: Partial<Layer>, commit: boolean): void {
  const next: DocState = {
    ...ctx.doc,
    layers: ctx.doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
  };
  if (commit) ctx.commit(next);
  else ctx.replace(next);
}

// Adds a snapped delta to a coordinate with snapToGrid's float hygiene, but
// WITHOUT re-snapping the absolute position: a multi-selection with off-grid
// members (numeric inspectors allow them) must keep its relative spacing, so
// one gesture delta applies to every target (#49 review).
function addMm(a: number, b: number): number {
  return Number((a + b).toFixed(6));
}

const roundMm = (v: number) => Number(v.toFixed(6));

// Pointer angle about a center, degrees. atan2 in a y-down space is
// clockwise-positive — the same convention as layer rotation (bbox.ts).
function pointerDeg(mm: Pt, center: Pt): number {
  return (Math.atan2(mm.y - center.y, mm.x - center.x) * 180) / Math.PI;
}

// Keep streamed rotations inspector-friendly: [-180, 180), 0.1° resolution.
function normalizeDeg(v: number): number {
  return Number(((((v % 360) + 540) % 360) - 180).toFixed(1));
}

// App-side text hit: use the same raw box and render pivot as paint/chrome.
// topmostHit below retains core's two-tier layer ordering around this helper.
export function hitTestCanonicalText(layer: Extract<Layer, { type: 'text' }>, mm: Pt): boolean {
  const geometry = getTextGeometry(layer);
  if (!geometry) return false;
  let x = mm.x;
  let y = mm.y;
  const rotation = layer.rotation ?? 0;
  if (rotation) {
    const rad = (-rotation * Math.PI) / 180;
    const dx = mm.x - geometry.pivot.x;
    const dy = mm.y - geometry.pivot.y;
    x = geometry.pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad);
    y = geometry.pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  const box = geometry.box;
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

function topmostHit(ctx: ToolContext, mm: Pt): Layer | null {
  const layers = flattenLayerNodes(ctx.doc.layers);
  reconcileTextGeometry(layers, ctx.requestRepaint);
  // Preserve core's two-tier ordering exactly: every non-pattern wins over
  // every pattern, and topmost wins within a tier. Only text substitutes the
  // app's canonical Canvas-metric geometry for core's rough estimate.
  for (const patternTier of [false, true]) {
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (layer.hidden || (layer.type === 'pattern') !== patternTier) continue;
      const hit =
        layer.type === 'text' ? hitTestCanonicalText(layer, mm) : hitTestLayer(layer, mm.x, mm.y);
      if (hit) return layer;
    }
  }
  return null;
}

function tryGrabNode(selected: Layer, e: ToolPointerEvent, ctx: ToolContext): boolean {
  if (selected.type !== 'path') return false;
  for (let i = 0; i < selected.points.length; i += 1) {
    const p = selected.points[i];
    const ap = ctx.toScreen(p);
    if (Math.hypot(ap.x - e.screen.x, ap.y - e.screen.y) < ANCHOR_GRAB_PX) {
      drag = { kind: 'anchor', layerId: selected.id, index: i };
      return true;
    }
    for (const which of ['hin', 'hout'] as const) {
      const h = p[which];
      if (!h) continue;
      const hp = ctx.toScreen(h);
      if (Math.hypot(hp.x - e.screen.x, hp.y - e.screen.y) < HANDLE_GRAB_PX) {
        drag = { kind: 'handle', layerId: selected.id, index: i, which };
        return true;
      }
    }
  }
  return false;
}

function tryGrabResizeHandle(selected: Layer, e: ToolPointerEvent, ctx: ToolContext): boolean {
  if (selected.type !== 'shape' && selected.type !== 'image') return false;
  const bbox = layerBbox(selected);
  if (!bbox) return false;
  // Rotated shapes/images resize too (#51, image joined in #147): handles sit
  // at the ROTATED corners and the drag resolves in the layer's local frame
  // via resizeRotatedRect (#48). The type gate above is the whole eligibility
  // check (core's isResizable was deleted in #48).
  const rotation = layerRotation(selected);
  for (const h of resizeHandleRects(bbox, ctx.camera, rotation)) {
    if (
      e.screen.x >= h.x &&
      e.screen.x <= h.x + h.size &&
      e.screen.y >= h.y &&
      e.screen.y <= h.y + h.size
    ) {
      drag = {
        kind: 'resize',
        layerId: selected.id,
        handle: h.id,
        orig: { x: selected.x, y: selected.y, width: selected.width, height: selected.height },
        startMm: e.mm,
        rotation,
      };
      return true;
    }
  }
  return false;
}

function tryGrabRotateHandle(selected: Layer, e: ToolPointerEvent, ctx: ToolContext): boolean {
  if (!canRotate(selected)) return false; // shape/text/image only — never invent rotation
  const bbox = layerBbox(selected);
  if (!bbox) return false;
  const rotation = layerRotation(selected);
  const knob = rotateHandleScreenPos(bbox, rotation, ctx.camera);
  if (Math.hypot(knob.x - e.screen.x, knob.y - e.screen.y) > ROTATE_GRAB_PX) return false;
  const centerMm = rectCenter(bbox);
  drag = {
    kind: 'rotate',
    layerId: selected.id,
    centerMm,
    startPointerDeg: pointerDeg(e.mm, centerMm),
    startRotation: rotation,
  };
  return true;
}

// Corner handle id -> that corner of the rect (and, with `opposite`, the
// diagonally opposing one — the default scale anchor).
function bboxCorner(rect: Rect, handle: ResizeHandle, opposite = false): Pt {
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  return {
    x: west !== opposite ? rect.x : rect.x + rect.width,
    y: north !== opposite ? rect.y : rect.y + rect.height,
  };
}

// Group-level factor floor (#52, per #50's review note): scaleLayer clamps its
// factor PER LAYER at the minSize floor, which would let clamped members stop
// shrinking while unclamped ones kept going — the group would lose its
// rigidity exactly at the clamp boundary. Pre-clamping the ONE shared factor
// to every member's own floor makes the per-layer clamp a no-op, so a single
// factor drives the whole selection all the way down. The combined bbox's dims
// join the floor so a dimension-less (path-only) selection bottoms out too
// instead of collapsing to a point; the tiny seed just keeps the factor
// positive (scaleLayer's contract) for fully degenerate geometry.
function groupFactorFloor(targets: readonly MoveTarget[], bbox: Rect): number {
  let floor = 1e-6;
  const consider = (dim: number) => {
    // Magnitude floor: a mirrored member (negative width/height) has the same
    // visual size as its positive twin, so scaleLayer's clampFactor floors it
    // the same way — this pre-clamp must match, or the per-layer clamp would
    // still fire and break group rigidity at the min-size boundary.
    const size = Math.abs(dim);
    if (size > 0) floor = Math.max(floor, MIN_RESIZE_MM / size);
  };
  for (const { orig } of targets) {
    if (orig.type === 'shape' || orig.type === 'image') {
      consider(orig.width);
      consider(orig.height);
    } else if (orig.type === 'text') {
      consider(orig.sizeMm);
    }
  }
  consider(bbox.width);
  consider(bbox.height);
  // Never above identity: geometry that already sits below the min-size floor
  // (e.g. a hair-thin path-only group, bbox 0.1mm wide) would otherwise get a
  // floor > 1 and be forcibly ENLARGED by any drag — including a shrink
  // attempt. Capping at 1 just means such a group cannot shrink further.
  return Math.min(floor, 1);
}

// Multi-resize grab (#52): corner handles on the combined bbox start a uniform
// group scale. multiResizeBbox (renderer.ts) is the shared eligibility gate,
// so exactly the handles the chrome draws are grabbable here.
function tryGrabMultiResizeHandle(e: ToolPointerEvent, ctx: ToolContext): boolean {
  const ids = ctx.selectedIds;
  const layers = flattenLayerNodes(ctx.doc.layers);
  const bbox = multiResizeBbox(layers, ids);
  if (!bbox) return false;
  for (const h of cornerHandleRects(bbox, ctx.camera)) {
    if (
      e.screen.x >= h.x &&
      e.screen.x <= h.x + h.size &&
      e.screen.y >= h.y &&
      e.screen.y <= h.y + h.size
    ) {
      drag = {
        kind: 'multi-resize',
        handle: h.id,
        bbox,
        startMm: e.mm,
        targets: layers
          .filter((l) => ids.includes(l.id) && l.type !== 'pattern')
          .map((l) => ({ id: l.id, orig: l })),
      };
      return true;
    }
  }
  return false;
}

registerTool({
  id: 'select',
  label: 'Select',
  shortcut: 'v',
  icon: '⬚',
  cursor: 'default',
  description:
    'Click a layer to select it and drag to move it; drag on empty canvas to marquee-select every ' +
    'layer the rectangle touches. Shift-click adds to or removes from the selection, Meta/Ctrl-click ' +
    'toggles one layer, and a plain empty-space click deselects. Dragging any member of a ' +
    'multi-selection moves the whole selection; hold Alt as the drag starts to duplicate it instead, ' +
    'and hold Shift while dragging to constrain movement to one axis. With one layer selected, drag ' +
    'its handles to resize (shapes/images, rotated shapes included) or its anchors and bezier ' +
    'handles to reshape a path, and drag the round handle above a shape or text layer to rotate it ' +
    'about its center (Shift snaps to 45° steps). With several layers selected, drag a corner of ' +
    'the combined box to scale them all uniformly about the opposite corner — hold Alt to scale ' +
    'about the center instead (patterns are unaffected). A pattern square selects on click only ' +
    'where no other layer is hit; dragging an unselected pattern draws a marquee instead, and a ' +
    'selected pattern drags like any layer (size it from the Properties panel). Arrow keys nudge ' +
    'the selection (Shift = ×10); Delete/Backspace removes it. Shortcut: V.',
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    reconcileTextGeometry(flattenLayerNodes(ctx.doc.layers), ctx.requestRepaint);
    hoveredId = null; // pointer engaged — hover chrome resumes after release
    // Right (or middle) click PRESERVES the selection: a future context menu
    // must be able to act on the live selection (#47).
    if (e.button !== 0) return;

    downScreen = e.screen;
    const selected = ctx.selectedLayer;
    // node/handle drags on the current selection win over a fresh hit-test.
    // A HIDDEN selected layer wears no chrome (selectionBboxes skips it), so
    // none of its grab targets may swallow clicks — an invisible knob would
    // rotate the hidden layer or block selecting a visible layer beneath it.
    const grabbable = selected && !selected.hidden ? selected : null;
    if (grabbable && tryGrabNode(grabbable, e, ctx)) return;
    if (grabbable && tryGrabRotateHandle(grabbable, e, ctx)) return;
    if (grabbable && tryGrabResizeHandle(grabbable, e, ctx)) return;
    // >1 selected: the combined bbox's corner handles win over a fresh
    // hit-test, same precedence as the single-selection handles above (#52).
    if (tryGrabMultiResizeHandle(e, ctx)) return;

    const hit = topmostHit(ctx, e.mm);
    const toggleModifier = e.shiftKey || e.metaKey || e.ctrlKey;
    // #97's drag rule: a press on a pattern square that is NOT already
    // selected behaves like empty space for DRAG purposes — the panel stays
    // marquee-able even with a cover-sized square under everything — while a
    // CLICK (never crossing the drag threshold) still (toggle-)selects the
    // pattern on release via the marquee's clickSelectId. A SELECTED pattern
    // takes the normal layer path below, so its next drag MOVES it.
    const unselectedPatternHit =
      hit && hit.type === 'pattern' && !ctx.selectedIds.includes(hit.id) ? hit : null;
    if (hit && !unselectedPatternHit) {
      if (toggleModifier) {
        // Modifier vocabulary (#47): Shift = add to / toggle within the
        // selection; Meta/Ctrl = toggle exactly one layer. Both toggle the
        // clicked layer's membership and leave the rest untouched; no move
        // drag starts on a modifier click.
        const ids = ctx.selectedIds;
        ctx.selectIds(ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id]);
        return;
      }
      const ids = ctx.selectedIds;
      if (ids.length > 1 && ids.includes(hit.id)) {
        // Multi-move (#49): grabbing any member drags the whole selection —
        // pattern members included since #97 (they carry an x/y/size square
        // that translates like any other layer's origin).
        drag = {
          kind: 'move',
          startMm: e.mm,
          targets: flattenLayerNodes(ctx.doc.layers)
            .filter((l) => ids.includes(l.id))
            .map((l) => ({ id: l.id, orig: l })),
          crossed: false,
          collapseTo: hit.id,
        };
        return;
      }
      ctx.select(hit.id);
      drag = {
        kind: 'move',
        startMm: e.mm,
        targets: [{ id: hit.id, orig: hit }],
        crossed: false,
        collapseTo: null,
      };
      return;
    }

    // Empty space (or an unselected pattern, per #97's drag rule above):
    // selection applies at pointerdown — a plain click clears it, a modifier
    // click preserves it (additive intent). Either way the marquee is ARMED
    // here and only materializes past the drag threshold.
    if (!toggleModifier) ctx.select(null);
    marquee = {
      startScreen: e.screen,
      startMm: e.mm,
      currentMm: e.mm,
      active: false,
      additive: toggleModifier,
      baseIds: toggleModifier ? ctx.selectedIds : [],
      clickSelectId: unselectedPatternHit?.id ?? null,
    };
  },
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    reconcileTextGeometry(flattenLayerNodes(ctx.doc.layers), ctx.requestRepaint);
    if (marquee) {
      if (!marquee.active && !pastThreshold(e.screen, marquee.startScreen)) return;
      marquee.active = true;
      marquee.currentMm = e.mm;
      const hits = marqueeHitIds(
        flattenLayerNodes(ctx.doc.layers),
        marqueeRect(marquee.startMm, marquee.currentMm),
      );
      const base = marquee.baseIds;
      ctx.selectIds(
        marquee.additive ? [...base, ...hits.filter((id) => !base.includes(id))] : hits,
      );
      ctx.requestRepaint(); // the rubber-band moved even if the selection didn't
      return;
    }
    if (!drag) {
      // Hover (#47): outline the layer under the cursor, but repaint ONLY when
      // the hovered id actually changes — #17 is an open issue about the Pen
      // hint bar re-rendering per pointermove; do not add a second instance.
      if (e.buttons === 0) {
        const id = topmostHit(ctx, e.mm)?.id ?? null;
        if (id !== hoveredId) {
          hoveredId = id;
          ctx.requestRepaint();
        }
      }
      return;
    }
    // Zoom-invariant click-vs-drag gate (#47): until the pointer has traveled
    // DRAG_THRESHOLD_PX in client space, no history entry may open.
    if (!gestureOpen && downScreen && !pastThreshold(e.screen, downScreen)) return;
    // Open the undo entry LAZILY: a pure click or a sub-snap jitter that nets a
    // zero effective change must leave history untouched (no phantom entry). We
    // only ensureGesture once the change is actually non-zero. Once the gesture
    // is open, keep streaming so a drag back toward the start still updates.
    switch (drag.kind) {
      case 'move': {
        // Everything below composes into ONE ctx.replace. Two replace calls in
        // the same event would lose the first one's changes: the Editor's
        // ctx.doc getter reads a ref that only re-syncs after React renders
        // (Editor.tsx), so the second replace would rebuild from the pre-clone
        // layer list and silently drop the clones.
        // Flatten once: this "move" case both reads (duplicateLayersAbove
        // below) and writes back a flat Layer[] — identity for a group-free
        // doc, matching the mechanical shim used across this file (#146).
        let layers = flattenLayerNodes(ctx.doc.layers);
        if (!drag.crossed) {
          // We're past the client-space threshold gate above, so THIS move is
          // the crossing moment — the one instant Alt is sampled (#49). An
          // Alt-click that never reaches here duplicates nothing and (below)
          // writes no history.
          drag.crossed = true;
          if (e.altKey) {
            // Clone insertion is a real doc change: open the (single) undo
            // entry now even if the snapped move delta is still zero.
            ensureGesture(ctx);
            const dup = duplicateLayersAbove(
              layers,
              drag.targets.map((t) => t.id),
              (source) => mintId(source.type),
            );
            layers = dup.layers;
            // Re-target the drag to the clones — the originals stay put. The
            // clone starts at its source's geometry, so keeping `orig` keeps
            // the delta math unchanged.
            drag.targets = drag.targets.map((t) => ({
              id: dup.idMap.get(t.id) ?? t.id,
              orig: t.orig,
            }));
            // Selection follows the clones — every member (patterns included
            // since #97) is cloned; the ?? fallback is pure defense for an id
            // missing from the map.
            ctx.selectIds(ctx.selectedIds.map((id) => dup.idMap.get(id) ?? id));
            drag.collapseTo = null;
          }
        }
        let dx = e.mm.x - drag.startMm.x;
        let dy = e.mm.y - drag.startMm.y;
        let xLocked = false;
        let yLocked = false;
        if (e.shiftKey) {
          // Shift constrains to the dominant axis, re-evaluated live per move
          // so the drag can flip axes without releasing.
          if (Math.abs(dx) >= Math.abs(dy)) {
            dy = 0;
            yLocked = true;
          } else {
            dx = 0;
            xLocked = true;
          }
        }
        // ONE snapped gesture delta for every target: snapping each member's
        // absolute position independently would give off-grid members
        // different effective deltas and change the selection's relative
        // spacing mid-drag. The grid baseline below is exactly that — a
        // single delta snap of the raw pointer movement, not a per-candidate
        // absolute snap — so an ungated drag (no guide in range) is
        // bit-identical to pre-#55 behavior.
        let sdx = snap(dx);
        let sdy = snap(dy);
        // Guides win ties (#53/#55) but only override the grid baseline when
        // the moving selection's combined bbox — edges + centre — actually
        // lands within catch range of a same-axis guide; a shift-locked axis
        // is skipped so a guide can never sneak in movement Shift disallowed.
        const bbox = targetsBbox(drag.targets);
        if (bbox) {
          const opts = snapOptions(ctx);
          if (!xLocked) {
            const movedX = bbox.x + dx;
            const gx = snapAxis([movedX, movedX + bbox.width, movedX + bbox.width / 2], 'x', opts);
            if (gx.guide) sdx = roundMm(dx + gx.delta);
          }
          if (!yLocked) {
            const movedY = bbox.y + dy;
            const gy = snapAxis(
              [movedY, movedY + bbox.height, movedY + bbox.height / 2],
              'y',
              opts,
            );
            if (gy.guide) sdy = roundMm(dy + gy.delta);
          }
        }
        if (!gestureOpen && sdx === 0 && sdy === 0) break;
        ensureGesture(ctx);
        const patches = new Map<string, Partial<Layer>>();
        for (const { id, orig } of drag.targets) {
          if (orig.type === 'path') {
            patches.set(id, translatePathLayer(orig, sdx, sdy));
          } else {
            // shape/text/image/pattern all translate via their x/y origin
            // (patterns joined in #97 — their square moves like an image's).
            patches.set(id, { x: addMm(orig.x, sdx), y: addMm(orig.y, sdy) });
          }
        }
        ctx.replace({
          ...ctx.doc,
          layers: layers.map((l) => {
            const patch = patches.get(l.id);
            return patch ? ({ ...l, ...patch } as Layer) : l;
          }),
        });
        break;
      }
      case 'resize': {
        const dx = e.mm.x - drag.startMm.x;
        const dy = e.mm.y - drag.startMm.y;
        const r = resizeRotatedRect(drag.orig, drag.rotation, drag.handle, dx, dy, MIN_RESIZE_MM);
        // Grid-snap only the axis-aligned case: resizeRotatedRect's anchor
        // compensation is exact trig, so independently grid-snapping x/y/w/h
        // of a rotated rect would visibly detach the anchored corner. Rotated
        // resize keeps float hygiene only.
        const patch = drag.rotation
          ? { x: roundMm(r.x), y: roundMm(r.y), width: roundMm(r.width), height: roundMm(r.height) }
          : resizeSnapPatch(drag.orig, r, drag.handle, ctx);
        if (
          !gestureOpen &&
          patch.x === drag.orig.x &&
          patch.y === drag.orig.y &&
          patch.width === drag.orig.width &&
          patch.height === drag.orig.height
        ) {
          break;
        }
        ensureGesture(ctx);
        updateLayer(ctx, drag.layerId, patch, false);
        break;
      }
      case 'multi-resize': {
        // Uniform factor from projecting the dragged corner onto the
        // corner<->anchor diagonal: motion along the diagonal scales,
        // perpendicular motion is ignored. Aspect is therefore locked by
        // construction — which is exactly why SHIFT IS A DELIBERATE NO-OP
        // here (#52, recorded): non-uniform scale of a rotated member is not
        // representable in the x/y/width/height/rotation model, and text has
        // only sizeMm. Do not "fix" Shift into an aspect toggle.
        const corner = bboxCorner(drag.bbox, drag.handle);
        // Alt re-anchors to the CENTRE, sampled live per move like Shift's
        // axis constraint in the move case — toggling mid-drag re-resolves
        // the same gesture about the new anchor.
        const anchor = e.altKey ? rectCenter(drag.bbox) : bboxCorner(drag.bbox, drag.handle, true);
        const vx = corner.x - anchor.x;
        const vy = corner.y - anchor.y;
        const len2 = vx * vx + vy * vy;
        if (len2 === 0) break; // zero-size combined bbox: nothing to scale against
        const cx = corner.x + (e.mm.x - drag.startMm.x) - anchor.x;
        const cy = corner.y + (e.mm.y - drag.startMm.y) - anchor.y;
        const f = roundMm(
          Math.max((cx * vx + cy * vy) / len2, groupFactorFloor(drag.targets, drag.bbox)),
        );
        if (!gestureOpen && f === 1) break;
        ensureGesture(ctx);
        // No grid-snap and no per-member rounding: every member recomputes
        // from its pointerdown original with the ONE shared (already rounded)
        // factor — nothing accumulates — and snapping members independently
        // would change the group's relative spacing mid-drag, the same
        // reasoning as multi-move's single gesture delta and rotated resize.
        const scaled = new Map<string, Layer>();
        for (const { id, orig } of drag.targets) {
          scaled.set(id, scaleLayer(orig, f, anchor, MIN_RESIZE_MM));
        }
        ctx.replace({
          ...ctx.doc,
          layers: ctx.doc.layers.map((l) => scaled.get(l.id) ?? l),
        });
        break;
      }
      case 'rotate': {
        let delta = pointerDeg(e.mm, drag.centerMm) - drag.startPointerDeg;
        // Shift snaps to 45° increments measured FROM the drag-start rotation,
        // not from 0 (#51): a layer already at 30° snaps to 75°, 120°, … so
        // the snap stays relative to where the gesture began.
        if (e.shiftKey) delta = Math.round(delta / 45) * 45;
        const next = normalizeDeg(drag.startRotation + delta);
        if (!gestureOpen && next === normalizeDeg(drag.startRotation)) break;
        ensureGesture(ctx);
        updateLayer(ctx, drag.layerId, { rotation: next }, false);
        break;
      }
      case 'anchor': {
        const anchorLayerId = drag.layerId;
        const layer = flattenLayerNodes(ctx.doc.layers).find((l) => l.id === anchorLayerId);
        if (layer?.type === 'path') {
          const nx = snap(e.mm.x);
          const ny = snap(e.mm.y);
          const cur = layer.points[drag.index];
          if (!gestureOpen && cur && nx === cur.x && ny === cur.y) break;
          ensureGesture(ctx);
          updateLayer(
            ctx,
            drag.layerId,
            { points: movePathAnchor(layer.points, drag.index, nx, ny) },
            false,
          );
        }
        break;
      }
      case 'handle': {
        const handleLayerId = drag.layerId;
        const layer = flattenLayerNodes(ctx.doc.layers).find((l) => l.id === handleLayerId);
        if (layer?.type === 'path') {
          const cur = layer.points[drag.index]?.[drag.which];
          if (!gestureOpen && cur && e.mm.x === cur.x && e.mm.y === cur.y) break;
          ensureGesture(ctx);
          updateLayer(
            ctx,
            drag.layerId,
            {
              points: movePathHandle(
                layer.points,
                drag.index,
                drag.which,
                e.mm.x,
                e.mm.y,
                !e.altKey,
              ),
            },
            false,
          );
        }
        break;
      }
    }
  },
  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext) {
    if (marquee?.active) ctx.requestRepaint(); // erase the rubber-band
    // Pattern click rule (#97): a press on an unselected pattern that never
    // materialized a marquee is a CLICK — (toggle-)select the pattern now,
    // mirroring the modifier vocabulary of the direct-hit path above.
    if (marquee && !marquee.active && marquee.clickSelectId !== null) {
      const id = marquee.clickSelectId;
      if (marquee.additive) {
        const ids = ctx.selectedIds;
        ctx.selectIds(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
      } else {
        ctx.select(id);
      }
    }
    // A grab on a multi-selection member that never crossed the threshold is
    // a plain CLICK — collapse the selection to that layer (standard tool
    // behavior; without this a multi-selection could never be narrowed by
    // clicking one of its members).
    if (drag?.kind === 'move' && !drag.crossed && drag.collapseTo !== null) {
      ctx.select(drag.collapseTo);
    }
    marquee = null;
    drag = null;
    gestureOpen = false;
    downScreen = null;
  },
  onPointerLeave(_e: ToolPointerEvent, ctx: ToolContext) {
    // No further pointermove will arrive to clear the hover outline — a
    // hovered layer would otherwise keep its chrome after the cursor leaves
    // the canvas. Drags/marquees keep going (pointer capture still routes
    // move/up to the canvas), so only hover state is dropped here.
    if (hoveredId !== null) {
      hoveredId = null;
      ctx.requestRepaint();
    }
  },
  onDeactivate() {
    marquee = null;
    hoveredId = null;
    drag = null;
    gestureOpen = false;
    downScreen = null;
  },
  renderDraft(d: DraftRenderContext, ctx: ToolContext) {
    reconcileTextGeometry(flattenLayerNodes(ctx.doc.layers), ctx.requestRepaint);
    // hover chrome — subtle, and skipped for layers already wearing selection
    // chrome (hoveredId is cleared on pointerdown, so nothing draws mid-drag)
    if (hoveredId && !ctx.selectedIds.includes(hoveredId)) {
      const layer = flattenLayerNodes(ctx.doc.layers).find((l) => l.id === hoveredId);
      const bbox = layer && !layer.hidden ? layerBbox(layer) : null;
      if (layer && bbox) {
        drawHoverOutline(d.ctx, rotatedRectAABB(bbox, layerRotation(layer)), d.camera);
      }
    }
    if (marquee?.active) {
      const a = d.toScreen(marquee.startMm);
      const b = d.toScreen(marquee.currentMm);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      d.ctx.save();
      d.ctx.fillStyle = MARQUEE_FILL;
      d.ctx.fillRect(x, y, w, h);
      d.ctx.strokeStyle = MARQUEE_STROKE;
      d.ctx.lineWidth = 1;
      d.ctx.strokeRect(x, y, w, h);
      d.ctx.restore();
    }
  },
});
