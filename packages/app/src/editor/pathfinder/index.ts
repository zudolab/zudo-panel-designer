/**
 * Path Finder ops — the single import surface (epic #204, sub #208).
 *
 * Import from here, not from the individual files. Everything below sits on the
 * shared geometry kernel (`../geometry-kernel`); nothing here belongs in the
 * kernel, because all of it is op policy the Gerber exporter must not inherit.
 */

export type {
  EligibleLeaf,
  PathfinderOp,
  PathfinderOpResult,
  PathfinderTarget,
  ResolvedInputStyle,
} from './types';

export { resolveInputStyle } from './style';

export {
  bakeExtraSubpaths,
  bakePathContour,
  bakePathLeaf,
  bakeShapeLeaf,
  isDegenerateContour,
  leafToKernelInput,
  ringsToSpecs,
  specHoleRings,
  specOuterRing,
} from './convert';

export { pathfinderTarget, resolvePathfinderInputs } from './selection';

export type { ShapeModeOp } from './shape-modes';
export { applyShapeMode, exclude, intersect, minusBack, minusFront, unite } from './shape-modes';

export {
  crop,
  divide,
  faceRepresentativePoint,
  merge,
  pointInFilledContours,
  pointInFilledRing,
  scanlineInteriorPoint,
  trim,
  windingNumber,
} from './faces-ops';

export { OUTLINE_EDGE_STROKE_WIDTH_MM, outlineOp } from './outline-op';

export {
  applyPathfinderOp,
  canApplyPathfinderOp,
  MIN_ELIGIBLE_INPUTS,
  PATHFINDER_OPS,
  shouldGroupResult,
} from './dispatch';

export type { PathfinderApplyResult } from './mutation';
export { applyPathfinderResult, PATHFINDER_OP_LABELS, specToPathLayer } from './mutation';

export type {
  PathfinderHost,
  PathfinderNoOpReason,
  PathfinderRevision,
  PathfinderRunner,
  PathfinderRunnerOptions,
  PathfinderRunOutcome,
  PathfinderStaleReason,
} from './runner';
export { createPathfinderRunner, pathfinderRevision } from './runner';
