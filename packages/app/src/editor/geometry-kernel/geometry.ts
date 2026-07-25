/**
 * Geometry kernel — pure helpers (engine-agnostic; NO path-bool import).
 *
 * Everything here operates on the plain {@link KernelPoint} / {@link
 * KernelCubic} / {@link KernelRing} primitives from `types.ts`, so it is
 * usable from the boolean adapter, from document↔kernel converters, and from
 * tests alike without pulling in the boolean backend. Ported verbatim (bar the
 * type renames) from pgen's `pathfinder/geometry.ts`.
 *
 * Deliberately NOT here: point rotation. `@zpd/core`'s `rotatePoint` already
 * implements the identical y-down, clockwise-degrees convention this kernel
 * needs, and a second copy of that matrix is exactly the kind of duplicate
 * that drifts. Bake `ShapeLayer.rotation` with core's helper before handing
 * geometry to the kernel.
 */

import type { KernelCubic, KernelPoint, KernelRing } from './types';

const TAU = Math.PI * 2;

/** Evaluate a cubic Bézier at parameter `t ∈ [0,1]` (Bernstein form). */
export function sampleCubicAt(c: KernelCubic, t: number): KernelPoint {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * t * u * u;
  const b2 = 3 * t * t * u;
  const b3 = t * t * t;
  return {
    x: b0 * c.p0.x + b1 * c.c1.x + b2 * c.c2.x + b3 * c.p3.x,
    y: b0 * c.p0.y + b1 * c.c1.y + b2 * c.c2.y + b3 * c.p3.y,
  };
}

/** The two halves of a split cubic, plus the on-curve point they share. */
export interface CubicSplit {
  left: KernelCubic;
  right: KernelCubic;
  /** The point at `t`; identical to `left.p3` and `right.p0`. */
  mid: KernelPoint;
}

function lerp(a: KernelPoint, b: KernelPoint, t: number): KernelPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Split a cubic at `t ∈ [0,1]` via de Casteljau. Both halves retrace the
 * original curve exactly, so splitting at an intersection parameter inserts an
 * anchor without deforming the shape — which is why the boolean pipeline can
 * cut edges at intersections and still round-trip the geometry.
 *
 * Control points in and out are ABSOLUTE positions, matching `KernelCubic`
 * (and zpd's `PathPoint.hin`/`hout`, which are also absolute mm).
 */
export function splitCubicAt(c: KernelCubic, t: number): CubicSplit {
  // De Casteljau level 1
  const q0 = lerp(c.p0, c.c1, t);
  const q1 = lerp(c.c1, c.c2, t);
  const q2 = lerp(c.c2, c.p3, t);
  // Level 2
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  // Level 3 — the point on the curve
  const mid = lerp(r0, r1, t);

  return {
    left: { p0: c.p0, c1: q0, c2: r0, p3: mid },
    right: { p0: mid, c1: r1, c2: q2, p3: c.p3 },
    mid,
  };
}

/**
 * Exact signed-area contribution of ONE cubic segment to `(1/2)∮(x dy − y dx)`.
 *
 * Closed form via Green's theorem over the Bernstein basis — the antisymmetric
 * coefficients (0.6, 0.3, 0.1, 0.3, 0.3, 0.6) are exact (numerically verified
 * against a rect = degenerate cubics and against a 4-segment kappa ellipse).
 * Being exact for the actual control points is what lets the area-invariant
 * property test use a tight tolerance rather than a sampling fudge factor.
 */
export function cubicSignedArea(c: KernelCubic): number {
  const { p0, c1, c2, p3 } = c;
  const twoA =
    0.6 * (p0.x * c1.y - c1.x * p0.y) +
    0.3 * (p0.x * c2.y - c2.x * p0.y) +
    0.1 * (p0.x * p3.y - p3.x * p0.y) +
    0.3 * (c1.x * c2.y - c2.x * c1.y) +
    0.3 * (c1.x * p3.y - p3.x * c1.y) +
    0.6 * (c2.x * p3.y - p3.x * c2.y);
  return twoA / 2;
}

/** Exact signed area (mm²) enclosed by a closed ring of cubic segments. */
export function ringSignedArea(ring: KernelRing): number {
  let a = 0;
  for (const c of ring) a += cubicSignedArea(c);
  return a;
}

/** Reverse a ring's traversal direction (flips its winding / signed-area sign). */
export function reverseRing(ring: KernelRing): KernelRing {
  const out: KernelRing = [];
  for (let i = ring.length - 1; i >= 0; i--) {
    const c = ring[i]!;
    out.push({ p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 });
  }
  return out;
}

/**
 * Flatten a ring into a closed polyline by sampling each cubic. Used for
 * point-in-polygon containment classification; `samplesPerSeg` trades accuracy
 * for cost (16 is ample for the strictly-nested rings a boolean op produces).
 */
export function flattenRing(ring: KernelRing, samplesPerSeg = 16): KernelPoint[] {
  const poly: KernelPoint[] = [];
  for (const c of ring) {
    // Sample (0, 1] so consecutive segments don't double the shared endpoint.
    for (let i = 1; i <= samplesPerSeg; i++) {
      poly.push(sampleCubicAt(c, i / samplesPerSeg));
    }
  }
  return poly;
}

/** Even-odd ray-cast point-in-polygon test against a closed polyline. */
export function pointInPolygon(pt: KernelPoint, poly: readonly KernelPoint[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects =
      a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function bboxDiag(poly: readonly KernelPoint[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * A point guaranteed strictly inside a simple ring.
 *
 * The globally-topmost vertex of a simple polygon is always convex, so a small
 * step from it along the bisector of its two (downward) edges lands in the
 * interior. Tie-breaking on x avoids the degenerate horizontal-top-edge case
 * (e.g. a rectangle). The step size is adaptive + verified so the result is
 * interior for thin shapes too.
 */
export function ringInteriorPoint(ring: KernelRing): KernelPoint {
  const poly = flattenRing(ring);
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };

  let k = 0;
  for (let i = 1; i < n; i++) {
    const p = poly[i]!;
    const t = poly[k]!;
    if (p.y < t.y || (p.y === t.y && p.x < t.x)) k = i;
  }
  const T = poly[k]!;
  const a = poly[(k - 1 + n) % n]!;
  const b = poly[(k + 1) % n]!;

  let dx = a.x - T.x + (b.x - T.x);
  let dy = a.y - T.y + (b.y - T.y);
  let len = Math.hypot(dx, dy);
  if (len < 1e-12) {
    // Degenerate bisector — step straight down (interior is below the top vertex).
    dx = 0;
    dy = 1;
    len = 1;
  }
  dx /= len;
  dy /= len;

  const diag = bboxDiag(poly) || 1;
  for (const frac of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6]) {
    const eps = frac * diag;
    const cand = { x: T.x + dx * eps, y: T.y + dy * eps };
    if (pointInPolygon(cand, poly)) return cand;
  }
  // Fallback: vertex centroid (interior for the convex results this sees).
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / n, y: cy / n };
}

/** Kappa constant: control-handle length for a 90° circular arc (4-segment ellipse). */
export const KAPPA = (4 / 3) * Math.tan(TAU / 16);
