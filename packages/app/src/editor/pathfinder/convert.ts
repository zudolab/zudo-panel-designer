/**
 * Path Finder — layer ↔ kernel conversion.
 *
 *   (a) `PathLayer`  → compound kernel input  (`leafToKernelInput`)
 *   (b) `ShapeLayer` → one closed kernel ring (`bakeShapeLeaf`)
 *   (c) kernel result rings → `KernelPathSpec[]` (`ringsToSpecs`)
 *
 * ── Why this file is so much smaller than pgen's ────────────────────────────
 * pgen's `convert.ts` was dominated by `pathProjector`: a bbox-fit scale plus a
 * centre rotation, applied on the way IN so a boolean matched what the composer
 * painted, and re-derived on the way OUT into a fresh transform struct. zpd
 * stores every leaf's geometry in world millimetres with absolute mm handles
 * and `PathLayer` has no transform and no rotation field at all — so there is
 * nothing to project in either direction. That projector is DELETED, not
 * adapted, and with it goes the local↔composition normalization of the output.
 * `ShapeLayer.rotation` is the one rotation left, and it is baked here with
 * `@zpd/core`'s `rotatePoint` (the kernel deliberately does not re-implement it).
 */

import {
  normalizeRect,
  rectCenter,
  rotatePoint,
  type PathLayer,
  type PathPoint,
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import {
  flattenRing,
  KAPPA,
  pointInPolygon,
  reverseRing,
  ringInteriorPoint,
  ringSignedArea,
  type KernelCubic,
  type KernelInput,
  type KernelPathSpec,
  type KernelPoint,
  type KernelRing,
} from '../geometry-kernel';
import type { EligibleLeaf, ResolvedInputStyle } from './types';

/**
 * A handle offset below this collapses to "no handle" (a straight edge).
 * Compared against a DIFFERENCE of two mm coordinates, so it is ~7 orders of
 * magnitude below the kernel's 1e-4 mm snap grid: nothing the boolean could
 * have meant as real curvature is discarded here.
 */
const HANDLE_EPS = 1e-9;

/**
 * Degenerate-contour tolerance. The load-bearing branch is RELATIVE (distance
 * from the contour's own extent), so this number is dimensionless there and
 * survived the px→mm move unchanged; the absolute branch only screens
 * contours that have collapsed to a single point.
 */
const DEGENERATE_CONTOUR_EPS = 1e-9;

const point = (p: Pt): KernelPoint => ({ x: p.x, y: p.y });

// ─── (a) + (b) leaf → world-mm cubic ring ──────────────────────────────────

/**
 * Bake one subpath's anchors + absolute handles into a closed cubic ring.
 *
 * This is also the exact INVERSE of `ringToPathPoints`, which is what makes the
 * compound round-trip (spec → rings → spec) lossless and lets tests re-derive a
 * spec's geometry without a second implementation.
 *
 * An OPEN outer subpath still returns a closed ring: its final segment is the
 * implicit straight closure, because Shape Modes need a closed region (matching
 * Illustrator's treatment of open inputs). The Outline op works on the raw open
 * geometry instead and drops that phantom segment itself.
 */
export function bakePathContour(points: readonly PathPoint[], closed: boolean): KernelRing {
  const n = points.length;
  if (n < 2) return [];

  const ring: KernelRing = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    ring.push({
      p0: point(a),
      c1: point(a.hout ?? a),
      c2: point(b.hin ?? b),
      p3: point(b),
    });
  }

  const last = points[n - 1]!;
  const first = points[0]!;
  ring.push(
    closed
      ? {
          p0: point(last),
          c1: point(last.hout ?? last),
          c2: point(first.hin ?? first),
          p3: point(first),
        }
      : { p0: point(last), c1: point(last), c2: point(first), p3: point(first) },
  );
  return ring;
}

/** Bake a path leaf's primary subpath into one closed world-mm ring. */
export function bakePathLeaf(layer: PathLayer): KernelRing {
  return bakePathContour(layer.points, layer.closed);
}

/**
 * True when a ring has no finite two-dimensional extent.
 *
 * Rejects empty / collapsed / collinear contours WITHOUT using signed area: a
 * valid self-intersecting contour can have cancelling signed lobes and must
 * still reach the boolean backend intact.
 */
export function isDegenerateContour(ring: KernelRing): boolean {
  if (ring.length === 0) return true;
  const points = ring.flatMap((segment) => [segment.p0, segment.c1, segment.c2, segment.p3]);
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return true;

  const origin = points[0]!;
  const directionPoint = points.find(
    (p) => Math.hypot(p.x - origin.x, p.y - origin.y) > DEGENERATE_CONTOUR_EPS,
  );
  if (!directionPoint) return true;

  const dx = directionPoint.x - origin.x;
  const dy = directionPoint.y - origin.y;
  const directionLength = Math.hypot(dx, dy);
  const extent = Math.max(1, ...points.map((p) => Math.hypot(p.x - origin.x, p.y - origin.y)));
  const maxLineDistance = DEGENERATE_CONTOUR_EPS * extent;
  return points.every(
    (p) =>
      Math.abs(dx * (p.y - origin.y) - dy * (p.x - origin.x)) / directionLength <= maxLineDistance,
  );
}

