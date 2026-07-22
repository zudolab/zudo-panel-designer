// Bakes a shared rotation into individual layers about a pivot supplied by
// the caller (analog of scale.ts, which bakes a shared scale about a shared
// anchor). Callers own the gesture/session state; this module is pure math:
// given a start layer + start center + pivot + delta, produce the rotated
// layer. Re-invoking with the same inputs must reproduce the same output —
// the multi/group-rotate gesture re-bakes from each leaf's CAPTURED start
// every tick rather than compounding deltas onto a live value, so this
// function must never accumulate state of its own.
import { rotatePoint, type Pt } from './bbox';
import { rotatePathLayer } from './path-geometry';
import type { Layer, PathLayer } from './types';

// Streamed rotations stay inspector-friendly: [-180, 180), 0.1° resolution.
// Matches the existing single-rotate drag's own normalizeDeg (select.tsx) —
// duplicated rather than imported because that helper is app-local; the two
// must nonetheless stay bit-identical so a layer's rotation reads the same
// whether it came from the single-drag path or the new group-rotate path.
export function normalizeRotationDeg(deg: number): number {
  return Number(((((deg % 360) + 540) % 360) - 180).toFixed(1));
}

// Rotate eligibility for the bake (broader than the app's single-layer
// `canRotate`, which gates only shape/text/image because those are the sole
// types with an own `rotation` field for the single-drag handle). Path has no
// rotation field but still bakes via point geometry, so it's eligible here;
// only pattern keeps its established second-class transform behavior (same
// exclusion as multi-scale, #97).
export function rotatableLayer(layer: Layer): boolean {
  return layer.type !== 'pattern';
}

// Orbits a single layer's center about `pivot` by `deltaDeg` (clockwise,
// matching ctx.rotate()/rotatePoint's y-down convention) and folds `deltaDeg`
// into the layer's own `rotation`. Per-kind baking:
// - shape/text/image: `ownCenter` orbits the pivot; the layer is translated by
//   the same vector its center moved (equivalent to recomputing bbox
//   top-left from the orbited center, since width/height never change), and
//   own rotation becomes `normalizeRotationDeg((layer.rotation ?? 0) + deltaDeg)`.
// - path: no rotation field — bakes geometry instead. Every anchor point,
//   its hin/hout handles, and every extraSubpaths point rotate about `pivot`
//   directly; `ownCenter` is unused.
// - pattern: returned unchanged, by reference (excluded per the multi-scale
//   precedent — the inspector owns pattern sizing/placement).
//
// `ownCenter` is supplied by the caller, never computed here: for text
// layers only the app's canvas-measured bbox center is accurate (core's text
// bbox estimate is a rough Node-side fallback), so the gesture captures real
// centers at pointerdown and passes them in per layer.
export function rotateLayerAboutPivot(
  layer: Layer,
  ownCenter: Pt,
  pivot: Pt,
  deltaDeg: number,
): Layer {
  switch (layer.type) {
    case 'shape':
    case 'text':
    case 'image': {
      const newCenter = rotatePoint(ownCenter, pivot, deltaDeg);
      return {
        ...layer,
        x: layer.x + (newCenter.x - ownCenter.x),
        y: layer.y + (newCenter.y - ownCenter.y),
        // Keep the parentheses: `layer.rotation ?? 0 + deltaDeg` would parse
        // as `layer.rotation ?? (0 + deltaDeg)`, silently dropping the delta
        // whenever the layer already has a rotation (a real bug pgen shipped).
        rotation: normalizeRotationDeg((layer.rotation ?? 0) + deltaDeg),
      };
    }
    case 'path': {
      const rotated = rotatePathLayer(layer, pivot, deltaDeg);
      return { ...layer, ...rotated } as PathLayer;
    }
    case 'pattern':
      return layer;
  }
}

// Batch form for a combined/group-rotate selection. `centersById` holds each
// rotatable layer's own pre-rotation center (path/pattern entries are never
// read: path bakes via point geometry about `pivot` directly and pattern is
// excluded). A layer missing from `centersById` is left unchanged rather than
// guessed at — centers are the caller's responsibility, never computed here.
export function rotateLayersAboutPivot(
  layers: Layer[],
  centersById: Record<string, Pt>,
  pivot: Pt,
  deltaDeg: number,
): Layer[] {
  return layers.map((layer) => {
    if (!rotatableLayer(layer)) return layer;
    if (layer.type === 'path') return rotateLayerAboutPivot(layer, pivot, pivot, deltaDeg);
    const ownCenter = centersById[layer.id];
    if (!ownCenter) return layer;
    return rotateLayerAboutPivot(layer, ownCenter, pivot, deltaDeg);
  });
}
