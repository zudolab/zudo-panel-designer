/**
 * Stroke expansion — a real stroker (Decision 5, option (a)).
 *
 * The #206 kernel provides boolean ops but NO offsetting, and Gerber has no
 * stroked-path primitive for arbitrary artwork, so a stroked centreline has to
 * become a filled region here. Aperture-constrained emission was rejected in
 * Decision 5 on evidence: the pattern generators set `lineCap`/`lineJoin`
 * including `butt`, `square` and `miter`, none of which a circular aperture
 * expresses.
 *
 * ── Construction: a traced outline, NOT a pile of segment quads ─────────────
 * HTML Canvas *defines* a stroke as the union of one rectangle per segment,
 * one join shape per vertex and one cap shape per end, and emitting exactly
 * that is tempting because every piece is convex. It is also unusable here:
 * a round cap's circle passes exactly through its segment rectangle's two
 * corners, and path-bool resolves that corner-exact tangency wrongly — a
 * 10 × 2 bar with round caps came back as `20 − π` instead of `20 + π`, with
 * the cap subtracted rather than added. So this traces ONE outline per subpath
 * instead: no two emitted boundaries touch, and there is nothing degenerate
 * for the arrangement to adjudicate.
 *
 * ── Output contract ────────────────────────────────────────────────────────
 * One `KernelInput` per subpath, under the **nonzero** fill rule, holding
 * cubic rings — never pre-flattened, with round caps and joins as real cubic
 * arcs subdivided to Decision 6.1's 2.5 µm bound. Separate subpaths stay
 * separate inputs on purpose: path-bool does NOT union overlapping contours
 * that share one compound input (two overlapping rectangles in one input come
 * back as their intersection), so anything that may overlap must be its own
 * operand.
 *
 * ── Why the centreline is flattened first ──────────────────────────────────
 * The exact offset of a cubic is not a cubic, so the centreline is flattened
 * to Decision 6.2's budget and the polyline is offset. That spends the
 * cubic→polyline half of the budget here rather than in the final flatten,
 * which is a no-op on the straight edges this produces — the two do not add.
 * The one place they could is at a corner of the flattened centreline, where
 * the error is magnified by `(1 + halfWidth/radius)`; `maxTurnForHalfWidth`
 * bounds exactly that, so the outline stays within 2.5 µm even when the stroke
 * is four times wider than the local radius of curvature.
 */

import type {
  BooleanEngine,
  KernelCubic,
  KernelInput,
  KernelPoint,
  KernelRing,
} from '../geometry-kernel';
import { reverseRing, ringInteriorPoint, ringSignedArea } from '../geometry-kernel';
import { circularArcToCubics, ellipseToRing } from './arc';
import { flattenChain, polygonSignedArea } from './flatten';
import { degenerateCubic, rectToRing } from './primitives';
import type { IrTolerance } from './tolerance';

const TAU = Math.PI * 2;
/** Ring-builder weld distance: far below the kernel's 1e-4 mm snap grid. */
const WELD_MM = 1e-9;
/** |sin(turn)| below this counts as collinear or exactly doubled back. */
const CROSS_EPS = 1e-9;
/**
 * The inner side of a join is the exact intersection of the two offset lines,
 * which runs away to infinity as the turn approaches a hairpin. Past this
 * ratio it routes through the centreline vertex instead — a bounded fallback
 * that can only make the stroke locally thicker, never thinner.
 */
const INNER_JOIN_LIMIT = 10;

export type StrokeCap = 'butt' | 'round' | 'square';
/**
 * `bevel` is accepted alongside Decision 5's round/miter because it is both
 * Canvas's third `lineJoin` value and the miter-limit fallback this stroker
 * already implements — #211 records `lineJoin` verbatim from a generator and
 * needs somewhere to put it.
 */
export type StrokeJoin = 'miter' | 'round' | 'bevel';

export interface StrokeStyle {
  /** Millimetres. `<= 0` or non-finite contributes no geometry — not a refusal. */
  readonly width: number;
  readonly cap: StrokeCap;
  readonly join: StrokeJoin;
  readonly miterLimit: number;
}

