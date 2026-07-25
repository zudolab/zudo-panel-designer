/**
 * Geometry kernel — shared contracts (epic #204, sub #206).
 *
 * This is a SHARED foundation with two independent consumers:
 *   - the Path Finder ops (#202) — Illustrator-style boolean shape modes;
 *   - the Gerber exporter's geometry IR (#203) — flattening the document to
 *     fabricable copper/mask/silk regions.
 * Neither owns it. Anything that only makes sense for boolean *ops* (an op
 * name, a panel action, a selection rule) belongs in the Path Finder module,
 * NOT here — that is what keeps the Gerber side able to depend on this
 * without dragging in the editor's Pathfinder UI.
 *
 * ── What this kernel does NOT provide ──────────────────────────────────────
 * **Stroke expansion / offsetting.** There is no stroker here: nothing turns a
 * stroked centreline into a filled outline polygon. A separate sub-issue owns
 * that. Do not assume `unite()` on stroked inputs approximates it — the kernel
 * only ever sees fill regions.
 *
 * ── Units ──────────────────────────────────────────────────────────────────
 * Every coordinate is **document millimetres** (`core/src/types.ts`: "PCB
 * fabrication data is mm-based, so mm is the single storage space"). This is
 * load-bearing for the tolerance regime — see {@link KernelEpsilons} and
 * `DEFAULT_MM_EPSILONS` in `engine.ts`.
 */

import type { PathLayer, PathPoint, ShapeLayer } from '@zpd/core';

// Re-exported so consumers can pull the document-side point shape from the
// same module as the kernel-side one and see the two side by side.
export type { PathPoint } from '@zpd/core';

// ─── Engine-agnostic geometry primitives ──────────────────────────────────
//
// Everything the boolean backend consumes / emits is expressed in these plain
// double-precision types, so the concrete engine (path-bool today, paper.js as
// the documented fallback) never leaks past the adapter surface below.

/** A point in document space (millimetres, double precision). */
export interface KernelPoint {
  x: number;
  y: number;
}

/**
 * One cubic Bézier segment in document mm: `p0 → p3` with control points `c1`
 * (out of `p0`) and `c2` (into `p3`).
 *
 * There is NO line primitive anywhere in the kernel: a straight edge is
 * encoded as a degenerate cubic (`c1 === p0`, `c2 === p3`). That matches zpd's
 * `PathPoint` model, where a segment whose endpoints carry no `hout`/`hin` is
 * a straight line, so the conversion in either direction is lossless.
 */
export interface KernelCubic {
  p0: KernelPoint;
  c1: KernelPoint;
  c2: KernelPoint;
  p3: KernelPoint;
}

/** A closed ring: connected cubic segments with `last.p3 ≈ first.p0`. */
export type KernelRing = KernelCubic[];

/** Fill rule for one compound kernel input. */
export type KernelFillRule = 'nonzero' | 'evenodd';

/**
 * One ordered compound boolean-op input.
 *
 * A document leaf always maps to exactly one `KernelInput`: its outer contour
 * first, any inner contours (zpd's `PathLayer.extraSubpaths`) after it in
 * source order. Contours stay together under one fill rule so a layer's holes
 * never become independent operands. An empty `contours` array is the
 * canonical degenerate/no-op input.
 */
export interface KernelInput {
  contours: KernelRing[];
  fillRule: KernelFillRule;
}

/**
 * A pair of curve parameters `(t0, t1)` locating an intersection between two
 * segments. Both are parameters of the callers' own cubics, not of whatever
 * the backend internally reduced them to (see `lineFractionToCubicParameter`
 * in `engine.ts`).
 */
export interface SegmentIntersection {
  t0: number;
  t1: number;
}

// ─── Tolerance regime ──────────────────────────────────────────────────────

/**
 * The single tolerance regime for everything downstream of the kernel
 * (Graphite-port robustness lesson: ONE regime, never a second one layered on
 * top of the boolean backend's own comparisons).
 *
 * All three are in **millimetres** (or mm² for `sliverArea`). The concrete
 * fabrication-tuned values and the reasoning behind each live on
 * `DEFAULT_MM_EPSILONS` in `engine.ts`.
 *
 *  - `snap`       grid the inputs are rounded to BEFORE the op runs, so
 *                 near-coincident vertices from independently authored shapes
 *                 collapse to exact equality instead of tripping the backend's
 *                 intersection code (Graphite "round/snap inputs").
 *  - `sliverArea` result faces/rings with `|signedArea|` below this are dropped
 *                 as numerical slivers (Graphite "filter sliver faces").
 *  - `point`      point-coincidence tolerance; mirrors the backend's internal
 *                 point epsilon so our pre/post steps agree with its arithmetic.
 */
