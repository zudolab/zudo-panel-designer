/**
 * The differential parity harness (#211's acceptance), shared by the parity
 * suites. Test-only: nothing in the app imports it.
 *
 * One run = one generator at one parameter set, rendered twice:
 *
 *   generator ──▶ ReferenceCanvas ──▶ mask A     (the editor's semantics)
 *   generator ──▶ PatternRecorder ──▶ kernel union ──▶ square clip
 *                 ──▶ IrRegion[] ──▶ mask B      (what gets manufactured)
 *
 * Both masks cover exactly the pattern square, so `renderer.ts:407-411`'s clip
 * is reproduced on the reference side by construction and has to be earned on
 * the vector side.
 */

import type { PatternLayer } from '@zpd/core';
import type { PanelPatternGenerator } from '@zpd/patterns';
import { flattenRing, type BooleanEngine } from '../geometry-kernel';
import type { IrExtractContext, IrPanel, IrRegion } from './ir';
import {
  patternLayerToOperands,
  patternLayerToRings,
  type PatternGeometrySourceOptions,
} from './pattern-source';
import { ringsToRegions } from './regions';
import {
  compareMasks,
  fillPolygons,
  fillRegions,
  Mask,
  ReferenceCanvas,
  type MaskComparison,
} from './raster-oracle';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const PANEL: IrPanel = { format: '3U', hp: 16, widthMm: 80.9, heightMm: 128.5 };

/** Control-flow marker for `recorderOnly`; never surfaces as a union error. */
class SkipUnion extends Error {}

export interface ParityOptions {
  readonly sizeMm: number;
  readonly pixels: number;
  readonly params: Record<string, number>;
  readonly source?: PatternGeometrySourceOptions;
  /**
   * Measure only the recorder's own output. The union is by far the expensive
   * half and it is the #206 kernel's, not #211's, so the recorder sweeps skip
   * it and the end-to-end sweep pays for it once.
   */
  readonly recorderOnly?: boolean;
}

export interface ParityResult extends MaskComparison {
  readonly regions: readonly IrRegion[];
  readonly reference: Mask;
  readonly vector: Mask;
  readonly ms: number;
  /**
   * The same comparison against the RECORDED, stroke-expanded, square-clipped
   * operand set, before the kernel unions it. This is #211's own output; the
   * `vector` mask above additionally depends on the #206 kernel's union, so
   * running both is what attributes a failure to one side or the other.
   */
  readonly recorder: MaskComparison;
  readonly operandCount: number;
  /**
   * Set when the kernel's union threw. Captured rather than propagated so a
   * kernel failure is reported as what it is instead of masking the recorder's
   * own — verified — result behind the same stack trace.
   */
  readonly unionError: string | null;
}

export function extractContext(engine: BooleanEngine): IrExtractContext {
  return { panel: PANEL, role: 'copper', engine, tolerance: DEFAULT_IR_TOLERANCE };
}

export function patternLayer(
  gen: string,
  sizeMm: number,
  params: Record<string, number>,
): PatternLayer {
  return {
    id: `parity-${gen}`,
    name: gen,
    type: 'pattern',
    patternType: gen,
    params,
    color: 1,
    // The square sits at the document origin so doc space and the generator's
    // local space coincide and one raster grid serves both sides.
    x: 0,
    y: 0,
    size: sizeMm,
  };
}

export function runParity(
  gen: PanelPatternGenerator,
  engine: BooleanEngine,
  options: ParityOptions,
): ParityResult {
  const { sizeMm, pixels, params } = options;

  const reference = new Mask(0, 0, sizeMm, pixels);
  const oracle = new ReferenceCanvas(reference);
  gen.draw(oracle as unknown as CanvasRenderingContext2D, {
    widthMm: sizeMm,
    heightMm: sizeMm,
    color: '#000000',
    params,
  });

  const layer = patternLayer(gen.name, sizeMm, params);
  const ctx = extractContext(engine);
  const source = options.source ?? {};

  const operands = patternLayerToOperands(layer, ctx, source);
  if (operands.kind === 'overrun') throw new Error(`${gen.name}: unexpected complexity overrun`);
  const recorderMask = new Mask(0, 0, sizeMm, pixels);
  for (const operand of operands.operands) {
    fillPolygons(
      recorderMask,
      operand.contours.map((ring) => flattenRing(ring, 16)),
      operand.fillRule,
    );
  }

  const started = Date.now();
  let regions: IrRegion[] = [];
  let unionError: string | null = null;
  try {
    if (options.recorderOnly) throw new SkipUnion();
    const result = patternLayerToRings(layer, ctx, source);
    if (result.kind === 'overrun') throw new Error(`${gen.name}: unexpected complexity overrun`);
    regions = ringsToRegions(result.rings, DEFAULT_IR_TOLERANCE);
  } catch (error) {
    if (!(error instanceof SkipUnion)) {
      unionError = error instanceof Error ? error.message : String(error);
    }
  }
  const ms = Date.now() - started;

  const vector = new Mask(0, 0, sizeMm, pixels);
  fillRegions(vector, regions);

  return {
    ...compareMasks(reference, vector),
    regions,
    reference,
    vector,
    ms,
    recorder: compareMasks(reference, recorderMask),
    operandCount: operands.operands.length,
    unionError,
  };
}

