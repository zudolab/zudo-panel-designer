/**
 * Pattern layers → vector geometry (#211), via the recording-proxy `ctx`.
 *
 * Pipeline, in the order Decision 5 fixes and which is not free to rearrange:
 *
 *   record (cubics, LOCAL square mm)
 *     → resolve each paint op under its own fill rule
 *     → stroke-expand (the #209 stroker — never a second one)
 *     → drop what cannot reach the pattern square
 *     → union the layer's paints
 *     → clip to the pattern square      ← Decision 5.1
 *     → translate to document mm
 *
 * The union sits before the clip rather than after only because
 * `(⋃ᵢ Aᵢ) ∩ S = ⋃ᵢ (Aᵢ ∩ S)`; the clip is still per pattern layer and still
 * ahead of the material union, which is what Decision 5.1 fixes. Clipping
 * first was measured and is worse — see `clipRingsToSquare`.
 *
 * Flattening is NOT here: it belongs downstream of the material union, so the
 * source implements `extractCubics` and the `extract` form only exists for a
 * caller that consults it directly.
 *
 * ── Why the union is a plain union ─────────────────────────────────────────
 * Every generator paint is opaque — one `ColorIndex` per layer, one colour
 * passed in, no `globalAlpha`, no composite operation, and the proxy refuses
 * any member that could change that. Painting can therefore only ADD ink, so
 * the layer's artwork is the union of its paint operations and their order does
 * not survive into the geometry.
 *
 * ── The square clip is mandatory and is not the profile clip ───────────────
 * `renderer.ts:405-411` applies `ctx.rect(0, 0, size, size); ctx.clip()`
 * OUTSIDE the generator, and generators routinely draw through their square's
 * edges — every one of them overscans its loop bounds on purpose. A pattern
 * square need not cover the panel (`types.ts:24-28`), so the profile clip does
 * not subsume it: geometry outside the square but inside the panel is invisible
 * in the editor and would still be manufactured.
 *
 * The intersection is real and it is exact — but it is NOT done with the
 * boolean kernel. The square is convex, so Sutherland–Hodgman solves it in
 * closed form, and that matters here rather than being a preference: asked to
 * intersect a tile lattice with a square whose edge those tiles land on,
 * path-bool throws on eight of the 62 generators and silently returns the wrong
 * area on others. Details and the bounding-box short-circuits are on
 * `clipRingsToSquare`.
 */

import { MAX_PATTERN_SIZE_MM, type PatternLayer, type Layer } from '@zpd/core';
import { patternByName, type PanelPatternGenerator } from '@zpd/patterns';
import type { BooleanEngine, KernelInput, KernelPoint, KernelRing } from '../geometry-kernel';
import { ringSignedArea } from '../geometry-kernel';
import type {
  IrExtractContext,
  IrLayerCubicResult,
  IrLayerResult,
  LayerGeometrySource,
} from './ir';
import { subpathFillRing, strokeSubpathsOf } from './canvas-path';
import {
  createRecordingContext,
  PatternComplexityError,
  PatternRecorder,
  type PaintOp,
  type RecorderLimits,
} from './pattern-recorder';
import { polygonToRing } from './primitives';
import { collapseRingVertices, flattenChain } from './flatten';
import { ringsToRegions } from './regions';
import { strokeSubpathsToInputs } from './stroker';
import { DEFAULT_IR_LIMITS, type IrComplexityLimits, type IrTolerance } from './tolerance';
import {
  bboxContains,
  bboxesOverlapStrictly,
  inputBbox,
  ringBbox,
  unionComponents,
  type Bbox,
} from './union';

/**
 * The colour handed to the generator. Geometry only: a pattern layer carries a
 * single `ColorIndex`, the renderer resolves it to one hex and passes that one
 * value in, and no generator does anything with it but assign it to
 * `fillStyle`/`strokeStyle`. Which material the artwork lands on is decided by
 * `projectPcbLayerSlices`, upstream of here.
 */
const RECORDING_COLOR = '#000000';

/**
 * Per-pattern escape hatch (#211's acceptance): a generator whose Canvas
 * semantics the recorder cannot reproduce can supply its geometry directly, in
 * LOCAL square space (origin at the square's top-left), as cubic kernel groups.
 * Everything downstream — the square clip, the translation to document space,
 * the union — still applies, so an override cannot skip the clip.
 *
 * Ships EMPTY. Every entry added here needs its own named parity test.
 */
