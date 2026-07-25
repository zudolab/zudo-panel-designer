// Geometry kernel — the single import surface for both consumers (Path Finder
// ops #202, Gerber geometry IR #203). Import from here, not from the files
// directly, so the kernel's internals stay free to move.
//
// NOTE: importing this barrel does NOT pull `path-bool` into your chunk —
// `createBooleanEngine` loads it lazily on first call. See engine.ts.

export type {
  BooleanArrangement,
  BooleanEngine,
  KernelCubic,
  KernelEpsilons,
  KernelFillRule,
  KernelInput,
  KernelLeaf,
  KernelPathSpec,
  KernelPoint,
  KernelRing,
  PathPoint,
  SegmentIntersection,
} from './types';

export type { CubicSplit } from './geometry';
export {
  cubicSignedArea,
  flattenRing,
  KAPPA,
  pointInPolygon,
  reverseRing,
  ringInteriorPoint,
  ringSignedArea,
  sampleCubicAt,
  splitCubicAt,
} from './geometry';

export { createBooleanEngine, DEFAULT_MM_EPSILONS } from './engine';
