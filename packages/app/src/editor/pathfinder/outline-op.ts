/**
 * Path Finder — Outline op (edge extraction).
 *
 * Illustrator's **Outline**: divide the selection into its component EDGES.
 * Every input contour's segments are split at all their intersections — with
 * other inputs, with other segments of the same input (self-intersecting pen
 * paths), and at a single cubic's own loop — and each resulting piece is emitted
 * as an OPEN, UNFILLED path whose STROKE is the source input's FILL colour.
 *
 * That open/unfilled shape is correct Pathfinder behaviour and is deliberate.
 * It is NOT stroke expansion: nothing here turns a stroked centreline into a
 * filled outline polygon (the Gerber thread owns that separately, and the
 * geometry kernel's README says the same about itself).
 *
 * ── Edge granularity ────────────────────────────────────────────────────────
 * The atomic unit is one input SEGMENT (a cubic between two anchors), exactly
 * as Illustrator behaves — Outline of a lone rectangle gives its 4 sides.
 * Anchors are therefore natural edge boundaries, and intersections subdivide a
 * segment further. Two overlapping rects (2 crossings) → 12 edges: each rect is
 * 4 sides, and its 2 crossed sides split in two.
 *
 * ── Why this design cannot emit wrong geometry ──────────────────────────────
 * No edge graph, no winding, no face reconstruction. Real cubics are split at
 * intersection PARAMETERS from the kernel (`segmentIntersection` /
 * `cubicSelfIntersection`) via exact de Casteljau subdivision (`splitCubicAt`),
 * so every emitted piece is an exact sub-Bézier of a real input contour. The
 * only possible failure is over- or under-segmentation, and a reported crossing
 * that does not actually coincide is skipped ({@link COINCIDENCE_TOLERANCE})
 * rather than used to cut geometry.
 *
 * ── Documented deviation from Illustrator ───────────────────────────────────
 * Edges get a visible default stroke width instead of Illustrator's invisible
 * 0 pt — see {@link OUTLINE_EDGE_STROKE_WIDTH_MM}.
 */

import { pcbLayerDefinition, type ColorIndex, type PathPoint } from '@zpd/core';
import {
  createBooleanEngine,
  sampleCubicAt,
  splitCubicAt,
  type BooleanEngine,
  type KernelCubic,
  type KernelPathSpec,
  type KernelPoint,
  type KernelRing,
} from '../geometry-kernel';
import { bakeExtraSubpaths, bakePathContour, bakeShapeLeaf } from './convert';
import { pathfinderTarget } from './selection';
import { resolveInputStyle } from './style';
import type { EligibleLeaf, PathfinderOpResult } from './types';

/** Below this (mm) a handle sits on its anchor and is omitted. Mirrors convert.ts. */
const HANDLE_EPS = 1e-9;
/**
 * Curve-parameter tolerance: intersection params within this of 0 or 1 are the
 * segment's own endpoints (adjacent contour segments report their shared anchor
 * as a t≈0/t≈1 "intersection"), not real interior cuts, so they are dropped.
 * Also the merge tolerance when de-duplicating cut params on one segment.
 * Coarser than path-bool's internal `param` (1e-8) so near-endpoint crossings
 * do not produce slivers, far finer than the spacing between distinct crossings.
 * Dimensionless — a curve parameter, not a length — so the px→mm move is a no-op.
 */
const PARAM_EPS = 1e-6;
/**
 * A reported crossing is accepted only if the two segments, sampled at their
 * respective params, land within this distance (mm). A real path-bool crossing
 * coincides to within its own `linear` tolerance (1e-4); a bogus param lands far
 * off. Scaled from pgen's composition-pixel value to keep the same ~100×
 * headroom over that backend tolerance while staying far below the ~0.1 mm
 * minimum fabricable feature.
 */
const COINCIDENCE_TOLERANCE = 1e-2;
/** Control-polygon length below which a split piece is a collapsed sliver. */
const DEGENERATE_PIECE_EPS = 1e-6;
/**
 * Stroke width for every emitted edge, mm. Illustrator gives Outline edges a
 * 0 pt (invisible) stroke; an invisible result reads as "the op did nothing" in
 * zpd, so edges take the same 0.6 mm the pen tool gives a freshly drawn OPEN
 * path — the app's own notion of a visible drawn line.
 */