function straightCubic(p0: KernelPoint, p3: KernelPoint): KernelCubic {
  return { p0, c1: p0, c2: p3, p3 };
}

function rectAxisRing(x: number, y: number, w: number, h: number): KernelRing {
  const tl = { x, y };
  const tr = { x: x + w, y };
  const br = { x: x + w, y: y + h };
  const bl = { x, y: y + h };
  return [
    straightCubic(tl, tr),
    straightCubic(tr, br),
    straightCubic(br, bl),
    straightCubic(bl, tl),
  ];
}

function ellipseAxisRing(cx: number, cy: number, rx: number, ry: number): KernelRing {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const right = { x: cx + rx, y: cy };
  const bottom = { x: cx, y: cy + ry };
  const left = { x: cx - rx, y: cy };
  const top = { x: cx, y: cy - ry };
  return [
    { p0: right, c1: { x: cx + rx, y: cy + ky }, c2: { x: cx + kx, y: cy + ry }, p3: bottom },
    { p0: bottom, c1: { x: cx - kx, y: cy + ry }, c2: { x: cx - rx, y: cy + ky }, p3: left },
    { p0: left, c1: { x: cx - rx, y: cy - ky }, c2: { x: cx - kx, y: cy - ry }, p3: top },
    { p0: top, c1: { x: cx + kx, y: cy - ry }, c2: { x: cx + rx, y: cy - ky }, p3: right },
  ];
}

/**
 * Bake a shape leaf (rect / ellipse) into a closed world-mm cubic ring, with
 * `rotation` folded into the geometry.
 *
 * The rect is normalized first so a negative width/height — which the numeric
 * inspectors permit and `ctx.rect` paints mirrored — describes the same region
 * here that it does on screen; the ellipse branch is unaffected because its
 * centre already mirrors and its radii are taken absolute (renderer.ts does the
 * same). zpd's `ShapeLayer` has no corner radius, so there is no rounded-rect
 * case to port.
 *
 * The 4-segment kappa ellipse deviates from the exact `ctx.ellipse` curve by
 * ~0.03% of area — the same approximation the renderer's own curve
 * decomposition makes, so booleans stay consistent with what is painted.
 */
export function bakeShapeLeaf(layer: ShapeLayer): KernelRing {
  const rect = normalizeRect(layer);
  const center = rectCenter(rect);
  const axisRing =
    layer.shape === 'ellipse'
      ? ellipseAxisRing(center.x, center.y, rect.width / 2, rect.height / 2)
      : rectAxisRing(rect.x, rect.y, rect.width, rect.height);

  const rotation = layer.rotation ?? 0;
  if (!rotation) return axisRing;
  const rp = (p: KernelPoint): KernelPoint => rotatePoint(p, center, rotation);
  return axisRing.map((c) => ({ p0: rp(c.p0), c1: rp(c.c1), c2: rp(c.c2), p3: rp(c.p3) }));
}

/**
 * Bake one eligible leaf into ONE ordered compound kernel input: outer contour
 * first, `extraSubpaths` after it in source order. Keeping them together under
 * one fill rule is what stops a layer's holes becoming independent operands.
 *
 * FILL RULE — a path leaf is always `evenodd`, even with no `extraSubpaths`.
 * That is a deliberate divergence from pgen (which used `nonzero` until an
 * inner ring appeared): zpd's renderer paints every path with
 * `ctx.fill(path, 'evenodd')` unconditionally, so any other rule here would
 * make the boolean disagree with what is on screen for a self-intersecting pen
 * path. For a simple single ring the two rules coincide, so nothing else moves.
 * A shape leaf is a single simple ring and stays `nonzero`.
 *
 * A degenerate outer contour makes the whole leaf the canonical EMPTY input
 * (it keeps its z-slot but can own no geometry); degenerate inner contours are
 * dropped without becoming phantom operands.
 */
export function leafToKernelInput(leaf: EligibleLeaf): KernelInput {
  if (leaf.layer.type === 'shape') {
    const contour = bakeShapeLeaf(leaf.layer);
    return { contours: isDegenerateContour(contour) ? [] : [contour], fillRule: 'nonzero' };
  }

  const outer = bakePathContour(leaf.layer.points, leaf.layer.closed);
  if (isDegenerateContour(outer)) return { contours: [], fillRule: 'evenodd' };
  return { contours: [outer, ...bakeExtraSubpaths(leaf.layer)], fillRule: 'evenodd' };
}

/** Every valid `extraSubpaths` contour of a path leaf, in source order. */
export function bakeExtraSubpaths(layer: PathLayer): KernelRing[] {
  return (layer.extraSubpaths ?? [])
    .map((subpath) => bakePathContour(subpath, true))
    .filter((ring) => !isDegenerateContour(ring));
}