export interface PatternGeometryOverride {
  readonly patternType: string;
  toGroups(layer: PatternLayer, ctx: IrExtractContext): readonly KernelInput[];
}

export const PATTERN_GEOMETRY_OVERRIDES: readonly PatternGeometryOverride[] = [];

/**
 * KNOWN LIMITATION, stated here because it is the thing most likely to scrap a
 * board and it is not visible from any one function.
 *
 * `pattern-parity.test.ts` measures every registered generator twice. The
 * recorder — everything in this file — matches the editor on 58 of 62 at
 * default parameters, and the four exceptions are named there. But end-to-end,
 * once the #206 kernel unions the operands, only 35 of 62 come out right, and
 * the failures are silent: the export succeeds and the artwork is wrong.
 *
 * Nothing here refuses those layers, and that is a deliberate choice rather
 * than an oversight. A refusal would have to cover 27 generators, not a handful,
 * which makes it a product decision about whether Gerber export ships at all
 * for pattern-heavy designs — Decision 8's list and #215's dialog, not this
 * module's to make unilaterally. Refusing only the four the recorder knows
 * about would be worse than refusing none: it would imply the other 58 are
 * verified end-to-end, and 27 of them are not.
 *
 * `kernel-limits.test.ts` carries standalone reproductions, none of which
 * involves a pattern generator, and `geometry-kernel/engine.ts`'s named
 * paper.js fallback triggers T2 and T3 are both met.
 */

// ─── paint ops → kernel operands ───────────────────────────────────────────

/**
 * The operands one `fill()` contributes.
 *
 * The whole point of splitting by case is that path-bool mis-resolves collinear
 * edge overlap between contours that share ONE compound input — two 10 mm
 * squares offset by 5 mm come back as their 50 mm² intersection instead of
 * their 150 mm² union — and pattern generators produce exactly that shape all
 * day (`star-and-cross-field` fills hundreds of edge-sharing tiles in a single
 * path). So contours are kept in SEPARATE operands wherever the fill rule
 * permits it, which is where path-bool is reliable.
 *
 *  - one contour → hand it over with its own rule; path-bool resolves a single
 *    self-intersecting contour correctly under either rule.
 *  - `evenodd` → one operand per contour, each under `evenodd`, combined with
 *    `exclude()`. Exact, not an approximation: even-odd membership is the
 *    parity of the total crossing count, which is the XOR of the per-contour
 *    parities. Evaluating each contour under `evenodd` rather than `nonzero`
 *    is what keeps a self-intersecting contour (a pentagram) hollow.
 *  - `nonzero`, all contours wound the same way → one operand each, united.
 *    With no sign disagreement, "winding ≠ 0" and "inside at least one contour"
 *    are the same set.
 *  - `nonzero` with disagreeing windings → the compound operand, i.e.
 *    path-bool's own nonzero. This is the reversed-inner-ring annulus, where
 *    the contours are nested rather than edge-sharing, so the degeneracy above
 *    does not arise.
 */
export function fillOperands(
  rings: readonly KernelRing[],
  rule: KernelInput['fillRule'],
  engine: BooleanEngine,
): KernelInput[] {
  const usable = rings.filter((r) => r.length >= 2);
  if (usable.length === 0) return [];
  if (usable.length === 1) return [{ contours: [usable[0]], fillRule: rule }];

  if (rule === 'evenodd') {
    const resolved = engine
      .arrange(usable.map((r) => ({ contours: [r], fillRule: 'evenodd' as const })))
      .exclude();
    return resolved.length > 0 ? [{ contours: resolved, fillRule: 'nonzero' }] : [];
  }

  const sliver = engine.epsilons.sliverArea;
  let sign = 0;
  let separable = true;
  for (const ring of usable) {
    const area = ringSignedArea(ring);
    // A contour with no measurable area cannot vouch for its own winding — a
    // figure-eight nets to zero while filling both lobes — so it disqualifies
    // the fast path rather than being waved through as "compatible".
    if (Math.abs(area) < sliver) {
      separable = false;
      break;
    }
    const s = Math.sign(area);
    if (sign === 0) sign = s;
    else if (s !== sign) {
      separable = false;
      break;
    }
  }
  if (separable) return usable.map((r) => ({ contours: [r], fillRule: 'nonzero' as const }));
  return [{ contours: usable, fillRule: 'nonzero' }];
}