/**
 * Canvas2D's defaults, which is what a `PathLayer` stroke is drawn with:
 * `paintLayer` sets only `strokeStyle` and `lineWidth` (`renderer.ts:432-435`)
 * inside a `save()`/`restore()` pair (`:354`, `:473`), so nothing else leaks in.
 */
export const CANVAS_DEFAULT_JOIN_STYLE = {
  cap: 'butt',
  join: 'miter',
  miterLimit: 10,
} as const satisfies Omit<StrokeStyle, 'width'>;

export interface StrokeSubpath {
  /** Chained cubics; for `closed` the last `p3` returns to the first `p0`. */
  readonly contour: readonly KernelCubic[];
  readonly closed: boolean;
}

// ─── ring assembly ─────────────────────────────────────────────────────────

class RingBuilder {
  private readonly cubics: KernelCubic[] = [];
  private first: KernelPoint | null = null;
  private cur: KernelPoint | null = null;

  lineTo(p: KernelPoint): void {
    if (this.cur === null) {
      this.first = p;
      this.cur = p;
      return;
    }
    if (Math.hypot(p.x - this.cur.x, p.y - this.cur.y) < WELD_MM) return;
    this.cubics.push(degenerateCubic(this.cur, p));
    this.cur = p;
  }

  curveTo(chain: readonly KernelCubic[]): void {
    for (const c of chain) {
      this.lineTo(c.p0);
      // Re-anchor on the welded current point so the ring has no positional
      // break for the kernel to read as a subpath boundary.
      this.cubics.push({ p0: this.cur!, c1: c.c1, c2: c.c2, p3: c.p3 });
      this.cur = c.p3;
    }
  }

  close(): KernelRing {
    if (this.first === null || this.cur === null) return [];
    if (Math.hypot(this.cur.x - this.first.x, this.cur.y - this.first.y) >= WELD_MM) {
      this.cubics.push(degenerateCubic(this.cur, this.first));
    } else if (this.cubics.length > 0) {
      const last = this.cubics[this.cubics.length - 1];
      this.cubics[this.cubics.length - 1] = { ...last, p3: this.first };
    }
    return this.cubics.length >= 2 ? this.cubics : [];
  }
}

// ─── frames ────────────────────────────────────────────────────────────────

interface SegmentFrame {
  readonly dir: KernelPoint;
  readonly nrm: KernelPoint;
}

function segmentFrames(points: readonly KernelPoint[], closed: boolean): SegmentFrame[] {
  const n = points.length;
  const count = closed ? n : n - 1;
  const frames: SegmentFrame[] = [];
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    frames.push({ dir, nrm: { x: -dir.y, y: dir.x } });
  }
  return frames;
}

function offsetPoint(p: KernelPoint, nrm: KernelPoint, sign: number, h: number): KernelPoint {
  return { x: p.x + sign * h * nrm.x, y: p.y + sign * h * nrm.y };
}

function normalizeAngle(a: number): number {
  let out = a;
  while (out <= -Math.PI) out += TAU;
  while (out > Math.PI) out -= TAU;
  return out;
}

/**
 * Signed turn of the path at a vertex, always in the path's FORWARD sense —
 * which side of a corner is outer is a property of the path, not of the
 * direction the boundary happens to be traced in. With `nrm = (-dir.y, dir.x)`
 * in y-down space, a positive turn puts the +nrm side on the INSIDE.
 */
function forwardTurn(nrmPrev: KernelPoint, nrmNext: KernelPoint): number {
  return Math.atan2(
    nrmPrev.x * nrmNext.y - nrmPrev.y * nrmNext.x,
    nrmPrev.x * nrmNext.x + nrmPrev.y * nrmNext.y,
  );
}

function isOuterSide(turn: number, sign: number): boolean {
  return sign > 0 ? turn < 0 : turn > 0;
}