// ─── (c) kernel result rings → KernelPathSpec[] ────────────────────────────

/**
 * One ring → `PathPoint[]`. Handles are ABSOLUTE mm, matching `PathLayer`:
 * an anchor's `hout` is its own segment's `c1`, and its `hin` is the PREVIOUS
 * segment's `c2` (whose `p3` is this anchor). A handle that sits on its anchor
 * is omitted, which is how zpd spells "straight edge".
 */
function ringToPathPoints(ring: KernelRing): PathPoint[] {
  const n = ring.length;
  const points: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const cur = ring[i]!;
    const prev = ring[(i - 1 + n) % n]!;
    const anchor = cur.p0;
    const p: PathPoint = { x: anchor.x, y: anchor.y };
    if (Math.abs(cur.c1.x - anchor.x) > HANDLE_EPS || Math.abs(cur.c1.y - anchor.y) > HANDLE_EPS) {
      p.hout = { x: cur.c1.x, y: cur.c1.y };
    }
    if (
      Math.abs(prev.c2.x - anchor.x) > HANDLE_EPS ||
      Math.abs(prev.c2.y - anchor.y) > HANDLE_EPS
    ) {
      p.hin = { x: prev.c2.x, y: prev.c2.y };
    }
    points.push(p);
  }
  return points;
}

interface RingMeta {
  ring: KernelRing;
  area: number;
  rep: KernelPoint;
  poly: KernelPoint[];
}

/**
 * Group flat result rings into `KernelPathSpec`s.
 *
 * Rings are classified by EVEN-ODD containment: a ring contained by an even
 * number of others is an OUTER boundary (its own spec); an odd count marks a
 * HOLE, attached to its TIGHTEST (smallest-|area|) container. Holes are emitted
 * with winding REVERSED relative to their outer ring — which is what zpd's
 * `ctx.fill(path, 'evenodd')` renderer and a nonzero `ctx.clip()` both punch
 * correctly.
 *
 * An island-in-hole topology (3+ concentric shapes under Exclude) exceeds the
 * 2-level `points` + `extraSubpaths` model, so the island becomes its own
 * top-level spec rather than a third nesting level.
 *
 * `style` and `name` are op policy decided by the caller. Sliver filtering is
 * the kernel's job and has already happened; everything reaching here is real
 * geometry.
 */
export function ringsToSpecs(
  rings: KernelRing[],
  style: ResolvedInputStyle,
  name: string,
): KernelPathSpec[] {
  if (rings.length === 0) return [];
  const meta: RingMeta[] = rings.map((ring) => ({
    ring,
    area: ringSignedArea(ring),
    rep: ringInteriorPoint(ring),
    poly: flattenRing(ring),
  }));

  // containers[i] = indices of rings that strictly contain ring i's interior point
  const containers: number[][] = meta.map((m, i) => {
    const idxs: number[] = [];
    for (let j = 0; j < meta.length; j++) {
      if (j !== i && pointInPolygon(m.rep, meta[j]!.poly)) idxs.push(j);
    }
    return idxs;
  });

  const specs: KernelPathSpec[] = [];
  meta.forEach((outer, i) => {
    if (containers[i]!.length % 2 !== 0) return; // odd depth → hole, handled by its parent

    const holeRings: KernelRing[] = [];
    meta.forEach((hole, j) => {
      if (j === i || containers[j]!.length % 2 !== 1) return; // only odd-depth holes
      // tightest (immediate) container = smallest |area| among this hole's containers
      let tight = -1;
      let tightArea = Infinity;
      for (const cj of containers[j]!) {
        const cjArea = Math.abs(meta[cj]!.area);
        if (cjArea < tightArea) {
          tightArea = cjArea;
          tight = cj;
        }
      }
      if (tight !== i) return;
      holeRings.push(
        Math.sign(hole.area) === Math.sign(outer.area) ? reverseRing(hole.ring) : hole.ring,
      );
    });

    specs.push(buildSpec(outer.ring, holeRings, style, name));
  });

  return specs;
}

function buildSpec(
  outerRing: KernelRing,
  holeRings: KernelRing[],
  style: ResolvedInputStyle,
  name: string,
): KernelPathSpec {
  return {
    points: ringToPathPoints(outerRing),
    ...(holeRings.length > 0
      ? { extraSubpaths: holeRings.map((ring) => ringToPathPoints(ring)) }
      : {}),
    closed: true,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    name,
  };
}

// ─── Inverse: spec → rings (round-trip / verification aid) ──────────────────
//
// Both are just `bakePathContour` again — there is no transform to undo, which
// is the whole point of zpd's world-mm model. They exist so consumers and tests
// name the intent instead of re-deriving the closure rule.

export function specOuterRing(spec: KernelPathSpec): KernelRing {
  return bakePathContour(spec.points, spec.closed);
}

export function specHoleRings(spec: KernelPathSpec): KernelRing[] {
  return (spec.extraSubpaths ?? []).map((subpath) => bakePathContour(subpath, true));
}
