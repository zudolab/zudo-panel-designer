// Gerber geometry IR — the single import surface for the downstream Gerber
// sub-issues (#210 writer, #211 pattern recorder, #212 text outliner, #215
// export UI). `DECISIONS.md`, next to this file, is the authoritative spec.

export type {
  GerberIr,
  GerberRefusal,
  GerberRefusalCode,
  IrExtractContext,
  IrLayer,
  IrLayerCubicResult,
  IrLayerResult,
  IrLayerRole,
  IrPanel,
  IrPoint,
  IrRegion,
  IrRing,
  IrUnsupportedReason,
  LayerGeometrySource,
} from './ir';

export type { IrComplexityLimits, IrTolerance } from './tolerance';
export {
  DEFAULT_IR_LIMITS,
  DEFAULT_IR_TOLERANCE,
  INITIAL_ELLIPSE_SEGMENTS,
  IR_TOTAL_TOLERANCE_MM,
  MAX_ELLIPSE_SEGMENTS,
  MAX_FLATTEN_DEPTH,
} from './tolerance';

export type { BuildGerberIrOptions, BuildGerberIrResult } from './build-ir';
export { buildGerberIr } from './build-ir';

export {
  BUILTIN_GEOMETRY_SOURCES,
  imageGeometrySource,
  pathGeometrySource,
  pathLayerToGroups,
  patternHandoffSource,
  shapeGeometrySource,
  shapeLayerToGroups,
  subpathToCubics,
  textHandoffSource,
} from './extract';

export type { StrokeCap, StrokeJoin, StrokeStyle, StrokeSubpath } from './stroker';
export { CANVAS_DEFAULT_JOIN_STYLE, maxTurnForHalfWidth, strokeSubpathsToInputs } from './stroker';

export {
  circularArcToCubics,
  ellipseToRing,
  ellipticalArcToCubics,
  measureArcDeviation,
} from './arc';
export {
  collapseRingVertices,
  flattenChain,
  flattenCubicInto,
  flattenRingAdaptive,
  polygonSignedArea,
} from './flatten';
export { degenerateCubic, polygonToRing, rectToRing, splitPointTouchingLobes } from './primitives';
export { countRegionVertices, ringsToRegions } from './regions';