export const OUTLINE_EDGE_STROKE_WIDTH_MM = 0.6;

/** One source contour baked to world-mm segments, tagged with its edge style. */
interface BakedContour {
  segments: KernelCubic[];
  /** Colour the edges stroke with = the source input's fill (with fallbacks). */
  strokeColor: ColorIndex;
  name: string;
}

/**
 * Bake one eligible leaf into all of its DRAWN world-mm contours.
 *
 * Shapes and closed paths contribute their full ring. An OPEN path contributes
 * only its drawn anchor-to-anchor segments: `bakePathContour` always appends the
 * implicit straight closing segment (Shape Modes need a closed region), so for
 * an open outer contour it is dropped here. `extraSubpaths` are always closed.
 *
 * Contours are baked directly rather than through `leafToKernelInput`, which
 * rejects a collinear contour as degenerate — correct for a fill boolean, wrong
 * for Outline, which must still emit the edges of a perfectly straight open path.
 */
function bakeContours(leaf: EligibleLeaf): BakedContour[] {
  const layer = leaf.layer;
  const style = resolveInputStyle(leaf);
  // Edge stroke = source FILL colour. With no fill, fall back to the source's
  // stroke, then to the material's own colour, so an edge is never invisible.
  const strokeColor = style.fill ?? style.stroke ?? pcbLayerDefinition(leaf.role).color;

  const contours: { ring: KernelRing; closed: boolean }[] =
    layer.type === 'path'
      ? [
          { ring: bakePathContour(layer.points, layer.closed), closed: layer.closed },
          ...bakeExtraSubpaths(layer).map((ring) => ({ ring, closed: true })),
        ]
      : [{ ring: bakeShapeLeaf(layer), closed: true }];

  return contours.flatMap(({ ring, closed }, contourIndex) => {
    if (ring.length === 0) return [];
    // Only contour zero can be the open outer path; every extra subpath is
    // closed above and keeps its final segment back to its start.
    const segments = contourIndex === 0 && !closed ? ring.slice(0, -1) : ring;
    return segments.length > 0 ? [{ segments, strokeColor, name: layer.name }] : [];
  });
}

/** Do the two segments actually meet at the reported params? (bogus-crossing guard) */
function paramsCoincide(a: KernelCubic, ta: number, b: KernelCubic, tb: number): boolean {
  const pa = sampleCubicAt(a, ta);
  const pb = sampleCubicAt(b, tb);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= COINCIDENCE_TOLERANCE;
}

/** Record a cut param iff it is a real interior cut, not the segment's endpoint. */
function addInteriorParam(list: number[], t: number): void {
  if (t > PARAM_EPS && t < 1 - PARAM_EPS) list.push(t);
}

/** Sort ascending and merge params within {@link PARAM_EPS} (one crossing, hit from both sides). */
function dedupeParams(params: number[]): number[] {
  if (params.length <= 1) return params;
  const sorted = [...params].sort((x, y) => x - y);
  const out: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - out[out.length - 1]! > PARAM_EPS) out.push(sorted[i]!);
  }
  return out;
}

/**
 * Split one cubic at sorted interior params into consecutive sub-cubics via
 * exact de Casteljau subdivision (no polyline flattening — curves survive).
 * `k` params → `k + 1` pieces; each cut is re-parametrized onto the remaining
 * tail so absolute params map correctly.
 */
function splitCubicAtParams(cubic: KernelCubic, params: number[]): KernelCubic[] {
  if (params.length === 0) return [cubic];
  const pieces: KernelCubic[] = [];
  let rest = cubic;
  let previous = 0;
  for (const t of params) {
    const local = (t - previous) / (1 - previous);
    const { left, right } = splitCubicAt(rest, local);
    pieces.push(left);
    rest = right;
    previous = t;
  }
  pieces.push(rest);
  return pieces;
}

/** Control-polygon length — a cheap "does this piece have any extent" measure. */
function controlPolygonLength(c: KernelCubic): number {
  return (
    Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y) +
    Math.hypot(c.c2.x - c.c1.x, c.c2.y - c.c1.y) +
    Math.hypot(c.p3.x - c.c2.x, c.p3.y - c.c2.y)
  );
}