export interface KernelEpsilons {
  snap: number;
  sliverArea: number;
  point: number;
}

// ─── Boolean engine adapter surface ────────────────────────────────────────

/**
 * A built boolean arrangement over an ordered (back→front) input set. Every
 * query runs against the SAME arrangement, so `faces()` indices stay valid for
 * `buildShape()`. `subtract()` treats input `[0]` as the minuend
 * (`inputs[0] \ union(inputs[1..])`) — callers order the inputs so `[0]` is the
 * shape to keep (backmost for Minus Front, frontmost for Minus Back).
 *
 * Every method returns rings in **document mm**. Grouping rings into
 * outer+hole regions is the consumer's job, not the kernel's — as is splitting
 * a ring whose lobes meet at a single point, which the backend hands back
 * undivided (see `pathToRings` in `engine.ts`).
 */
export interface BooleanArrangement {
  unite(): KernelRing[];
  subtract(): KernelRing[];
  intersect(): KernelRing[];
  exclude(): KernelRing[];
  /**
   * Atomic faces of the arrangement (holes already poked), sliver faces
   * omitted; one entry per surviving face.
   */
  faces(): KernelRing[][];
  /**
   * Merge the faces at the given indices into one shape's boundary rings.
   * Indices are positions in THIS arrangement's own `faces()` array — the
   * adapter translates them for the backend, whose numbering still counts the
   * dropped slivers. Throws `RangeError` on an out-of-range index rather than
   * quietly rebuilding some other region.
   */
  buildShape(faceIndices: Iterable<number>): KernelRing[];
}

/**
 * Swap-ready boolean engine. The concrete implementation (`./engine`) wraps
 * `path-bool`; keeping this interface engine-agnostic is what lets paper.js
 * substitute (see the named fallback trigger criteria in `engine.ts`).
 * Construct via the async factory `createBooleanEngine` — path-bool is loaded
 * lazily with `await import`.
 */
export interface BooleanEngine {
  arrange(inputs: KernelInput[]): BooleanArrangement;
  /** Intersections between two document-mm cubics. */
  segmentIntersection(a: KernelCubic, b: KernelCubic): SegmentIntersection[];
  /** Self-intersection parameters of a single cubic, or null. */
  cubicSelfIntersection(c: KernelCubic): [number, number] | null;
  readonly epsilons: KernelEpsilons;
}

// ─── Document bridge ───────────────────────────────────────────────────────
//
// zpd stores every leaf's geometry in WORLD millimetres — there is no
// per-layer transform to fold in (`GroupNode` deliberately carries no
// positionOffset, and rotation is baked into the leaf). So the bridge between
// the document and the kernel is a straight coordinate copy: no local↔world
// normalization step, and no rotation re-application on the way back.
// (`ShapeLayer.rotation` is the one exception; bake it with `@zpd/core`'s
// `rotatePoint` before building rings — the kernel does not re-implement it.)

/**
 * A document leaf whose outline the kernel can consume. Both consumers narrow
 * further: Path Finder to the current selection, Gerber to one PCB layer role.
 */
export interface KernelLeaf {
  id: string;
  layer: PathLayer | ShapeLayer;
}

/**
 * Kernel output shaped for zpd's `PathLayer` model but not yet a layer node
 * (no `id`, no `type`) — turning one of these into a real document layer is
 * the consumer's step.
 *
 * `points` / `extraSubpaths` are in **world mm**, exactly like `PathLayer`.
 * Hole rings in `extraSubpaths` are emitted with winding **reversed** relative
 * to the outer ring; that renders correctly under the evenodd fill zpd already
 * uses for `extraSubpaths`, and also punches correctly under a nonzero
 * `ctx.clip()`.
 */
export interface KernelPathSpec {
  points: PathPoint[];
  extraSubpaths?: PathPoint[][];
  closed: boolean;
  fill: PathLayer['fill'];
  stroke: PathLayer['stroke'];
  strokeWidth: number;
  name: string;
}