/** Every operand a recorded paint list contributes, before any clipping. */
export function operandsForOps(
  ops: readonly PaintOp[],
  tolerance: IrTolerance,
  engine: BooleanEngine,
): KernelInput[] {
  const operands: KernelInput[] = [];
  for (const op of ops) {
    if (op.kind === 'fill') {
      const rings = op.subpaths.map(subpathFillRing);
      operands.push(...fillOperands(rings, op.rule, engine));
      continue;
    }
    // The #209 stroker, never a second one: it already traces ONE outline per
    // subpath so no two emitted boundaries touch, which is what path-bool needs
    // (Canvas's own quad + join + cap decomposition is corner-exact tangent and
    // resolves wrongly — a 10 × 2 bar with round caps came back as 20 − π).
    operands.push(
      ...strokeSubpathsToInputs(strokeSubpathsOf(op.subpaths), op.style, tolerance, engine),
    );
  }
  return operands;
}

// ─── the square clip ───────────────────────────────────────────────────────

function translateRing(ring: KernelRing, dx: number, dy: number): KernelRing {
  const t = (p: KernelPoint): KernelPoint => ({ x: p.x + dx, y: p.y + dy });
  return ring.map((c) => ({ p0: t(c.p0), c1: t(c.c1), c2: t(c.c2), p3: t(c.p3) }));
}

/**
 * Intersect with the pattern square, one operand at a time.
 *
 * Per-operand rather than once over the assembled union, for two reasons:
 *
 *  - It is the same answer. `(⋃ᵢ Aᵢ) ∩ S = ⋃ᵢ (Aᵢ ∩ S)`, and it still lands
 *    where Decision 5.1 puts it — after stroke expansion, before the union.
 *  - It keeps every clip a TWO-operand arrangement, which is the shape
 *    path-bool is dependable in. Clipping the assembled union instead means
 *    handing it one compound operand holding every ring the layer produced, and
 *    that measurably corrupts the result: `houndstooth-tooth-grid` came back
 *    with 652 mm² of "intersection" inside a 576 mm² square, and other
 *    generators lost their artwork outright.
 *
 * The two bounding-box cases are exact, not heuristics, and they are what makes
 * this cheap: an operand whose box misses the square lies wholly outside it (so
 * it contributes nothing — and generators overscan their loops by a whole tile
 * on every side on purpose, so this is most of a dense pattern's outermost
 * motifs), and an operand whose box is inside the square is unaffected by the
 * intersection. Only operands that genuinely straddle the edge reach the
 * kernel, and those are cut rather than dropped or kept whole.
 */
/**
 * Drop the operands that cannot contribute to the square.
 *
 * Exact, not a heuristic: an operand whose bounding box does not STRICTLY
 * overlap the square lies wholly outside it, or touches it along an edge and
 * contributes zero area either way. This is not a micro-optimisation —
 * generators overscan their loop bounds by a whole tile on every side by design
 * (`centeredStart` pairs with a `span + pitch` bound), so it removes a dense
 * pattern's entire outermost ring of motifs before any boolean work.
 */
function operandsReachingSquare(operands: readonly KernelInput[], size: number): KernelInput[] {
  const square: Bbox = { minX: 0, minY: 0, maxX: size, maxY: size };
  return operands.filter((operand) => {
    const box = inputBbox(operand);
    return box !== null && bboxesOverlapStrictly(box, square);
  });
}

/**
 * Clip the layer's resolved rings to its square.
 *
 * Applied to the UNITED rings rather than to each operand, which is the same
 * answer — `(⋃ᵢ Aᵢ) ∩ S = ⋃ᵢ (Aᵢ ∩ S)` — and still lands where Decision 5.1
 * puts it, per pattern layer and before the material union. Clipping first was
 * measured and is worse: it flattens every straddling ring onto the square's
 * edge, and the resulting shared vertices give the union eight more generators'
 * worth of degeneracies to mis-resolve.
 */
