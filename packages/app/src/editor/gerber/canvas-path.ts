/**
 * Canvas2D path construction, reproduced as geometry (#211).
 *
 * The 62 pattern generators build their artwork by calling path methods on a
 * `CanvasRenderingContext2D`. Recording those calls is the easy half; the half
 * that silently produces wrong artwork is the SEMANTICS around them, which are
 * spelled out in the HTML spec's "path API" section and are not what a naive
 * proxy would guess:
 *
 *  - The path PERSISTS across `fill()` / `stroke()` — only `beginPath()` clears
 *    it, so a generator that fills and then strokes paints the same geometry
 *    twice, and one that forgets `beginPath()` re-paints everything it has
 *    drawn so far.
 *  - `closePath()` does not merely set a flag: it appends the closing edge AND
 *    starts a fresh subpath at the closed one's first point, so the next
 *    `lineTo` continues from there rather than from the last point drawn.
 *  - `lineTo` / `bezierCurveTo` / `quadraticCurveTo` on an EMPTY path behave as
 *    a `moveTo` ("ensure there is a subpath") instead of being dropped.
 *  - `arc` adds an implicit straight line from the current point to the arc's
 *    start point. `via-grid-array` depends on this: its annulus is ONE subpath
 *    — outer circle, radial connector, inner circle — not two, and only the
 *    even-odd rule over that single self-touching contour yields the drilled
 *    hole (verified against the kernel, not assumed).
 *  - `rect` appends a CLOSED four-point subpath and then leaves a fresh
 *    single-point subpath at its origin; that trailing point is not paintable,
 *    which is why subpaths are tracked with their segment list rather than a
 *    point count.
 *  - A non-finite coordinate is silently ignored by Canvas, not an error.
 *
 * Angles follow `ctx.arc`'s own convention, which is already this repository's:
 * a point at parameter φ is `(cx + r·cos φ, cy + r·sin φ)` and increasing φ
 * traverses clockwise ON SCREEN in y-down document space (see `arc.ts`).
 */

import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';
import { ellipticalArcToCubics } from './arc';
import { degenerateCubic } from './primitives';
import type { StrokeSubpath } from './stroker';

const TAU = Math.PI * 2;

/** One Canvas subpath: its segments, whether `closePath()` sealed it, its origin. */
export interface CanvasSubpath {
  /**
   * Chained cubics. EMPTY for a subpath that only ever received its starting
   * point (a bare `moveTo`, `closePath`'s successor, `rect`'s trailing point) —
   * browsers paint nothing for those, so emptiness is the paintability test.
   * For a `closed` subpath the last `p3` is already back at `start`.
   */
  readonly contour: readonly KernelCubic[];
  readonly closed: boolean;
  readonly start: KernelPoint;
}

function finite(...values: number[]): boolean {
  for (const v of values) if (!Number.isFinite(v)) return false;
  return true;
}

