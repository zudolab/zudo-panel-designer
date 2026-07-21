// Shared type contract for native SVG vector import (epic #137). The file
// classifier, the safety-gate parser, the follow-up IR extractor, the layer
// builder, and the import dialog all import from here so the contract has
// exactly one source of truth.
import type { PathPoint } from '@zpd/core';

export interface SvgImportDiagnostic {
  level: 'fatal' | 'warning';
  code: string;
  message: string;
}

// {minX, minY} preserve the source viewBox origin -- viewBox="-20 10 100 50"
// keeps minX=-20/minY=10, it is not re-origined here. The IR builder (a
// follow-up sub-issue) is what subtracts minX/minY when placing shapes into
// document space.
export interface SvgViewport {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

// One subpath of a shape, in SVG source/viewport space (not mm -- the
// builder scales+translates into document mm once the import target rect is
// known). Mirrors PathLayer's points/closed split, but a shape can carry
// several contours at once (a compound path: outer boundary + hole/island).
export interface IrContour {
  points: PathPoint[];
  closed: boolean;
}

// Contract: a shape with BOTH fill and stroke has all-closed contours; an
// open contour may only appear on a stroke-only shape (fillHex === null).
// The extractor (follow-up sub-issue) is responsible for upholding this --
// a source element that mixes fill+stroke with an open subpath gets split
// into two IrShapes (one fill-only closed, one stroke-only carrying the
// open contour) rather than producing a shape that violates it.
export interface IrShape {
  name: string;
  contours: IrContour[];
  fillHex: string | null;
  strokeHex: string | null;
  strokeWidth: number;
}

// The end-to-end result of importing one SVG file. status: 'fatal' means the
// document failed the safety gate (or had no usable viewport) -- shapes is
// always [] in that case. Every fatal is fallback-eligible: the caller
// re-imports the original file as a flat raster ImageLayer via the existing
// image-import path (import-image.ts), so no SVG reserialization is needed.
export interface SvgAnalysis {
  status: 'ok' | 'fatal';
  shapes: IrShape[];
  diagnostics: SvgImportDiagnostic[];
  sourceColors: string[];
  viewport: SvgViewport;
}
