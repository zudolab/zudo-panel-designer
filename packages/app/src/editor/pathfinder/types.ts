/**
 * Path Finder — shared contracts (epic #204, sub #208).
 *
 * The op layer sits on top of the geometry kernel (`../geometry-kernel`) and
 * is the ONLY place that knows about Illustrator-style op names, selection
 * eligibility, style inheritance policy, and where a result lands in the
 * document. The kernel deliberately knows none of that (see its README) so the
 * Gerber exporter can share it without dragging the Path Finder UI along.
 *
 * No runtime code here — policy constants live with the code that applies
 * them (`selection.ts`, `dispatch.ts`).
 */

import type { ColorIndex, PcbLayerRole } from '@zpd/core';
import type { KernelLeaf, KernelPathSpec } from '../geometry-kernel';

/**
 * The ten Illustrator-panel operations. Two rows:
 *   Shape Modes  — unite, minusFront, intersect, exclude
 *   Pathfinders  — divide, trim, merge, crop, outline, minusBack
 * (`merge` is Illustrator's "Merge"; the engine-level union is `unite`.)
 */
export type PathfinderOp =
  | 'unite'
  | 'minusFront'
  | 'intersect'
  | 'exclude'
  | 'minusBack'
  | 'divide'
  | 'trim'
  | 'merge'
  | 'crop'
  | 'outline';

/**
 * One selection leaf a Path Finder op may consume: a visible `path` or `shape`
 * leaf, already in world millimetres (zpd bakes every transform into the leaf,
 * so there is nothing to project).
 *
 * `role` is the fixed material container the leaf currently lives in. It is
 * carried on the leaf rather than looked up later because a selection may span
 * containers, and the destination rule ({@link PathfinderTarget}) needs to know
 * which one the FRONTMOST input came from after the ops have discarded
 * everything else about the inputs.
 */
export interface EligibleLeaf extends KernelLeaf {
  role: PcbLayerRole;
}

/**
 * Where a result should land. Resolved by `pathfinderTarget` (selection.ts) —
 * see that function for the cross-material rule and its consequences.
 *
 * Committing the specs into the document (minting ids, inserting at the slot,
 * grouping a multi-spec result, one undo entry) is the UI sub-issue's job, not
 * this layer's.
 */
export interface PathfinderTarget {
  /** Material container the result belongs to. */
  role: PcbLayerRole;
  /** Id of the frontmost eligible input — the z-slot the result takes over. */
  frontmostLeafId: string;
}

/**
 * The result of applying one op to a selection.
 *
 *   - `specs.length === 0` → NO-OP. Fired when the op is under its minimum
 *     input count, or when the boolean's true result is empty (Intersect of
 *     disjoint shapes, a subtract that removes everything, or a result made
 *     entirely of sub-ε slivers the kernel drops). The caller commits nothing.
 *   - `specs.length === 1` → a single result layer.
 *   - `specs.length  >  1` → multi-piece; the caller groups them.
 *
 * `target` is non-null exactly when `specs` is non-empty.
 */
export interface PathfinderOpResult {
  specs: KernelPathSpec[];
  target: PathfinderTarget | null;
}

/**
 * Canonical paint for one input leaf, in zpd's flat model: two nullable
 * palette indices and a width. There is no `ColorRef`, no `ColorScheme` and no
 * gradient anywhere in zpd, so nothing here needs a resolution context — this
 * is a pure read of the leaf.
 */
export interface ResolvedInputStyle {
  fill: ColorIndex | null;
  stroke: ColorIndex | null;
  strokeWidth: number;
}
