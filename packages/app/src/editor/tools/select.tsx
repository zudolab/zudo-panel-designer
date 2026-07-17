// Built-in select tool (V) — the reference tool for Wave 5 to copy. It shows
// every part of the contract: hit-testing, one-undo-entry gestures
// (beginGesture + streamed replace), reading LIVE ctx state mid-gesture, and
// screen<->mm conversion. Move / resize (8 handles) / path node editing all
// live here; a later wave refines this ONE file without touching the registry.
import {
  hitTestLayer,
  movePathAnchor,
  movePathHandle,
  rectsIntersect,
  resizeRect,
  rotatedRectAABB,
  snapToGrid,
  translatePathLayer,
  type DocState,
  type Layer,
  type Pt,
  type Rect,
  type ResizeHandle,
} from '@zpd/core';
import { drawHoverOutline, layerBbox, layerRotation, resizeHandleRects } from '../renderer';
import { registerTool } from '../registry/tools';
import type { DraftRenderContext, PanelDims, ToolContext, ToolPointerEvent } from '../types';

const SNAP_MM = 0.1;
const MIN_RESIZE_MM = 0.5;
const ANCHOR_GRAB_PX = 7;
const HANDLE_GRAB_PX = 6;
// Click-vs-drag threshold (#47): 4 CSS px measured in CLIENT (screen) space so
// it is zoom-invariant — at any zoom, a sub-4px press-and-release is a click.
// Mouse only; the 8px touch threshold is a deliberate, recorded exclusion
// (zpd is a desktop web app; e2e drives page.mouse).
const DRAG_THRESHOLD_PX = 4;
const MARQUEE_FILL = 'rgba(77,163,255,0.10)';
const MARQUEE_STROKE = 'rgba(77,163,255,0.9)';

const snap = (v: number) => snapToGrid(v, SNAP_MM);