function clipRingsToSquare(
  rings: readonly KernelRing[],
  size: number,
  tolerance: IrTolerance,
): KernelRing[] {
  const square: Bbox = { minX: 0, minY: 0, maxX: size, maxY: size };
  const out: KernelRing[] = [];
  for (const ring of rings) {
    const box = ringBbox(ring);
    if (!box || !bboxesOverlapStrictly(box, square)) continue;
    // A ring already inside the square is unchanged by the intersection, and
    // skipping it keeps its curves as curves instead of flattening them early.
    if (bboxContains(square, box)) {
      out.push(ring);
      continue;
    }
    const clipped = clipRingToSquare(ring, size, tolerance);
    if (clipped.length > 0) out.push(clipped);
  }
  return out;
}

/**
 * Sutherland–Hodgman against one edge of the square.
 *
 * `keep` is the half-plane test and `cut` interpolates the crossing point;
 * together they are one of the four passes that clip a polygon to the square.
 */
function clipToHalfPlane(
  points: readonly KernelPoint[],
  keep: (p: KernelPoint) => boolean,
  cut: (a: KernelPoint, b: KernelPoint) => KernelPoint,
): KernelPoint[] {
  const out: KernelPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const previous = points[(i - 1 + points.length) % points.length];
    const currentIn = keep(current);
    const previousIn = keep(previous);
    if (currentIn !== previousIn) out.push(cut(previous, current));
    if (currentIn) out.push(current);
  }
  return out;
}

/**
 * Clip one contour to the pattern square, WITHOUT the boolean kernel.
 *
 * The square is convex, which is exactly the case Sutherland–Hodgman solves
 * exactly and in closed form — and the reason to reach for it here rather than
 * `engine.intersect()` is that the kernel cannot do this reliably. Generators
 * lay their lattices on round millimetre coordinates, so tile edges land on the
 * square's edge constantly, and path-bool either throws on the coincidence
 * (`Cannot read properties of undefined (reading 'winding')`, observed on eight
 * generators) or silently returns the wrong area (`via-grid-array` lost 68% of
 * its annuli). A clip that cannot throw and cannot be wrong is worth more here
 * than one that reuses the kernel for its own sake.
 *
 * Clipping each contour independently preserves the operand's fill rule:
 * Sutherland–Hodgman replaces the outside portions with runs along the square's
 * own boundary, which lie on the edge and therefore change no interior point's
 * winding or crossing count.
 *
 * The contour is flattened first, because the exact clip of a cubic is not a
 * cubic. That spends Decision 6.2's cubic→polyline budget here instead of in
 * the final flatten — which is then a no-op on the straight edges this produces,
 * so the two do not add. `stroker.ts` makes the same trade for the same reason.
 */
function clipRingToSquare(ring: KernelRing, size: number, tolerance: IrTolerance): KernelRing {
  const flat = flattenChain(ring, tolerance.flattenMm, tolerance.minSegmentMm);
  let points: KernelPoint[] = flat;
  // Drop the closing repeat: the ring is implicitly closed from here on.
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < tolerance.minSegmentMm)
      points = points.slice(0, -1);
  }

  const lerpX = (a: KernelPoint, b: KernelPoint, x: number): KernelPoint => ({
    x,
    y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y),
  });
  const lerpY = (a: KernelPoint, b: KernelPoint, y: number): KernelPoint => ({
    x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x),
    y,
  });

  points = clipToHalfPlane(
    points,
    (p) => p.x >= 0,
    (a, b) => lerpX(a, b, 0),
  );
  if (points.length < 3) return [];
  points = clipToHalfPlane(
    points,
    (p) => p.x <= size,
    (a, b) => lerpX(a, b, size),
  );
  if (points.length < 3) return [];
  points = clipToHalfPlane(
    points,
    (p) => p.y >= 0,
    (a, b) => lerpY(a, b, 0),
  );
  if (points.length < 3) return [];
  points = clipToHalfPlane(
    points,
    (p) => p.y <= size,
    (a, b) => lerpY(a, b, size),
  );

  const collapsed = collapseRingVertices(points, tolerance.minSegmentMm);
  return collapsed.length >= 3 ? polygonToRing(collapsed) : [];
}

// ─── recording ─────────────────────────────────────────────────────────────

export interface PatternRecordingResult {
  readonly ops: readonly PaintOp[];
}

/**
 * Run a generator against the recording proxy.
 *
 * `draw` is called with the same `DrawOptions` the renderer builds
 * (`renderer.ts:415-420`): the square's side as both dimensions, the layer's
 * own params verbatim — generators clamp them themselves through
 * `resolveParam` — and one flat colour.
 */
