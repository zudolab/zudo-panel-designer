// Built-in select tool (V) — the reference tool for Wave 5 to copy. It shows
// every part of the contract: hit-testing, one-undo-entry gestures
// (beginGesture + streamed replace), reading LIVE ctx state mid-gesture, and
// screen<->mm conversion. Move / resize (8 handles) / path node editing all
// live here; a later wave refines this ONE file without touching the registry.
import {
  hitTestLayer,
  movePathAnchor,
  movePathHandle,
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
import { layerBbox, layerRotation, resizeHandleRects } from '../renderer';
import { registerTool } from '../registry/tools';
import type { ToolContext, ToolPointerEvent } from '../types';

const SNAP_MM = 0.1;
const MIN_RESIZE_MM = 0.5;
const ANCHOR_GRAB_PX = 7;
const HANDLE_GRAB_PX = 6;

const snap = (v: number) => snapToGrid(v, SNAP_MM);

type Drag =
  | { kind: 'move'; layerId: string; startMm: Pt; orig: Layer }
  | { kind: 'resize'; layerId: string; handle: ResizeHandle; orig: Rect; startMm: Pt }
  | { kind: 'anchor'; layerId: string; index: number }
  | { kind: 'handle'; layerId: string; index: number; which: 'hin' | 'hout' };

let drag: Drag | null = null;
let gestureOpen = false;

function ensureGesture(ctx: ToolContext): void {
  if (!gestureOpen) {
    gestureOpen = true;
    ctx.beginGesture();
  }
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
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    const selected = ctx.selectedLayer;
    // node/handle drags on the current selection win over a fresh hit-test
    if (selected && tryGrabNode(selected, e, ctx)) return;
    if (selected && tryGrabResizeHandle(selected, e, ctx)) return;

    const hit = topmostHit(ctx.doc, e.mm);
    if (hit) {
      ctx.select(hit.id);
      drag = { kind: 'move', layerId: hit.id, startMm: e.mm, orig: hit };
    } else {
      ctx.select(null);
    }
  },
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    if (!drag) return;
    switch (drag.kind) {
      case 'move': {
        ensureGesture(ctx);
        const dx = e.mm.x - drag.startMm.x;
        const dy = e.mm.y - drag.startMm.y;
        const orig = drag.orig;
        if (orig.type === 'path') {
          updateLayer(ctx, drag.layerId, translatePathLayer(orig, snap(dx), snap(dy)), false);
        } else if (orig.type !== 'pattern') {
          updateLayer(ctx, drag.layerId, { x: snap(orig.x + dx), y: snap(orig.y + dy) }, false);
        }
        break;
      }
      case 'resize': {
        ensureGesture(ctx);
        const dx = e.mm.x - drag.startMm.x;
        const dy = e.mm.y - drag.startMm.y;
        const r = resizeRect(drag.orig, drag.handle, dx, dy, MIN_RESIZE_MM);
        updateLayer(
          ctx,
          drag.layerId,
          { x: snap(r.x), y: snap(r.y), width: snap(r.width), height: snap(r.height) },
          false,
        );
        break;
      }
      case 'anchor': {
        ensureGesture(ctx);
        const layer = ctx.doc.layers.find((l) => l.id === drag!.layerId);
        if (layer?.type === 'path') {
          updateLayer(
            ctx,
            drag.layerId,
            { points: movePathAnchor(layer.points, drag.index, snap(e.mm.x), snap(e.mm.y)) },
            false,
          );
        }
        break;
      }
      case 'handle': {
        ensureGesture(ctx);
        const layer = ctx.doc.layers.find((l) => l.id === drag!.layerId);
        if (layer?.type === 'path') {
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
  onPointerUp() {
    drag = null;
    gestureOpen = false;
  },
  onDeactivate() {
    drag = null;
    gestureOpen = false;
  },
});