/** One end of an open edge: an anchor plus its absolute-mm handle, if any. */
function endPoint(anchor: KernelPoint, handle: KernelPoint, key: 'hin' | 'hout'): PathPoint {
  const p: PathPoint = { x: anchor.x, y: anchor.y };
  if (Math.abs(handle.x - anchor.x) > HANDLE_EPS || Math.abs(handle.y - anchor.y) > HANDLE_EPS) {
    p[key] = { x: handle.x, y: handle.y };
  }
  return p;
}

/**
 * One sub-cubic edge → an OPEN, unfilled spec with the source fill as its
 * stroke. Points stay in world mm — there is no transform to localize into.
 */
function cubicToOpenSpec(
  cubic: KernelCubic,
  strokeColor: ColorIndex,
  name: string,
): KernelPathSpec {
  return {
    points: [endPoint(cubic.p0, cubic.c1, 'hout'), endPoint(cubic.p3, cubic.c2, 'hin')],
    closed: false,
    fill: null,
    stroke: strokeColor,
    strokeWidth: OUTLINE_EDGE_STROKE_WIDTH_MM,
    name,
  };
}

/**
 * Outline entrypoint. Async and shaped like the sibling ops so one dispatcher
 * can drive all ten; a caller may inject a shared engine.
 *
 * Gating is ≥1 input — a single self-intersecting path outlines at its crossing.
 * Input ORDER is irrelevant to the geometry (edge extraction is symmetric), but
 * it still decides where the result lands (`pathfinderTarget`).
 *
 * An empty `specs` array is the no-op signal: the caller commits nothing.
 */
export async function outlineOp(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < 1) return { specs: [], target: null };
  const eng = engine ?? (await createBooleanEngine());

  // Flatten every input contour's segments into one list, each tagged with its
  // source edge style/name. Leaf order, then contour source order, then segment
  // order are retained. Same-contour, cross-contour and cross-input segments are
  // treated uniformly, so inner-boundary crossings split exactly like outer ones.
  const allSegments: { cubic: KernelCubic; strokeColor: ColorIndex; name: string }[] = [];
  for (const leaf of orderedInputs) {
    for (const contour of bakeContours(leaf)) {
      for (const cubic of contour.segments) {
        allSegments.push({ cubic, strokeColor: contour.strokeColor, name: contour.name });
      }
    }
  }
  if (allSegments.length === 0) return { specs: [], target: null };

  const params: number[][] = allSegments.map(() => []);

  // (1) Self-intersections of a single cubic (a loop crosses itself → 2 params).
  for (let i = 0; i < allSegments.length; i++) {
    const self = eng.cubicSelfIntersection(allSegments[i]!.cubic);
    if (self) {
      addInteriorParam(params[i]!, self[0]);
      addInteriorParam(params[i]!, self[1]);
    }
  }

  // (2) Crossings between every distinct pair of segments. Adjacent same-contour
  // segments report only their shared endpoint (t≈0/1), filtered by
  // addInteriorParam; genuine interior crossings are kept.
  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      for (const hit of eng.segmentIntersection(allSegments[i]!.cubic, allSegments[j]!.cubic)) {
        if (!paramsCoincide(allSegments[i]!.cubic, hit.t0, allSegments[j]!.cubic, hit.t1)) continue;
        addInteriorParam(params[i]!, hit.t0);
        addInteriorParam(params[j]!, hit.t1);
      }
    }
  }

  const specs: KernelPathSpec[] = [];
  for (let i = 0; i < allSegments.length; i++) {
    const segment = allSegments[i]!;
    for (const piece of splitCubicAtParams(segment.cubic, dedupeParams(params[i]!))) {
      if (controlPolygonLength(piece) < DEGENERATE_PIECE_EPS) continue;
      specs.push(cubicToOpenSpec(piece, segment.strokeColor, segment.name));
    }
  }
  if (specs.length === 0) return { specs: [], target: null };
  return { specs, target: pathfinderTarget(orderedInputs) };
}