export function recordGenerator(
  gen: PanelPatternGenerator,
  sizeMm: number,
  params: Record<string, number>,
  tolerance: IrTolerance,
  limits: RecorderLimits,
): PaintOp[] {
  const recorder = new PatternRecorder(tolerance.arcMm, limits);
  gen.draw(createRecordingContext(recorder), {
    widthMm: sizeMm,
    heightMm: sizeMm,
    color: RECORDING_COLOR,
    params,
  });
  return [...recorder.ops];
}

// ─── the layer source ──────────────────────────────────────────────────────

function unsupported(
  layer: Layer,
  reason: Extract<IrLayerResult, { kind: 'unsupported' }>['reason'],
  detail?: string,
): Extract<IrLayerResult, { kind: 'unsupported' }> {
  return {
    kind: 'unsupported',
    layerId: layer.id,
    layerName: layer.name,
    reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

export interface PatternGeometrySourceOptions {
  readonly overrides?: readonly PatternGeometryOverride[];
  /**
   * Decision 8's ceilings. `IrExtractContext` deliberately carries only what
   * every extractor needs (#209's contract), so `buildGerberIr`'s own `limits`
   * option does not reach here — the source takes the same pinned defaults and
   * lets a caller override them explicitly.
   */
  readonly limits?: IrComplexityLimits;
}

/**
 * The pattern layer's geometry in DOCUMENT millimetres, y-down, as resolved
 * cubic rings. No Y flip — that belongs to `coordinate-frame.ts` alone
 * (Decision 1).
 */
/**
 * The layer's artwork as kernel operands in LOCAL square space: recorded,
 * stroke-expanded and clipped to the square, but NOT yet united.
 *
 * Exposed as its own step because it is exactly what #211 owns. Everything up
 * to here is this module's responsibility and is verified against the reference
 * render for every generator; the union that follows is the #206 kernel's, and
 * separating the two is what makes a parity failure attributable instead of
 * merely visible.
 */
export function patternLayerToOperands(
  layer: PatternLayer,
  ctx: IrExtractContext,
  options: PatternGeometrySourceOptions = {},
): { readonly kind: 'operands'; readonly operands: KernelInput[] } | { readonly kind: 'overrun' } {
  // The renderer's own draw guard (`renderer.ts:396-402`): a malformed or
  // absurd size never reaches `draw()`, and the editor paints nothing. The
  // export paints nothing too — an export that disagreed with the screen here
  // would be the more surprising outcome, and `MAX_PATTERN_SIZE_MM` is a DoS
  // bound rather than a design limit anyone can see.
  if (!Number.isFinite(layer.size) || layer.size <= 0 || layer.size > MAX_PATTERN_SIZE_MM) {
    return { kind: 'operands', operands: [] };
  }

  const limits = options.limits ?? DEFAULT_IR_LIMITS;
  const recorderLimits: RecorderLimits = {
    maxRings: limits.maxRingsPerLayer,
    maxSegments: limits.maxTotalVertices,
  };

  const override = (options.overrides ?? PATTERN_GEOMETRY_OVERRIDES).find(
    (o) => o.patternType === layer.patternType,
  );

  let operands: KernelInput[];
  try {
    if (override) {
      operands = [...override.toGroups(layer, ctx)];
    } else {
      const gen = patternByName(layer.patternType);
      // Callers reach this only after the source has already refused an unknown
      // id; treat a miss here as no geometry rather than inventing a second
      // refusal path.
      if (!gen) return { kind: 'operands', operands: [] };
      const ops = recordGenerator(gen, layer.size, layer.params, ctx.tolerance, recorderLimits);
      operands = operandsForOps(ops, ctx.tolerance, ctx.engine);
    }
  } catch (error) {
    if (error instanceof PatternComplexityError) return { kind: 'overrun' };
    throw error;
  }

  const reaching = operandsReachingSquare(operands, layer.size);
  // RINGS, not operands. Decision 8's ceiling counts what enters the boolean
  // union, and one operand can carry several contours — every closed stroke is
  // an outer boundary plus its hole, a compound nonzero fill is however many
  // the generator drew, and an override group is unbounded. Counting operands
  // would let a layer push well past 20,000 rings into the kernel while
  // reporting a fraction of that.
  let rings = 0;
  for (const operand of reaching) rings += operand.contours.length;
  if (rings > limits.maxRingsPerLayer) return { kind: 'overrun' };
  return { kind: 'operands', operands: reaching };
}

/**
 * The pattern layer's geometry in DOCUMENT millimetres, y-down, as resolved
 * cubic rings. No Y flip — that belongs to `coordinate-frame.ts` alone
 * (Decision 1).
 */
export function patternLayerToRings(
  layer: PatternLayer,
  ctx: IrExtractContext,
  options: PatternGeometrySourceOptions = {},
): { readonly kind: 'rings'; readonly rings: KernelRing[] } | { readonly kind: 'overrun' } {
  const grouped = patternLayerToRingGroups(layer, ctx, options);
  if (grouped.kind === 'overrun') return grouped;
  return { kind: 'rings', rings: grouped.groups.flat() };
}

/**
 * The same geometry, kept split into the disjoint pieces the union produced.
 *
 * `extractCubics` hands these to `buildGerberIr` as SEPARATE operands rather
 * than as one compound group. That is what carries this module's whole
 * separation strategy across the boundary: the orchestrator runs its own
 * `arrange()` over everything a material layer contributes, and one compound
 * operand holding every ring of a dense pattern is precisely the input shape
 * path-bool mis-resolves (`kernel-limits.test.ts`).
 */
export function patternLayerToRingGroups(
  layer: PatternLayer,
  ctx: IrExtractContext,
  options: PatternGeometrySourceOptions = {},
): { readonly kind: 'groups'; readonly groups: KernelRing[][] } | { readonly kind: 'overrun' } {
  const operands = patternLayerToOperands(layer, ctx, options);
  if (operands.kind === 'overrun') return operands;
  const groups: KernelRing[][] = [];
  for (const component of unionComponents(ctx.engine, operands.operands)) {
    const clipped = clipRingsToSquare(component, layer.size, ctx.tolerance);
    if (clipped.length > 0)
      groups.push(clipped.map((ring) => translateRing(ring, layer.x, layer.y)));
  }
  return { kind: 'groups', groups };
}

export function createPatternGeometrySource(
  options: PatternGeometrySourceOptions = {},
): LayerGeometrySource {
  const overrides = options.overrides ?? PATTERN_GEOMETRY_OVERRIDES;

  const resolve = (
    layer: Layer,
    ctx: IrExtractContext,
  ): { groups: KernelRing[][] } | Extract<IrLayerResult, { kind: 'unsupported' }> => {
    const pattern = layer as PatternLayer;
    // `PatternLayer.patternType` is deliberately opaque data preserved even
    // when unrecognised (`types.ts:31-32`). The renderer draws nothing; the
    // export must not silently drop it either (Decision 8).
    if (
      !overrides.some((o) => o.patternType === pattern.patternType) &&
      !patternByName(pattern.patternType)
    ) {
      return unsupported(layer, 'unknown-pattern-id', pattern.patternType);
    }
    const result = patternLayerToRingGroups(pattern, ctx, { ...options, overrides });
    if (result.kind === 'overrun')
      return unsupported(layer, 'complexity-overrun', pattern.patternType);
    return { groups: result.groups };
  };

  return {
    handles: 'pattern',
    async extract(layer, ctx): Promise<IrLayerResult> {
      const result = resolve(layer, ctx);
      if ('kind' in result) return result;
      return {
        kind: 'regions',
        layerId: layer.id,
        regions: ringsToRegions(result.groups.flat(), ctx.tolerance),
      };
    },
    async extractCubics(layer, ctx): Promise<IrLayerCubicResult> {
      const result = resolve(layer, ctx);
      if ('kind' in result) return result;
      return {
        kind: 'cubics',
        layerId: layer.id,
        // ONE OPERAND PER DISJOINT PIECE, never one compound operand holding
        // the lot. Each piece's rings bound a planar set, so `nonzero` reads
        // their outer/hole nesting at any depth; keeping the pieces apart is
        // what stops the orchestrator's own arrangement from re-introducing the
        // exact-coincidence corruption this module avoided.
        groups: result.groups.map((contours) => ({ contours, fillRule: 'nonzero' as const })),
      };
    },
  };
}

/** The source `buildGerberIr` registers to take over the `pattern-layer` hand-off. */
export const patternGeometrySource: LayerGeometrySource = createPatternGeometrySource();
