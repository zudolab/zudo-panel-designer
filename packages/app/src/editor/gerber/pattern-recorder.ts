/**
 * The recording-proxy `ctx` for pattern layers (#211).
 *
 * 62 registered generators implement `draw(ctx: CanvasRenderingContext2D,
 * opts): void` and produce no vector output. Rewriting them, or widening
 * `packages/patterns/src/types.ts`, would touch a contract implemented 62 times
 * whose own comment stresses that the API is unchanged so pattern ports stay
 * unaffected — so instead the context is faked and the paint calls are captured.
 *
 * Across every generator the API surface is 17 members:
 *   lineTo · beginPath · moveTo · stroke · strokeStyle · lineWidth · arc ·
 *   closePath · fillStyle · fill · lineJoin · lineCap · fillRect ·
 *   bezierCurveTo · rect · strokeRect · quadraticCurveTo
 *
 * ── Why a real `Proxy` and not a plain object ──────────────────────────────
 * An object with the 17 members would let a future generator call a 18th and
 * get a `TypeError` at best — or, if it were a property assignment such as
 * `globalAlpha` or `globalCompositeOperation`, absolutely nothing, and the
 * export would silently disagree with the screen. The proxy makes every
 * unrecognised member a loud, named failure at the moment it is used.
 *
 * ── What is captured, and when ─────────────────────────────────────────────
 * Style is read at `fill()`/`stroke()` time, never at assignment time
 * (Decision 5). `strokeStyle`/`fillStyle` are recorded but carry no geometric
 * meaning: a pattern layer has ONE `ColorIndex`, the renderer passes that one
 * colour in, and no generator assigns anything else — so every paint on a layer
 * lands on the same material. Because every paint is opaque, the layer's
 * artwork is the plain UNION of its paint operations; painting can only add
 * ink, never remove it, so no compositing order has to be preserved.
 */

import type { KernelFillRule } from '../geometry-kernel';
import { CanvasPathBuilder, type CanvasSubpath } from './canvas-path';
import {
  CANVAS_DEFAULT_JOIN_STYLE,
  type StrokeCap,
  type StrokeJoin,
  type StrokeStyle,
} from './stroker';

export type PaintOp =
  | {
      readonly kind: 'fill';
      readonly rule: KernelFillRule;
      readonly subpaths: readonly CanvasSubpath[];
    }
  | {
      readonly kind: 'stroke';
      readonly style: StrokeStyle;
      readonly subpaths: readonly CanvasSubpath[];
    };

/** Decision 8's ceiling, hit DURING recording so the generator aborts mid-draw. */
export class PatternComplexityError extends Error {
  constructor(readonly detail: string) {
    super(`pattern recording exceeded the complexity ceiling: ${detail}`);
    this.name = 'PatternComplexityError';
  }
}

/** Raised when a generator reaches for a canvas member the recorder does not model. */
export class UnsupportedCanvasMemberError extends Error {
  constructor(readonly member: string) {
    super(`pattern recorder: unsupported canvas member "${member}"`);
    this.name = 'UnsupportedCanvasMemberError';
  }
}

export interface RecorderLimits {
  /** Rings entering the boolean union (Decision 8: 20,000 per material layer). */
  readonly maxRings: number;
  /**
   * Path segments admitted before the recording is abandoned. The ring ceiling
   * alone cannot bound a generator that never reaches a paint call, and
   * `core/src/pattern-geometry.ts:15-22` documents exactly that failure mode —
   * generators "run JS loops across the whole draw span (the canvas clip bounds
   * pixels, not loop work)".
   */
  readonly maxSegments: number;
}

const LINE_CAPS: readonly StrokeCap[] = ['butt', 'round', 'square'];
const LINE_JOINS: readonly StrokeJoin[] = ['miter', 'round', 'bevel'];

/**
 * The recorder's own state. Canvas resets nothing between layers of its own
 * accord, but `paintLayer` wraps every layer in `save()`/`restore()`
 * (`renderer.ts:354`, `:473`), so a fresh recorder per layer is the faithful
 * model and no state can leak between layers.
 */
export class PatternRecorder {
  fillStyle = '#000000';
  strokeStyle = '#000000';