/**
 * Where the two offset lines meet: `h / cos(turn/2)` along the bisector. This
 * is the miter tip on the outer side and the exact offset corner on the inner
 * side — the same construction, mirrored. `null` past `limit`, which on the
 * outer side is SVG/Canvas's miter limit (`miterLength / strokeWidth =
 * 1 / sin(θ/2)` for an interior angle θ, i.e. `1 / cos(turn/2)`).
 */
function bisectorPoint(
  center: KernelPoint,
  nrmPrev: KernelPoint,
  nrmNext: KernelPoint,
  sign: number,
  h: number,
  turn: number,
  limit: number,
): KernelPoint | null {
  const cosHalfTurn = Math.cos(Math.abs(turn) / 2);
  if (!(cosHalfTurn > 0) || 1 / cosHalfTurn > limit) return null;
  const ux = sign * (nrmPrev.x + nrmNext.x);
  const uy = sign * (nrmPrev.y + nrmNext.y);
  const ulen = Math.hypot(ux, uy);
  if (ulen < CROSS_EPS) return null;
  const reach = h / cosHalfTurn;
  return { x: center.x + (ux / ulen) * reach, y: center.y + (uy / ulen) * reach };
}

// ─── joins and caps ────────────────────────────────────────────────────────

function emitJoin(
  rb: RingBuilder,
  center: KernelPoint,
  nrmPrev: KernelPoint,
  nrmNext: KernelPoint,
  sign: number,
  turn: number,
  style: StrokeStyle,
  h: number,
  tolerance: IrTolerance,
): void {
  const a = offsetPoint(center, nrmPrev, sign, h);
  const b = offsetPoint(center, nrmNext, sign, h);

  if (Math.abs(Math.sin(turn)) < CROSS_EPS) {
    // Collinear (a ≈ b, welded away) or exactly doubled back (a and b
    // antipodal, so the chord runs across the strip and adds no area).
    rb.lineTo(a);
    rb.lineTo(b);
    return;
  }

  if (!isOuterSide(turn, sign)) {
    // Inner side: the two offset lines CROSS before either reaches its own
    // offset point, so the boundary passes through the crossing and `a`/`b`
    // are never on it — emitting them zig-zags the ring back over itself.
    rb.lineTo(bisectorPoint(center, nrmPrev, nrmNext, sign, h, turn, INNER_JOIN_LIMIT) ?? center);
    return;
  }

  rb.lineTo(a);
  if (style.join === 'round') {
    const startPhi = Math.atan2(a.y - center.y, a.x - center.x);
    rb.curveTo(
      circularArcToCubics(
        center,
        h,
        startPhi,
        normalizeAngle(Math.atan2(b.y - center.y, b.x - center.x) - startPhi),
        tolerance.arcMm,
      ),
    );
  } else if (style.join === 'miter') {
    // Over the limit this emits nothing extra — a bevel, as Canvas falls back.
    const tip = bisectorPoint(center, nrmPrev, nrmNext, sign, h, turn, style.miterLimit);
    if (tip) rb.lineTo(tip);
  }
  rb.lineTo(b);
}

/** Cross the stroke at an open end, from `from` to `to`, bulging along `outward`. */
function emitCap(
  rb: RingBuilder,
  center: KernelPoint,
  from: KernelPoint,
  to: KernelPoint,
  outward: KernelPoint,
  style: StrokeStyle,
  h: number,
  tolerance: IrTolerance,
): void {
  rb.lineTo(from);
  if (style.cap === 'square') {
    rb.lineTo({ x: from.x + outward.x * h, y: from.y + outward.y * h });
    rb.lineTo({ x: to.x + outward.x * h, y: to.y + outward.y * h });
  } else if (style.cap === 'round') {
    const startPhi = Math.atan2(from.y - center.y, from.x - center.x);
    const towards = normalizeAngle(Math.atan2(outward.y, outward.x) - startPhi);
    rb.curveTo(
      circularArcToCubics(center, h, startPhi, towards >= 0 ? Math.PI : -Math.PI, tolerance.arcMm),
    );
  }
  rb.lineTo(to);
}

// ─── subpath strokers ──────────────────────────────────────────────────────