/** Minimum / maximum of every declared parameter — the extreme sweeps. */
export function extremeParams(
  gen: PanelPatternGenerator,
  which: 'min' | 'max',
): Record<string, number> {
  const params: Record<string, number> = {};
  for (const def of gen.paramDefs) params[def.key] = which === 'min' ? def.min : def.max;
  return params;
}

export function defaultParamsOf(gen: PanelPatternGenerator): Record<string, number> {
  const params: Record<string, number> = {};
  for (const def of gen.paramDefs) params[def.key] = def.defaultValue;
  return params;
}

export interface UnionSweepSpec {
  readonly label: string;
  readonly set: { readonly sizeMm: number; readonly pixels: number };
  readonly tolerance: number;
  readonly params: (gen: PanelPatternGenerator) => Record<string, number>;
}

/**
 * The three parameter sets swept for BOTH recorder-only parity
 * (`pattern-parity.test.ts`'s per-generator tests) and the end-to-end union
 * measurement below — a single source so the two can never silently drift
 * apart, and so "verified" means verified across the range a `PatternLayer`
 * actually exposes, not just at its defaults.
 *
 * The union sweep MUST cover more than defaults: a codex review of #215
 * caught `grid-lines` corrupting end-to-end ONLY when `pitch` and `lineWidth`
 * are BOTH at their minimum (2 mm, 0.1 mm) — exactly the 'min' spec below,
 * invisible to a default-only sweep, and a real, un-refused combination a
 * `PatternLayer`'s `size`/`params` can reach in the app.
 */
export const UNION_SWEEP_SPECS: readonly UnionSweepSpec[] = [
  {
    label: 'default parameters',
    set: { sizeMm: 24, pixels: 480 }, // 0.05 mm/px
    tolerance: 0.02,
    params: defaultParamsOf,
  },
  {
    label: 'every parameter at its minimum',
    set: { sizeMm: 16, pixels: 320 }, // 0.05 mm/px
    tolerance: 0.05,
    params: (gen) => extremeParams(gen, 'min'),
  },
  {
    label: 'every parameter at its maximum',
    set: { sizeMm: 16, pixels: 320 }, // 0.05 mm/px
    tolerance: 0.05,
    params: (gen) => extremeParams(gen, 'max'),
  },
];

export interface UnionReliabilityEntry {
  readonly name: string;
  /** e.g. "default parameters: 168641px, 80.3%; every parameter at its minimum: threw: …". */
  readonly detail: string;
}

/**
 * Every registered generator whose END-TO-END result (record → kernel union
 * → square clip) disagrees with the independent reference render at ANY of
 * `specs` — the measurement `pattern-union-unreliable.generated.ts` is
 * generated from (#218), and what `pattern-parity.test.ts` re-measures on
 * every run to catch that file drifting from reality. A generator is
 * reliable only if it survives EVERY spec — one bad parameter combination
 * anywhere in the sweep is enough to refuse it (Decision 8's "refuse rather
 * than ship a plausible-looking wrong file" applied to the measurement
 * itself, not only to the export path).
 *
 * ASYNC, and yields to the event loop between generators, even though every
 * individual step is synchronous CPU work. 62 generators × 3 specs of real
 * kernel unions run ~75s back to back with the default `UNION_SWEEP_SPECS` —
 * long enough to starve vitest's own worker↔main RPC heartbeat, which has a
 * hardcoded, non-configurable 60s timeout (`[vitest-worker]: Timeout calling
 * "onTaskUpdate"`, observed reliably once this sweep grew past defaults-only
 * to cover the parameter extremes too). A `setTimeout(0)` between generators
 * breaks the block into ~62 short slices instead of one long one.
 */
export async function measureUnionUnreliability(
  engine: BooleanEngine,
  generators: readonly PanelPatternGenerator[],
  specs: readonly UnionSweepSpec[] = UNION_SWEEP_SPECS,
): Promise<UnionReliabilityEntry[]> {
  const entries: UnionReliabilityEntry[] = [];
  for (const gen of generators) {
    const failures: string[] = [];
    for (const spec of specs) {
      const result = runParity(gen, engine, { ...spec.set, params: spec.params(gen) });
      if (result.unionError) {
        failures.push(`${spec.label}: threw: ${result.unionError}`);
      } else if (result.deep > 0 || result.areaError > spec.tolerance) {
        failures.push(
          `${spec.label}: ${result.deep}px, ${(result.areaError * 100).toFixed(1)}%`,
        );
      }
    }
    if (failures.length > 0) entries.push({ name: gen.name, detail: failures.join('; ') });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return entries;
}

/** `measureUnionUnreliability`'s names alone, sorted — the exporter's shape. */
export async function measureUnionUnreliableNames(
  engine: BooleanEngine,
  generators: readonly PanelPatternGenerator[],
  specs: readonly UnionSweepSpec[] = UNION_SWEEP_SPECS,
): Promise<string[]> {
  return (await measureUnionUnreliability(engine, generators, specs))
    .map((entry) => entry.name)
    .sort();
}