  private width = 1;
  private cap: StrokeCap = CANVAS_DEFAULT_JOIN_STYLE.cap;
  private join: StrokeJoin = CANVAS_DEFAULT_JOIN_STYLE.join;
  private limit: number = CANVAS_DEFAULT_JOIN_STYLE.miterLimit;

  private readonly path: CanvasPathBuilder;
  private readonly opsList: PaintOp[] = [];
  private rings = 0;
  private segments = 0;

  constructor(
    private readonly arcToleranceMm: number,
    private readonly limits: RecorderLimits,
  ) {
    this.path = new CanvasPathBuilder(arcToleranceMm, (added) => this.countSegments(added));
  }

  get ops(): readonly PaintOp[] {
    return this.opsList;
  }

  // ─── style state ─────────────────────────────────────────────────────────
  //
  // Canvas SILENTLY IGNORES an out-of-range assignment and keeps the previous
  // value; it does not clamp and does not throw. That is load-bearing, not
  // pedantry: `ctx.lineWidth = 0` leaves the previous width in force, so a
  // recorder that clamped to 0 would drop a stroke the editor still paints.

  get lineWidth(): number {
    return this.width;
  }
  set lineWidth(value: number) {
    if (Number.isFinite(value) && value > 0) this.width = value;
  }

  get lineCap(): StrokeCap {
    return this.cap;
  }
  set lineCap(value: StrokeCap) {
    if (LINE_CAPS.includes(value)) this.cap = value;
  }

  get lineJoin(): StrokeJoin {
    return this.join;
  }
  set lineJoin(value: StrokeJoin) {
    if (LINE_JOINS.includes(value)) this.join = value;
  }

  get miterLimit(): number {
    return this.limit;
  }
  set miterLimit(value: number) {
    if (Number.isFinite(value) && value > 0) this.limit = value;
  }

  private get strokeStyleNow(): StrokeStyle {
    return { width: this.width, cap: this.cap, join: this.join, miterLimit: this.limit };
  }

  // ─── path ────────────────────────────────────────────────────────────────

  beginPath(): void {
    this.path.reset();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  closePath(): void {
    this.path.closePath();
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.path.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadraticCurveTo(cpx, cpy, x, y);
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.path.arc(x, y, radius, startAngle, endAngle, counterclockwise ?? false);
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.path.ellipse(
      x,
      y,
      radiusX,
      radiusY,
      rotation,
      startAngle,
      endAngle,
      counterclockwise ?? false,
    );
  }

  // ─── paint ───────────────────────────────────────────────────────────────

  /**
   * Canvas's default rule is **nonzero**, and that is the trap this whole
   * module exists to avoid: zpd's own `PathLayer` fills are `evenodd`
   * (`renderer.ts:428-431`), so "layers are evenodd" is a true statement about
   * this codebase that is false about a pattern generator's `ctx.fill()`.
   * The path is NOT cleared — a generator may fill and then stroke it.
   */
  fill(rule: CanvasFillRule = 'nonzero'): void {
    const subpaths = this.path.snapshot();
    const paintable = subpaths.filter((s) => s.contour.length > 0);
    if (paintable.length === 0) return;
    this.countRings(paintable.length);
    this.opsList.push({
      kind: 'fill',
      rule: rule === 'evenodd' ? 'evenodd' : 'nonzero',
      subpaths: paintable,
    });
  }

  stroke(): void {
    const subpaths = this.path.snapshot().filter((s) => s.contour.length > 0);
    if (subpaths.length === 0) return;
    this.countRings(subpaths.length);
    this.opsList.push({ kind: 'stroke', style: this.strokeStyleNow, subpaths });
  }

  /**
   * Path-independent: `fillRect` neither reads nor disturbs the current path.
   * A zero width or height paints nothing (there is no such thing as a filled
   * degenerate rectangle), which is NOT true of `strokeRect`.
   */
  fillRect(x: number, y: number, w: number, h: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h))
      return;
    if (w === 0 || h === 0) return;
    this.countRings(1);
    this.countSegments(4);
    this.opsList.push({ kind: 'fill', rule: 'nonzero', subpaths: [rectSubpath(x, y, w, h)] });
  }

  /**
   * Also path-independent, and degenerate in two documented ways: a rectangle
   * with both dimensions zero strokes as a single point (a dot or square,
   * depending on the cap), and one with a single zero dimension strokes as a
   * line segment rather than as a zero-area rectangle.
   */
  strokeRect(x: number, y: number, w: number, h: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h))
      return;
    const sub =
      w === 0 && h === 0
        ? pointSubpath(x, y)
        : w === 0 || h === 0
          ? segmentSubpath(x, y, x + w, y + h)
          : rectSubpath(x, y, w, h);
    this.countRings(1);
    this.countSegments(4);
    this.opsList.push({ kind: 'stroke', style: this.strokeStyleNow, subpaths: [sub] });
  }

  // ─── Decision 8 ceilings ─────────────────────────────────────────────────

  private countRings(added: number): void {
    this.rings += added;
    if (this.rings > this.limits.maxRings) {
      throw new PatternComplexityError(`${this.rings} rings exceeds ${this.limits.maxRings}`);
    }
  }

  private countSegments(added: number): void {
    this.segments += added;
    if (this.segments > this.limits.maxSegments) {
      throw new PatternComplexityError(
        `${this.segments} path segments exceeds ${this.limits.maxSegments}`,
      );
    }
  }

  /** Exposed for tests and for the refusal detail string. */
  get counts(): { rings: number; segments: number } {
    return { rings: this.rings, segments: this.segments };
  }

  /** The tolerance the recorder hands its arc approximation, for assertions. */
  get arcTolerance(): number {
    return this.arcToleranceMm;
  }
}