/**
 * An open subpath traces to ONE ring: down the −nrm side, across the end cap,
 * back up the +nrm side, across the start cap. Tracing that way round leaves
 * the ring with a POSITIVE signed area, the same sign closed strokes and
 * filled shapes carry, so nothing ever cancels under nonzero.
 */
function strokeOpenPolyline(
  points: readonly KernelPoint[],
  style: StrokeStyle,
  h: number,
  tolerance: IrTolerance,
): KernelRing {
  const n = points.length;
  const frames = segmentFrames(points, false);
  const rb = new RingBuilder();
  const turnAt = (i: number): number => forwardTurn(frames[i - 1].nrm, frames[i].nrm);

  rb.lineTo(offsetPoint(points[0], frames[0].nrm, -1, h));
  for (let i = 1; i <= n - 2; i++) {
    emitJoin(rb, points[i], frames[i - 1].nrm, frames[i].nrm, -1, turnAt(i), style, h, tolerance);
  }

  const last = frames[n - 2];
  emitCap(
    rb,
    points[n - 1],
    offsetPoint(points[n - 1], last.nrm, -1, h),
    offsetPoint(points[n - 1], last.nrm, 1, h),
    last.dir,
    style,
    h,
    tolerance,
  );

  for (let i = n - 2; i >= 1; i--) {
    emitJoin(rb, points[i], frames[i].nrm, frames[i - 1].nrm, 1, turnAt(i), style, h, tolerance);
  }

  emitCap(
    rb,
    points[0],
    offsetPoint(points[0], frames[0].nrm, 1, h),
    offsetPoint(points[0], frames[0].nrm, -1, h),
    { x: -frames[0].dir.x, y: -frames[0].dir.y },
    style,
    h,
    tolerance,
  );
  return rb.close();
}

function traceClosedSide(
  points: readonly KernelPoint[],
  frames: readonly SegmentFrame[],
  sign: number,
  style: StrokeStyle,
  h: number,
  tolerance: IrTolerance,
): KernelRing {
  const n = points.length;
  const rb = new RingBuilder();
  for (let i = 0; i < n; i++) {
    const nrmPrev = frames[(i - 1 + n) % n].nrm;
    const nrmNext = frames[i].nrm;
    emitJoin(
      rb,
      points[i],
      nrmPrev,
      nrmNext,
      sign,
      forwardTurn(nrmPrev, nrmNext),
      style,
      h,
      tolerance,
    );
  }
  return rb.close();
}

function distanceToClosedPolyline(p: KernelPoint, points: readonly KernelPoint[]): number {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * The hole of a closed stroke, validated.
 *
 * The raw inward offset is only a real offset while the half-width stays below
 * the shape's local inradius. Past that it folds through itself — and for a
 * convex shape it folds through cleanly, coming back as a perfectly simple
 * ring with its winding intact. Subtracting THAT punches a hole out of solid
 * metal: a 6 mm stroke on a 2 mm square came out hollow.
 *
 * So the raw ring is resolved into simple faces and each face is kept only if
 * it really is part of the hole, tested exactly: the hole is by definition the
 * set of points further than the half-width from the centreline, so a face
 * whose interior sits closer than that is fold-through and is discarded.
 */
function validatedHoleContours(
  source: readonly KernelPoint[],
  innerRing: KernelRing,
  h: number,
  engine: BooleanEngine,
): KernelRing[] {
  if (innerRing.length === 0) return [];
  const faces = engine.arrange([{ contours: [innerRing], fillRule: 'nonzero' }]).unite();
  const holes: KernelRing[] = [];
  for (const face of faces) {
    if (distanceToClosedPolyline(ringInteriorPoint(face), source) + WELD_MM < h) continue;
    // Force NEGATIVE area: the hole has to oppose the outer ring's winding or
    // nonzero reads the middle as doubly filled instead of punched out. The
    // kernel returns outer rings negatively wound, so the sign has to be
    // asserted here rather than assumed from the trace direction.
    holes.push(ringSignedArea(face) < 0 ? face : reverseRing(face));
  }
  return holes;
}

/**
 * A zero-length subpath: Canvas paints a dot with `round`, an axis-aligned
 * square with `square`, and nothing with `butt` (Decision 5).
 */
function strokeDot(
  p: KernelPoint,
  style: StrokeStyle,
  h: number,
  tolerance: IrTolerance,
): KernelRing[] {
  if (style.cap === 'round') {
    const ring = ellipseToRing(p.x, p.y, h, h, tolerance.arcMm);
    return ring.length > 0 ? [ring] : [];
  }
  if (style.cap === 'square') return [rectToRing(p.x - h, p.y - h, h * 2, h * 2)];
  return [];
}

// ─── entry point ───────────────────────────────────────────────────────────

/**
 * The turn a single flattened centreline segment may absorb before offsetting
 * magnifies its chord error past the budget. At a corner of the flattened
 * centreline the outline over- or undershoots the true offset by
 * `h·(1 − cos(turn/2))`, independent of the centreline's own chord error.
 */
export function maxTurnForHalfWidth(h: number, toleranceMm: number): number {
  if (!(h > 0)) return Infinity;
  const cosHalf = 1 - toleranceMm / h;
  if (cosHalf <= -1) return Infinity;
  return 2 * Math.acos(Math.min(1, cosHalf));
}

function dedupePolyline(
  points: readonly KernelPoint[],
  minSegmentMm: number,
  closed: boolean,
): KernelPoint[] {
  const out: KernelPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < minSegmentMm) continue;
    out.push(p);
  }
  // Only a closed subpath's polyline ends on its own start point; an open one
  // that happens to return near its start keeps both ends and both caps.
  if (closed) {
    while (out.length >= 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) >= minSegmentMm) break;
      out.pop();
    }
  }
  return out;
}

