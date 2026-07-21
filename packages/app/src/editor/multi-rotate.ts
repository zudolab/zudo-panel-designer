// Multi/group-rotate gesture math (#152) — the pure session layer between the
// select tool's pointer handling and core's rotate bake. Split from
// tools/select.tsx so the SAME capture/apply pair can be driven by a numeric
// delta input later (#157) without re-plumbing pointer state: capture once,
// then bake any delta from the frozen session.
//
// Lifecycle contract (mirrors the reference implementation, pgen §13.5):
// - Everything here is captured at pointerdown and FROZEN: the rotatable leaf
//   set, per-leaf start snapshots, per-leaf centers, the combined start
//   bounds, and the pivot. A tick re-bakes every leaf from its captured start
//   — never cumulatively from live state (compounding rounding would drift
//   the orbit).
// - The pivot/bounds derive from the ROTATABLE editable leaves ONLY: a big
//   unrotatable pattern in the selection must not displace the pivot of the
//   content that actually rotates.
import {
  mapLeavesById,
  mergeBboxes,
  normalizeRect,
  rectCenter,
  rotatedRectAABB,
  rotateLayersAboutPivot,
  type Layer,
  type LayerNode,
  type Pt,
  type Rect,
} from '@zpd/core';
import { layerBbox, layerRotation } from './renderer';
import { resolveSelectionLeaves } from './selection-resolve';

export interface MultiRotateSession {
  // Rotatable editable leaf ids (#151's rotatableLeafIds) — patterns and
  // hidden leaves are already excluded.
  leafIds: string[];
  // Each leaf as it was at capture — every bake starts from these.
  startSnapshots: Layer[];
  // Per-leaf pre-rotation centers via the canonical app-side layerBbox — this
  // is how TEXT gets a correct pivot (core's own text bbox is a rough
  // Node-side estimate; see renderer.ts #45). Keyed for rotateLayersAboutPivot.
  centersById: Record<string, Pt>;
  // Frozen combined start bounds of the rotatable leaves (rotation-aware AABB
  // union) and its center, the gesture pivot. Also what the mid-gesture
  // chrome draws, ctx-rotated by the live delta.
  bounds: Rect;
  pivot: Pt;
}

// Captures the frozen gesture session at pointerdown, or null when the
// selection has no rotatable editable leaf with measurable bounds — the same
// "nothing would change" condition under which no knob is drawn or grabbable.
export function captureMultiRotateSession(
  tree: LayerNode[],
  selectedIds: readonly string[],
  flatLayers: readonly Layer[],
): MultiRotateSession | null {
  const { rotatableLeafIds } = resolveSelectionLeaves(tree, selectedIds, flatLayers);
  if (rotatableLeafIds.length === 0) return null;
  const wanted = new Set(rotatableLeafIds);
  const startSnapshots = flatLayers.filter((l) => wanted.has(l.id));
  const centersById: Record<string, Pt> = {};
  const boxes: Rect[] = [];
  for (const layer of startSnapshots) {
    const raw = layerBbox(layer);
    // A rotatable leaf without measurable bounds (e.g. text with an invalid
    // size) stays in the set but gets no center — core's batch bake leaves a
    // center-less layer unchanged rather than guessing.
    if (!raw) continue;
    centersById[layer.id] = rectCenter(raw);
    boxes.push(normalizeRect(rotatedRectAABB(raw, layerRotation(layer))));
  }
  if (boxes.length === 0) return null;
  const bounds = mergeBboxes(boxes);
  return {
    leafIds: rotatableLeafIds,
    startSnapshots,
    centersById,
    bounds,
    pivot: rectCenter(bounds),
  };
}

// Re-bakes the WHOLE delta onto the frozen start snapshots and lands the
// result wherever each leaf sits in `tree` (recursive write, #150).
// Idempotent by construction: the same (session, deltaDeg) always produces
// the same tree, so streaming ticks never accumulate rounding error. This is
// the one apply path — the pointer gesture and #157's numeric input both
// feed a delta through here.
export function bakeMultiRotate(
  tree: LayerNode[],
  session: MultiRotateSession,
  deltaDeg: number,
): LayerNode[] {
  const rotated = rotateLayersAboutPivot(
    [...session.startSnapshots],
    session.centersById,
    session.pivot,
    deltaDeg,
  );
  const byId = new Map(rotated.map((l) => [l.id, l]));
  return mapLeavesById(tree, session.leafIds, (l) => byId.get(l.id) ?? l);
}

// Unwraps a raw pointer-angle offset across the atan2 ±180° branch cut: picks
// the mod-360 representative of `rawOffsetDeg` closest to the PREVIOUS tick's
// delta, so the signed delta accumulates continuously past ±180° (and keeps
// the badge signed) instead of jumping by 360. The baked geometry is
// mod-360-equivalent either way — this is about delta continuity.
export function unwrapRotateDelta(rawOffsetDeg: number, prevDeltaDeg: number): number {
  return rawOffsetDeg - 360 * Math.round((rawOffsetDeg - prevDeltaDeg) / 360);
}

// Shift snaps the DELTA to 45° increments measured from gesture start —
// relative snap, coexisting with the single-layer rotate's own snap (#51),
// which stays byte-identical in select.tsx. Free rotation rounds the delta to
// 0.1°. No grid/guide snapping participates in a rotate gesture.
export function snapRotateDelta(unwrappedDeg: number, shiftKey: boolean): number {
  return shiftKey ? Math.round(unwrappedDeg / 45) * 45 : Number(unwrappedDeg.toFixed(1));
}