function corners(x: number, y: number, w: number, h: number): { x: number; y: number }[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function rectSubpath(x: number, y: number, w: number, h: number): CanvasSubpath {
  const pts = corners(x, y, w, h);
  const contour = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { p0: p, c1: p, c2: q, p3: q };
  });
  return { contour, closed: true, start: pts[0] };
}

function segmentSubpath(x0: number, y0: number, x1: number, y1: number): CanvasSubpath {
  const p0 = { x: x0, y: y0 };
  const p3 = { x: x1, y: y1 };
  return { contour: [{ p0, c1: p0, c2: p3, p3 }], closed: false, start: p0 };
}

function pointSubpath(x: number, y: number): CanvasSubpath {
  const p = { x, y };
  return { contour: [{ p0: p, c1: p, c2: p, p3: p }], closed: false, start: p };
}

/** Every member a generator is allowed to touch, plus the recorder's own. */
const ALLOWED_MEMBERS: ReadonlySet<string> = new Set([
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'ellipse',
  'rect',
  'bezierCurveTo',
  'quadraticCurveTo',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
]);

/**
 * The recorder as something a generator will accept as its `ctx`, with every
 * member outside {@link ALLOWED_MEMBERS} turned into a named error rather than
 * a silent no-op.
 *
 * Symbols pass through untrapped: engines probe `Symbol.toPrimitive`,
 * `Symbol.toStringTag` and friends during ordinary operations, and throwing on
 * those would break the recorder for reasons that have nothing to do with
 * drawing.
 *
 * The receiver handed to `Reflect` is the RECORDER, never the proxy, and
 * methods come back pre-bound to it. Otherwise the trap turns on itself: TS
 * `private` is erased at runtime, so `get lineWidth()` reading `this.width`
 * through the proxy would hit the allowlist and throw on the recorder's own
 * internals.
 */
export function createRecordingContext(recorder: PatternRecorder): CanvasRenderingContext2D {
  const bound = new Map<string, unknown>();
  const proxy = new Proxy(recorder, {
    get(target, prop) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, target);
      if (!ALLOWED_MEMBERS.has(prop)) throw new UnsupportedCanvasMemberError(String(prop));
      const cached = bound.get(prop);
      if (cached !== undefined) return cached;
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const fn = value.bind(target) as unknown;
      bound.set(prop, fn);
      return fn;
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') return Reflect.set(target, prop, value, target);
      if (!ALLOWED_MEMBERS.has(prop)) throw new UnsupportedCanvasMemberError(String(prop));
      return Reflect.set(target, prop, value, target);
    },
  });
  return proxy as unknown as CanvasRenderingContext2D;
}
