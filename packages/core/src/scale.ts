// Uniform multi-layer scale about a fixed anchor point, mm space. Uniform-only
// by design (see issue #50): non-uniform scaling of a rotated rect is not
// representable in the x/y/width/height/rotation model (it would need a shear
// term), and text has no independent width/height — only sizeMm. Uniform scale
// commutes with rotation, which is exactly why rotation is PRESERVED untouched
// here, never recomputed.
import type { Pt } from './bbox';
import { DEFAULT_MIN_SIZE_MM } from './resize';
import type { Layer, PathLayer, PathPoint } from './types';

function scaleCoord(value: number, anchor: number, factor: number): number {
  return anchor + (value - anchor) * factor;
}

function scalePt(pt: Pt, anchorPt: Pt, factor: number): Pt {
  return {
    x: scaleCoord(pt.x, anchorPt.x, factor),
    y: scaleCoord(pt.y, anchorPt.y, factor),
  };
}

function scalePathPoint(point: PathPoint, anchorPt: Pt, factor: number): PathPoint {
  const scaled: PathPoint = { ...point, ...scalePt(point, anchorPt, factor) };
  if (point.hin) scaled.hin = scalePt(point.hin, anchorPt, factor);
  if (point.hout) scaled.hout = scalePt(point.hout, anchorPt, factor);
  return scaled;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Scales the rect's CENTER about the anchor, then clamps width/height at
// minSize (same clamp floor semantics as resize.ts). While unclamped this is
// identical to scaling the top-left directly; once a dimension clamps, keeping
// the scaled center fixed is what preserves the visual position — rotation
// pivots on the center, so a clamped rotated rect stays visually put.
function scaleRectLike(rect: RectLike, factor: number, anchorPt: Pt, minSize: number): RectLike {
  const cx = scaleCoord(rect.x + rect.width / 2, anchorPt.x, factor);
  const cy = scaleCoord(rect.y + rect.height / 2, anchorPt.y, factor);
  const width = Math.max(minSize, rect.width * factor);
  const height = Math.max(minSize, rect.height * factor);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

// Pure uniform scale of a single layer about anchorPt (mm). factor must be
// positive — group-level interaction code derives it from a corner-handle drag.
// Eligibility matrix (issue #50): shape/image scale x/y/width/height; text
// scales x/y and sizeMm; path scales every anchor point, its hin/hout bezier
// handles, and extraSubpaths; pattern is panel-wide and returned unchanged.
export function scaleLayer(
  layer: Layer,
  factor: number,
  anchorPt: Pt,
  minSize: number = DEFAULT_MIN_SIZE_MM,
): Layer {
  switch (layer.type) {
    case 'shape':
    case 'image':
      return { ...layer, ...scaleRectLike(layer, factor, anchorPt, minSize) };
    case 'text':
      return {
        ...layer,
        ...scalePt(layer, anchorPt, factor),
        sizeMm: Math.max(minSize, layer.sizeMm * factor),
      };
    case 'path': {
      const scaled: PathLayer = {
        ...layer,
        points: layer.points.map((point) => scalePathPoint(point, anchorPt, factor)),
      };
      if (layer.extraSubpaths) {
        scaled.extraSubpaths = layer.extraSubpaths.map((subpath) =>
          subpath.map((point) => scalePathPoint(point, anchorPt, factor)),
        );
      }
      return scaled;
    }
    case 'pattern':
      return layer;
  }
}