/**
 * Expand stroked centrelines into filled cubic rings — one `KernelInput` per
 * subpath, because subpaths may overlap and path-bool only unions across
 * separate operands.
 */
export function strokeSubpathsToInputs(
  subpaths: readonly StrokeSubpath[],
  style: StrokeStyle,
  tolerance: IrTolerance,
  engine: BooleanEngine,
): KernelInput[] {
  // Matches `renderer.ts:432`'s `layer.strokeWidth > 0` guard — no geometry,
  // not a refusal (Decision 5).
  if (!Number.isFinite(style.width) || style.width <= 0) return [];
  const h = style.width / 2;
  const maxTurn = maxTurnForHalfWidth(h, tolerance.flattenMm);

  const inputs: KernelInput[] = [];
  const push = (contours: KernelRing[]): void => {
    const kept = contours.filter((c) => c.length > 0);
    if (kept.length > 0) inputs.push({ contours: kept, fillRule: 'nonzero' });
  };

  for (const sub of subpaths) {
    if (sub.contour.length === 0) continue;
    const polyline = dedupePolyline(
      flattenChain(sub.contour, tolerance.flattenMm, tolerance.minSegmentMm, maxTurn),
      tolerance.minSegmentMm,
      sub.closed,
    );
    if (polyline.length === 0) continue;
    if (polyline.length === 1) {
      push(strokeDot(polyline[0], style, h, tolerance));
      continue;
    }
    // A "closed" subpath of two points encloses nothing; stroke it as the
    // there-and-back open polyline it actually is.
    if (!sub.closed || polyline.length < 3) {
      push([strokeOpenPolyline(polyline, style, h, tolerance)]);
      continue;
    }
    // Normalising to a positive signed area is what makes "−nrm is the outer
    // side" true rather than a coin flip: a reversed source would otherwise
    // have its outer ring validated as the hole and subtracted from itself.
    const ordered = polygonSignedArea(polyline) >= 0 ? polyline : [...polyline].reverse();
    const frames = segmentFrames(ordered, true);
    const traced = traceClosedSide(ordered, frames, -1, style, h, tolerance);
    const outer = ringSignedArea(traced) >= 0 ? traced : reverseRing(traced);
    const inner = traceClosedSide(ordered, frames, 1, style, h, tolerance);
    push([outer, ...validatedHoleContours(ordered, inner, h, engine)]);
  }
  return inputs;
}
