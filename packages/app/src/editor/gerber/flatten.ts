/**
 * Adaptive cubic → polyline flattening (Decision 6.2).
 *
 * `core/src/path-geometry.ts`'s `DEFAULT_FLATTEN_SEGMENTS = 24` is a fixed
 * segment count per cubic regardless of arc length: it over-samples a 0.1 mm
 * curve and under-samples a 120 mm one by the same factor. Correct for
 * hit-testing, wrong for fabrication — so this is a separate implementation and
 * the core constant stays untouched.
 *
 * Subdivision is a recursive de Casteljau flatness test against the CONTROL
 * POLYGON, not uniform-`t` sampling: uniform `t` does not bound chord error on
 * a cubic with unevenly distributed control points.
 */

import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';
import { splitCubicAt } from '../geometry-kernel';
import type { IrPoint } from './ir';
import { MAX_FLATTEN_DEPTH } from './tolerance';

/** Perpendicular distance from `p` to the infinite line through `a`,`b`. */
function lineDistance(p: KernelPoint, a: KernelPoint, b: KernelPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2);
}

/**
 * Total turning of the control polygon `p0→c1→c2→p3`, which bounds the tangent
 * turning of the curve it controls. Only the stroker needs this — see
 * {@link flattenCubicInto}'s `maxTurnRad`.
 */
function controlPolygonTurn(c: KernelCubic): number {
  const legs: KernelPoint[] = [
    { x: c.c1.x - c.p0.x, y: c.c1.y - c.p0.y },
    { x: c.c2.x - c.c1.x, y: c.c2.y - c.c1.y },
    { x: c.p3.x - c.c2.x, y: c.p3.y - c.c2.y },
  ].filter((v) => v.x !== 0 || v.y !== 0);

  let turn = 0;
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    turn += Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
  }
  return turn;
}

/**
 * Append the flattening of `c` to `out`, EXCLUDING `c.p0` and including
 * `c.p3`, so consecutive segments chain without duplicating shared endpoints.
 *
 * `maxTurnRad` bounds the tangent turn admitted into one emitted segment. It is
 * `Infinity` for ordinary flattening; the stroker passes a finite value because
 * chord error on a centreline is MAGNIFIED by `(1 + halfWidth/radius)` once the
 * polyline is offset — a 2.5 µm centreline chord becomes 7.5 µm of outline
 * error on a stroke whose half-width is twice the local radius of curvature.
 */
export function flattenCubicInto(
  c: KernelCubic,
  toleranceMm: number,
  minSegmentMm: number,
  maxTurnRad: number,
  out: KernelPoint[],
  depth = 0,
): void {
  const chord = Math.hypot(c.p3.x - c.p0.x, c.p3.y - c.p0.y);
  const spread = Math.max(
    Math.hypot(c.c1.x - c.p0.x, c.c1.y - c.p0.y),
    Math.hypot(c.c2.x - c.p0.x, c.c2.y - c.p0.y),
  );

  // Degenerate/cusped cubics must terminate rather than subdivide forever:
  // both the recursion bound and the minimum emitted segment are hard stops.
  if (depth >= MAX_FLATTEN_DEPTH || Math.max(chord, spread) <= minSegmentMm) {
    out.push(c.p3);
    return;
  }

  const deviation = Math.max(lineDistance(c.c1, c.p0, c.p3), lineDistance(c.c2, c.p0, c.p3));
  // The true chord deviation of a cubic is at most 3/4 of its control-point
  // deviation, so testing the control points directly is conservative — the
  // emitted polyline stays comfortably inside the budget rather than on it.
  if (deviation <= toleranceMm && controlPolygonTurn(c) <= maxTurnRad) {
    out.push(c.p3);
    return;
  }

  const { left, right } = splitCubicAt(c, 0.5);
  flattenCubicInto(left, toleranceMm, minSegmentMm, maxTurnRad, out, depth + 1);
  flattenCubicInto(right, toleranceMm, minSegmentMm, maxTurnRad, out, depth + 1);
}

/** Flatten a chain of cubics to a polyline, `chain[0].p0` first. */
export function flattenChain(
  chain: readonly KernelCubic[],
  toleranceMm: number,
  minSegmentMm: number,
  maxTurnRad = Infinity,
): KernelPoint[] {
  if (chain.length === 0) return [];
  const out: KernelPoint[] = [chain[0].p0];
  for (const c of chain) flattenCubicInto(c, toleranceMm, minSegmentMm, maxTurnRad, out);
  return out;
}

/**
 * Collapse consecutive vertices closer than `minSegmentMm`, treating the list
 * as an implicitly closed ring (so the wrap-around pair is collapsed too).
 */
export function collapseRingVertices(
  points: readonly KernelPoint[],
  minSegmentMm: number,
): IrPoint[] {
  const out: IrPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < minSegmentMm) continue;
    out.push({ x: p.x, y: p.y });
  }
  while (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) >= minSegmentMm) break;
    out.pop();
  }
  return out;
}

/**
 * Flatten a closed cubic ring into an `IrRing`: implicitly closed (the last
 * point is NOT a repeat of the first) with near-duplicate vertices collapsed.
 * Returns `[]` for a ring left with fewer than 3 vertices, which the caller
 * drops (Decision 6.2).
 */
export function flattenRingAdaptive(
  ring: KernelRing,
  toleranceMm: number,
  minSegmentMm: number,
): IrPoint[] {
  const polyline = flattenChain(ring, toleranceMm, minSegmentMm);
  const collapsed = collapseRingVertices(polyline, minSegmentMm);
  return collapsed.length >= 3 ? collapsed : [];
}

/** Shoelace signed area of an implicitly-closed polygon, in doc space. */
export function polygonSignedArea(poly: readonly IrPoint[]): number {
  let twice = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    twice += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return twice / 2;
}