type Drag =
  | { kind: 'move'; layerId: string; startMm: Pt; orig: Layer }
  | { kind: 'resize'; layerId: string; handle: ResizeHandle; orig: Rect; startMm: Pt }
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
// layers are skipped, and pattern layers are skipped per hit-test.ts's
// invariant (patterns are panel-wide and only selectable via the layer list —
// a panel-wide dot grid would otherwise join essentially every marquee).
export function marqueeHitIds(
  layers: readonly Layer[],
  rectMm: Rect,
  panel: PanelDims,
): string[] {
  const ids: string[] = [];
  for (const layer of layers) {
    if (layer.hidden || layer.type === 'pattern') continue;
    const bbox = layerBbox(layer, panel);
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

function topmostHit(doc: DocState, mm: Pt): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
    const layer = doc.layers[i];
    if (layer.hidden) continue;
    if (hitTestLayer(layer, mm.x, mm.y)) return layer;
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
  if (layerRotation(selected)) return false; // rotated bboxes aren't axis-resizable
  const bbox = layerBbox(selected, ctx.panel);
  if (!bbox) return false;
  const aabb = rotatedRectAABB(bbox, 0);
  for (const h of resizeHandleRects(aabb, ctx.camera)) {
    if (e.screen.x >= h.x && e.screen.x <= h.x + h.size && e.screen.y >= h.y && e.screen.y <= h.y + h.size) {
      drag = {
        kind: 'resize',
        layerId: selected.id,
        handle: h.id,
        orig: { x: selected.x, y: selected.y, width: selected.width, height: selected.height },
        startMm: e.mm,
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
    'toggles one layer, and a plain empty-space click deselects. With one layer selected, drag its ' +
    'handles to resize (shapes/images) or its anchors and bezier handles to reshape a path. Arrow ' +
    'keys nudge the selection (Shift = ×10); Delete/Backspace removes it. Shortcut: V.',
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    hoveredId = null; // pointer engaged — hover chrome resumes after release
    // Right (or middle) click PRESERVES the selection: a future context menu
    // must be able to act on the live selection (#47).
    if (e.button !== 0) return;

    downScreen = e.screen;
    const selected = ctx.selectedLayer;
    // node/handle drags on the current selection win over a fresh hit-test
    if (selected && tryGrabNode(selected, e, ctx)) return;
    if (selected && tryGrabResizeHandle(selected, e, ctx)) return;

    const hit = topmostHit(ctx.doc, e.mm);
    const toggleModifier = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit) {
      if (toggleModifier) {
        // Modifier vocabulary (#47): Shift = add to / toggle within the
        // selection; Meta/Ctrl = toggle exactly one layer. Both toggle the
        // clicked layer's membership and leave the rest untouched; no move
        // drag starts on a modifier click.
        const ids = ctx.selectedIds;
        ctx.selectIds(
          ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id],
        );
        return;
      }
      ctx.select(hit.id);
      drag = { kind: 'move', layerId: hit.id, startMm: e.mm, orig: hit };
      return;
    }

    // Empty space: selection applies at pointerdown — a plain click clears it,
    // a modifier click preserves it (additive intent). Either way the marquee
    // is ARMED here and only materializes past the drag threshold.
    if (!toggleModifier) ctx.select(null);
    marquee = {
      startScreen: e.screen,
      startMm: e.mm,
      currentMm: e.mm,
      active: false,
      additive: toggleModifier,
      baseIds: toggleModifier ? ctx.selectedIds : [],
    };
  },
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    if (marquee) {
      if (!marquee.active && !pastThreshold(e.screen, marquee.startScreen)) return;
      marquee.active = true;
      marquee.currentMm = e.mm;
      const hits = marqueeHitIds(
        ctx.doc.layers,
        marqueeRect(marquee.startMm, marquee.currentMm),
        ctx.panel,
      );
      const base = marquee.baseIds;
      ctx.selectIds(marquee.additive ? [...base, ...hits.filter((id) => !base.includes(id))] : hits);
      ctx.requestRepaint(); // the rubber-band moved even if the selection didn't
      return;
    }
    if (!drag) {
      // Hover (#47): outline the layer under the cursor, but repaint ONLY when
      // the hovered id actually changes — #17 is an open issue about the Pen
      // hint bar re-rendering per pointermove; do not add a second instance.
      if (e.buttons === 0) {
        const id = topmostHit(ctx.doc, e.mm)?.id ?? null;
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
        const dx = e.mm.x - drag.startMm.x;
        const dy = e.mm.y - drag.startMm.y;
        if (!gestureOpen && snap(dx) === 0 && snap(dy) === 0) break;
        ensureGesture(ctx);
        const orig = drag.orig;
        if (orig.type === 'path') {
          updateLayer(ctx, drag.layerId, translatePathLayer(orig, snap(dx), snap(dy)), false);
        } else if (orig.type !== 'pattern') {
          updateLayer(ctx, drag.layerId, { x: snap(orig.x + dx), y: snap(orig.y + dy) }, false);
        }
        break;
      }
      case 'resize': {
        const dx = e.mm.x - drag.startMm.x;
        const dy = e.mm.y - drag.startMm.y;
        const r = resizeRect(drag.orig, drag.handle, dx, dy, MIN_RESIZE_MM);
        const patch = { x: snap(r.x), y: snap(r.y), width: snap(r.width), height: snap(r.height) };
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
      case 'anchor': {
        const layer = ctx.doc.layers.find((l) => l.id === drag!.layerId);
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
        const layer = ctx.doc.layers.find((l) => l.id === drag!.layerId);
        if (layer?.type === 'path') {
          const cur = layer.points[drag.index]?.[drag.which];
          if (!gestureOpen && cur && e.mm.x === cur.x && e.mm.y === cur.y) break;
          ensureGesture(ctx);
          updateLayer(
            ctx,
            drag.layerId,
            { points: movePathHandle(layer.points, drag.index, drag.which, e.mm.x, e.mm.y, !e.altKey) },
            false,
          );
        }
        break;
      }
    }
  },
  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext) {
    if (marquee?.active) ctx.requestRepaint(); // erase the rubber-band
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
    // hover chrome — subtle, and skipped for layers already wearing selection
    // chrome (hoveredId is cleared on pointerdown, so nothing draws mid-drag)
    if (hoveredId && !ctx.selectedIds.includes(hoveredId)) {
      const layer = ctx.doc.layers.find((l) => l.id === hoveredId);
      const bbox = layer && !layer.hidden ? layerBbox(layer, ctx.panel) : null;
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
