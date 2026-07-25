/**
 * Path Finder — Shape Modes ops.
 *
 * The five Illustrator Shape-Modes-row booleans:
 *   Unite · Minus Front · Intersect · Exclude · Minus Back
 * (Illustrator packs "Minus Back" in the second, Pathfinders row; it lives here
 * because it is the same `A − B` subtract as Minus Front with the z-role of the
 * kept shape flipped.)
 *
 * INPUT ORDER CONTRACT: `orderedInputs` is back→front (index 0 = backmost, last
 * = frontmost). See selection.ts for why that is load-bearing.
 *
 * Each op bakes every leaf into one compound kernel input, runs ONE boolean
 * over the shared arrangement, and groups the flat result rings into specs.
 *
 * STYLE INHERITANCE (op policy — whose fill/stroke the result adopts):
 *   Unite / Intersect / Exclude → topmost (frontmost) input
 *   Minus Front                 → backmost input (the shape kept)
 *   Minus Back                  → frontmost input (the shape kept)
 */

import {
  createBooleanEngine,
  type BooleanArrangement,
  type BooleanEngine,
  type KernelRing,
} from '../geometry-kernel';
import { leafToKernelInput, ringsToSpecs } from './convert';
import { pathfinderTarget } from './selection';
import { resolveInputStyle } from './style';
import type { EligibleLeaf, PathfinderOp, PathfinderOpResult } from './types';

/** The five Shape-Modes ops (subset of the ten-op {@link PathfinderOp}). */
export type ShapeModeOp = Extract<
  PathfinderOp,
  'unite' | 'minusFront' | 'intersect' | 'exclude' | 'minusBack'
>;

/** Illustrator panel labels — the `name` each result spec carries. */
const OP_LABELS: Record<ShapeModeOp, string> = {
  unite: 'Unite',
  minusFront: 'Minus Front',
  intersect: 'Intersect',
  exclude: 'Exclude',
  minusBack: 'Minus Back',
};

/** Minimum eligible inputs for any Shape Mode — below this it is a no-op. */
const MIN_ELIGIBLE = 2;

const EMPTY: PathfinderOpResult = { specs: [], target: null };

interface ShapeModePlan {
  /** Inputs in the order handed to the arrangement (subtract needs the kept shape at [0]). */
  inputs: EligibleLeaf[];
  /** The leaf whose style the result adopts. */
  styleLeaf: EligibleLeaf;
  select: (arrangement: BooleanArrangement) => KernelRing[];
}

/**
 * Resolve an op + back→front inputs into a concrete boolean plan.
 *
 * The kernel's `subtract()` computes `inputs[0] \ union(inputs[1..])`, so the
 * two subtract ops differ only in which leaf they promote to `inputs[0]`:
 *   - Minus Front keeps the BACKMOST → natural order (`inputs[0]` already is).
 *   - Minus Back keeps the FRONTMOST → move it to `inputs[0]`; the rest keep
 *     any order, since they are all unioned into the subtrahend.
 */
function planShapeMode(op: ShapeModeOp, orderedInputs: EligibleLeaf[]): ShapeModePlan {
  const backmost = orderedInputs[0]!;
  const frontmost = orderedInputs[orderedInputs.length - 1]!;
  switch (op) {
    case 'unite':
      return { inputs: orderedInputs, styleLeaf: frontmost, select: (a) => a.unite() };
    case 'intersect':
      return { inputs: orderedInputs, styleLeaf: frontmost, select: (a) => a.intersect() };
    case 'exclude':
      return { inputs: orderedInputs, styleLeaf: frontmost, select: (a) => a.exclude() };
    case 'minusFront':
      return { inputs: orderedInputs, styleLeaf: backmost, select: (a) => a.subtract() };
    case 'minusBack':
      return {
        inputs: [frontmost, ...orderedInputs.slice(0, -1)],
        styleLeaf: frontmost,
        select: (a) => a.subtract(),
      };
    default: {
      const exhaustive: never = op;
      throw new Error(`unhandled shape-mode op: ${String(exhaustive)}`);
    }
  }
}

/**
 * Apply one Shape Mode to a back→front-ordered eligible selection.
 *
 * `engine` is optional: pass a shared {@link BooleanEngine} to avoid re-awaiting
 * the lazy `path-bool` import across a batch of ops; omit it and one is created
 * (the module import is cached, so that is cheap after the first load).
 */
export async function applyShapeMode(
  op: ShapeModeOp,
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < MIN_ELIGIBLE) return EMPTY;

  const eng = engine ?? (await createBooleanEngine());
  const plan = planShapeMode(op, orderedInputs);
  const arrangement = eng.arrange(plan.inputs.map((leaf) => leafToKernelInput(leaf)));
  const rings = plan.select(arrangement);
  if (rings.length === 0) return EMPTY;

  const specs = ringsToSpecs(rings, resolveInputStyle(plan.styleLeaf), OP_LABELS[op]);
  if (specs.length === 0) return EMPTY;
  return { specs, target: pathfinderTarget(orderedInputs) };
}

// ─── Per-op entrypoints ─────────────────────────────────────────────────────

export function unite(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  return applyShapeMode('unite', orderedInputs, engine);
}

export function minusFront(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  return applyShapeMode('minusFront', orderedInputs, engine);
}

export function intersect(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  return applyShapeMode('intersect', orderedInputs, engine);
}

export function exclude(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  return applyShapeMode('exclude', orderedInputs, engine);
}

export function minusBack(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  return applyShapeMode('minusBack', orderedInputs, engine);
}
