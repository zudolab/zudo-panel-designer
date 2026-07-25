/**
 * Path Finder — the ten-op dispatcher and its eligibility table.
 *
 * One entry point so the panel (and any future keyboard/command binding) does
 * not re-derive per-op minimums or re-implement the back→front contract.
 */

import type { BooleanEngine } from '../geometry-kernel';
import { crop, divide, merge, trim } from './faces-ops';
import { outlineOp } from './outline-op';
import { applyShapeMode, type ShapeModeOp } from './shape-modes';
import type { EligibleLeaf, PathfinderOp, PathfinderOpResult } from './types';

/** Panel order: Shape Modes row, then the Pathfinders row. */
export const PATHFINDER_OPS: readonly PathfinderOp[] = [
  'unite',
  'minusFront',
  'intersect',
  'exclude',
  'divide',
  'trim',
  'merge',
  'crop',
  'outline',
  'minusBack',
] as const;

/**
 * Minimum eligible inputs per op.
 *
 * `divide` and `outline` need only ONE, because a single self-intersecting path
 * is a meaningful input to both: Divide splits it into its own lobes, Outline
 * cuts it at its own crossing. Every other op compares two regions and is
 * meaningless below two.
 */
export const MIN_ELIGIBLE_INPUTS: Record<PathfinderOp, 1 | 2> = {
  unite: 2,
  minusFront: 2,
  intersect: 2,
  exclude: 2,
  minusBack: 2,
  divide: 1,
  trim: 2,
  merge: 2,
  crop: 2,
  outline: 1,
};

/**
 * Whether an op can run at all on this many eligible inputs. This gates the
 * panel's enabled state; the ops enforce the same table themselves and return
 * an empty result rather than trusting the caller.
 */
export function canApplyPathfinderOp(op: PathfinderOp, eligibleCount: number): boolean {
  return eligibleCount >= MIN_ELIGIBLE_INPUTS[op];
}

/**
 * A multi-piece result is wrapped by the caller in a group; a single spec
 * becomes a lone layer; an empty result is a no-op. Spelled out here so the
 * "signal in the return type" convention is testable rather than folklore.
 */
export function shouldGroupResult(result: PathfinderOpResult): boolean {
  return result.specs.length > 1;
}

/**
 * Apply any of the ten ops to a back→front-ordered eligible selection
 * (`resolvePathfinderInputs`). Pass a shared engine to reuse the lazily
 * imported `path-bool` module across a batch.
 */
export function applyPathfinderOp(
  op: PathfinderOp,
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  switch (op) {
    case 'unite':
    case 'minusFront':
    case 'intersect':
    case 'exclude':
    case 'minusBack':
      return applyShapeMode(op satisfies ShapeModeOp, orderedInputs, engine);
    case 'divide':
      return divide(orderedInputs, engine);
    case 'trim':
      return trim(orderedInputs, engine);
    case 'merge':
      return merge(orderedInputs, engine);
    case 'crop':
      return crop(orderedInputs, engine);
    case 'outline':
      return outlineOp(orderedInputs, engine);
    default: {
      const exhaustive: never = op;
      throw new Error(`unhandled pathfinder op: ${String(exhaustive)}`);
    }
  }
}
