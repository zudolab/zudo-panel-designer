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

// Min-size clamping must not break uniformity: clamping width/height
// independently after scaling would change the aspect ratio at the minSize
// floor (and drift positions scaled by the unclamped factor). Instead the
// FACTOR itself is raised just enough that the smallest dimension lands
// exactly on minSize, and that one effective factor drives every coordinate
// and dimension of the layer. Same clamp floor as resize.ts, applied
// uniform-scale-wise.
function clampFactor(factor: number, dimensions: number[], minSize: number): number {
  let clamped = factor;
  for (const dimension of dimensions) {
    // Floor from the MAGNITUDE: a mirrored layer (negative width/height, which
    // the inspectors permit) has the same visual size as its positive twin and
    // must clamp identically. scaleLayer multiplies the signed dimension by the
    // returned factor, so the sign is preserved downstream.
    const size = Math.abs(dimension);
    if (size > 0) clamped = Math.max(clamped, minSize / size);
  }
  return clamped;
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
    case 'image': {
      const f = clampFactor(factor, [layer.width, layer.height], minSize);
      return {
        ...layer,
        ...scalePt(layer, anchorPt, f),
        width: layer.width * f,
        height: layer.height * f,
      };
    }
    case 'text': {
      const f = clampFactor(factor, [layer.sizeMm], minSize);
      return { ...layer, ...scalePt(layer, anchorPt, f), sizeMm: layer.sizeMm * f };
    }
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