function same(a: KernelPoint, b: KernelPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The signed sweep `ctx.arc`/`ctx.ellipse` actually traverses, per the HTML
 * spec's exact wording — which is NOT `endAngle - startAngle`:
 *
 *  - clockwise (the default) with `end - start >= 2π` is the whole circle;
 *  - counter-clockwise with `start - end >= 2π` is the whole circle backwards;
 *  - otherwise the angle is taken the short way round IN THE GIVEN DIRECTION,
 *    i.e. wrapped into `[0, 2π)` for clockwise and `(-2π, 0]` for
 *    counter-clockwise.
 *
 * `labyrinth-classical` is the generator that pins this: it passes
 * `(gap + GAP_ANGLE, gap - GAP_ANGLE + 2π)`, which is a hair under a full turn
 * and must stay a gapped ring rather than snapping to a closed circle.
 */
export function canvasArcSweep(
  startAngle: number,
  endAngle: number,
  counterclockwise: boolean,
): number {
  const delta = endAngle - startAngle;
  if (!counterclockwise) {
    if (delta >= TAU) return TAU;
    const wrapped = delta % TAU;
    return wrapped < 0 ? wrapped + TAU : wrapped;
  }
  if (-delta >= TAU) return -TAU;
  const wrapped = delta % TAU;
  return wrapped > 0 ? wrapped - TAU : wrapped;
}

class Subpath {
  readonly cubics: KernelCubic[] = [];
  closed = false;
  current: KernelPoint;

  constructor(readonly start: KernelPoint) {
    this.current = start;
  }

  push(cubic: KernelCubic): void {
    this.cubics.push(cubic);
    this.current = cubic.p3;
  }

  lineTo(p: KernelPoint): void {
    this.push(degenerateCubic(this.current, p));
  }
}

/**
 * Accumulates Canvas path calls. Curves are kept as cubics and never flattened
 * here — Decision 5 puts flattening last, after the booleans.
 *
 * `onSegments` is the DoS tripwire: Decision 8 requires the ring ceiling to
 * abort a generator mid-draw, and rings only become countable at paint time, so
 * a generator that loops forever inside one `beginPath()` would otherwise
 * exhaust memory before the first `fill()`. The callback throws.
 */
export class CanvasPathBuilder {
  private subpaths: Subpath[] = [];

  constructor(
    private readonly arcToleranceMm: number,
    private readonly onSegments: (added: number) => void = () => {},
  ) {}

  reset(): void {
    this.subpaths = [];
  }

  private get last(): Subpath | undefined {
    return this.subpaths[this.subpaths.length - 1];
  }

  /** Spec's "ensure there is a subpath": start one at `p` when the path is empty. */
  private ensure(p: KernelPoint): Subpath {
    const last = this.last;
    if (last) return last;
    const fresh = new Subpath(p);
    this.subpaths.push(fresh);
    return fresh;
  }

  private add(sub: Subpath, cubics: readonly KernelCubic[]): void {
    for (const c of cubics) sub.push(c);
    if (cubics.length > 0) this.onSegments(cubics.length);
  }

  moveTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    this.subpaths.push(new Subpath({ x, y }));
    this.onSegments(0);
  }

  lineTo(x: number, y: number): void {
    if (!finite(x, y)) return;
    const p = { x, y };
    const sub = this.last;
    // On an EMPTY path this only establishes the starting point — it is a
    // `moveTo`, not a dropped call and not a segment from nowhere.
    if (!sub) {
      this.subpaths.push(new Subpath(p));
      return;
    }
    // A zero-length segment is kept, not welded away: `moveTo(p); lineTo(p)`
    // is Canvas's zero-length subpath, which paints a dot under a round cap and
    // a square under a square cap (Decision 5).
    this.add(sub, [degenerateCubic(sub.current, p)]);
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!finite(c1x, c1y, c2x, c2y, x, y)) return;
    const sub = this.ensure({ x: c1x, y: c1y });
    this.add(sub, [
      { p0: sub.current, c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, p3: { x, y } },
    ]);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!finite(cpx, cpy, x, y)) return;
    const sub = this.ensure({ x: cpx, y: cpy });
    const p0 = sub.current;
    const p3 = { x, y };
    // Degree elevation — exact, not an approximation.
    this.add(sub, [
      {
        p0,
        c1: { x: p0.x + (2 / 3) * (cpx - p0.x), y: p0.y + (2 / 3) * (cpy - p0.y) },
        c2: { x: p3.x + (2 / 3) * (cpx - p3.x), y: p3.y + (2 / 3) * (cpy - p3.y) },
        p3,
      },
    ]);
  }

  arc(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ellipse(cx, cy, radius, radius, 0, startAngle, endAngle, counterclockwise);
  }

  /**
   * `ctx.ellipse`. No generator calls it today (`ctx.arc` is the 32-call-site
   * member); it exists because `arc` is defined in terms of it and because a
   * future port getting a silent no-op would be worse than the tiny surface.
   * `rotation` is unsupported and must be zero — the ellipse constructor in
   * `arc.ts` is axis-aligned, and quietly ignoring a rotation would mis-place
   * artwork.
   */
  ellipse(
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    if (!finite(cx, cy, radiusX, radiusY, rotation, startAngle, endAngle)) return;
    // Canvas throws IndexSizeError; mirroring it keeps a broken generator loud
    // in the exporter exactly as it already is in the editor.
    if (radiusX < 0 || radiusY < 0) {
      throw new RangeError(`ctx.arc/ellipse: negative radius (${radiusX}, ${radiusY})`);
    }
    if (rotation !== 0) {
      throw new RangeError('ctx.ellipse: a non-zero rotation is not supported by the recorder');
    }

    const sweep = canvasArcSweep(startAngle, endAngle, counterclockwise);
    const entry = {
      x: cx + radiusX * Math.cos(startAngle),
      y: cy + radiusY * Math.sin(startAngle),
    };
    // "If the path has any subpaths, add a straight line to the arc's start."
    const sub = this.ensure(entry);
    if (!same(sub.current, entry)) this.add(sub, [degenerateCubic(sub.current, entry)]);

    const cubics = ellipticalArcToCubics(
      cx,
      cy,
      radiusX,
      radiusY,
      startAngle,
      sweep,
      this.arcToleranceMm,
    );
    if (cubics.length === 0) return;
    if (Math.abs(sweep) === TAU) {
      // cos/sin(θ + 2π) is not bit-identical to cos/sin(θ); land exactly back on
      // the entry point so a full circle closes rather than leaving a nanometre
      // gap for the arrangement to adjudicate.
      cubics[cubics.length - 1] = { ...cubics[cubics.length - 1], p3: cubics[0].p0 };
    }
    // Re-anchor on the welded entry point for the same reason.
    cubics[0] = { ...cubics[0], p0: sub.current };
    this.add(sub, cubics);
  }

  /**
   * Spec: a closed four-point subpath, THEN a fresh subpath holding only
   * `(x, y)`. A negative `w`/`h` reverses the traversal rather than normalising
   * — which matters, because the winding sign is what decides whether an
   * overlapping pair fills or cancels under `nonzero`.
   */
  rect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h)) return;
    const corners: KernelPoint[] = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    const sub = new Subpath(corners[0]);
    this.subpaths.push(sub);
    for (let i = 1; i < corners.length; i++) sub.lineTo(corners[i]);
    sub.lineTo(corners[0]);
    sub.closed = true;
    this.onSegments(4);
    this.subpaths.push(new Subpath({ x, y }));
  }

  closePath(): void {
    const sub = this.last;
    if (!sub) return;
    if (!sub.closed) {
      if (sub.cubics.length > 0 && !same(sub.current, sub.start)) {
        sub.lineTo(sub.start);
        this.onSegments(1);
      }
      sub.closed = true;
    }
    // A new subpath starting where the closed one did — this is why a `lineTo`
    // after `closePath()` continues from the shape's first point.
    this.subpaths.push(new Subpath(sub.start));
  }

  snapshot(): CanvasSubpath[] {
    return this.subpaths.map((s) => ({ contour: s.cubics, closed: s.closed, start: s.start }));
  }
}

/**
 * The ring a subpath contributes to `fill()`. Canvas fills every subpath as if
 * closed, so an open one gets its closing edge here — that implicit closure is
 * exactly what a "record the calls" proxy drops, and it turns an outline into a
 * different (usually much smaller) filled area.
 */
export function subpathFillRing(sub: CanvasSubpath): KernelRing {
  if (sub.contour.length === 0) return [];
  const end = sub.contour[sub.contour.length - 1].p3;
  if (same(end, sub.start)) return [...sub.contour];
  return [...sub.contour, degenerateCubic(end, sub.start)];
}

/** The subpaths `stroke()` paints: everything that carries at least one segment. */
export function strokeSubpathsOf(subpaths: readonly CanvasSubpath[]): StrokeSubpath[] {
  return subpaths
    .filter((s) => s.contour.length > 0)
    .map((s) => ({ contour: s.contour, closed: s.closed }));
}
