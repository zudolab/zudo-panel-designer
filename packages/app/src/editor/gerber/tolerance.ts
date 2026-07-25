/**
 * Decision 6's error budget, in one place.
 *
 * Total geometric error 5 µm, split in two because the two stages ADD:
 * a 2.5 µm flattener downstream of a 17 µm arc approximation does not produce
 * 5 µm geometry. Both halves are enforced by measurement, not by a transcribed
 * error formula — see `arc.ts` and `flatten.ts`.
 */

export interface IrTolerance {
  /** Arc → cubic approximation, ≤ 2.5 µm (Decision 6.1). */
  readonly arcMm: number;
  /** Cubic → polyline flattening, max chord deviation ≤ 2.5 µm (Decision 6.2). */
  readonly flattenMm: number;
  /**
   * Consecutive vertices closer than this collapse; also the shortest segment
   * the flattener will emit. 1 µm (Decision 6.2).
   */
  readonly minSegmentMm: number;
}

export const DEFAULT_IR_TOLERANCE: IrTolerance = {
  arcMm: 0.0025,
  flattenMm: 0.0025,
  minSegmentMm: 0.001,
};

/** Total budget, asserted end-to-end by the r = 64 mm ellipse test. */
export const IR_TOTAL_TOLERANCE_MM = DEFAULT_IR_TOLERANCE.arcMm + DEFAULT_IR_TOLERANCE.flattenMm;

/** Recursion bound for the adaptive flattener (Decision 6.2). */
export const MAX_FLATTEN_DEPTH = 24;

/** Ceiling on cubics per full ellipse before the measured loop gives up (Decision 6.1). */
export const MAX_ELLIPSE_SEGMENTS = 256;

/** Cubics per full ellipse to start the measured subdivision from (Decision 6.1). */
export const INITIAL_ELLIPSE_SEGMENTS = 8;

/**
 * Complexity ceilings (Decision 8). The ring ceiling is per material layer
 * entering the boolean union; the vertex ceiling is across the whole assembled
 * IR. Both are far beyond any legitimate panel design and well short of what
 * hangs the tab.
 */
export interface IrComplexityLimits {
  readonly maxRingsPerLayer: number;
  readonly maxTotalVertices: number;
}

export const DEFAULT_IR_LIMITS: IrComplexityLimits = {
  maxRingsPerLayer: 20_000,
  maxTotalVertices: 2_000_000,
};
