// Pure IR-to-PathLayer builder for native SVG vector import (#137, sub #140).
// Converts a validated SvgAnalysis into document-space (mm) PathLayers. No
// DOM/canvas access, no id minting of its own (see BuildPathLayersOptions.makeId)
// -- fully deterministic for identical inputs, so a live dialog preview can
// call this on every keystroke of the color-mapping UI without side effects.
import {
  pcbLayerRoleForColor,
  snapToGrid,
  type ColorIndex,
  type PathLayer,
  type PathPoint,
} from '@zpd/core';
import type { IrContour, SvgAnalysis, SvgImportDiagnostic, SvgViewport } from './types';

// MAX_TRACE_LAYERS precedent in svg-to-path-layers.ts -- same ceiling, but
// here it is a hard refusal (fatal) rather than a silent break/truncate: a
// truncated vector import would quietly drop shapes the user asked for.
const MAX_LAYERS = 300;

export interface BuildPathLayersOptions {
  panelWidthMm: number;
  panelHeightMm: number;
  colorMappings: Record<string, ColorIndex>;
  // Injected rather than calling core's mintId directly -- a live preview
  // passes a deterministic counter factory (re-renders don't burn global
  // ids), the final import passes mintId. Keeps this module pure.
  makeId: (prefix: string) => string;
}

export type BuildPathLayersResult =
  { ok: true; layers: PathLayer[] } | { ok: false; fatal: SvgImportDiagnostic };

function fatal(code: string, message: string): BuildPathLayersResult {
  return { ok: false, fatal: { level: 'fatal', code, message } };
}

// Exact-coverage check: colorMappings must name precisely the hexes
// sourceColors lists -- a missing hex would leave a shape unmapped, an
// unknown hex is a stale/misapplied mapping from a different analysis.
function colorMappingsMismatch(
  sourceColors: string[],
  colorMappings: Record<string, ColorIndex>,
): boolean {
  const sourceSet = new Set(sourceColors);
  const mappingKeys = Object.keys(colorMappings);
  if (mappingKeys.length !== sourceSet.size) return true;
  for (const hex of sourceSet) {
    if (!(hex in colorMappings)) return true;
  }
  return false;
}

// Maps one point (anchor or handle) from SVG viewport space into document mm
// space: viewport-relative so a non-zero viewBox origin (viewBox="-20 10 ...")
// still lands correctly, then uniform-scaled and placed at the snapped origin.
function projectPoint(
  p: { x: number; y: number },
  viewport: SvgViewport,
  scale: number,
  originX: number,
  originY: number,
): { x: number; y: number } {
  return {
    x: (p.x - viewport.minX) * scale + originX,
    y: (p.y - viewport.minY) * scale + originY,
  };
}

function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFinitePathPoint(p: PathPoint): boolean {
  return isFinitePoint(p) && (!p.hin || isFinitePoint(p.hin)) && (!p.hout || isFinitePoint(p.hout));
}

function isFiniteLayer(layer: PathLayer): boolean {
  return (
    Number.isFinite(layer.strokeWidth) &&
    layer.points.every(isFinitePathPoint) &&
    (layer.extraSubpaths ?? []).every((subpath) => subpath.every(isFinitePathPoint))
  );
}

function projectPathPoint(
  p: PathPoint,
  viewport: SvgViewport,
  scale: number,
  originX: number,
  originY: number,
): PathPoint {
  const out: PathPoint = projectPoint(p, viewport, scale, originX, originY);
  if (p.hin) out.hin = projectPoint(p.hin, viewport, scale, originX, originY);
  if (p.hout) out.hout = projectPoint(p.hout, viewport, scale, originX, originY);
  return out;
}

export function buildPathLayers(
  analysis: SvgAnalysis,
  opts: BuildPathLayersOptions,
): BuildPathLayersResult {
  if (analysis.status !== 'ok') {
    return fatal('invalid-analysis', 'SVG analysis did not complete successfully.');
  }
  if (opts.panelWidthMm <= 0 || opts.panelHeightMm <= 0) {
    return fatal('invalid-panel-dimensions', 'Panel dimensions must be positive.');
  }
  if (analysis.shapes.length === 0) {
    return fatal('no-shapes', 'SVG contains no importable shapes.');
  }
  if (colorMappingsMismatch(analysis.sourceColors, opts.colorMappings)) {
    return fatal(
      'color-mapping-mismatch',
      "colorMappings must cover exactly the SVG's source colors.",
    );
  }

  const { viewport } = analysis;
  // Fit-and-center per importImageFile (import-image.ts:16-27), with two
  // documented divergences: no `1` cap on the scale (vectors may upscale --
  // SVG user units are arbitrary, there is no pixelation to protect against),
  // and only the placement origin is snapped, never the dimensions or the
  // individual points (point fidelity beats grid alignment for vector data).
  const scale = Math.min(
    (0.8 * opts.panelWidthMm) / viewport.width,
    (0.5 * opts.panelHeightMm) / viewport.height,
  );
  // A viewBox can pass the parser's `width > 0 && isFinite` gate and still be
  // denormal (viewBox="0 0 1e-320 1e-320"), which overflows this ratio to
  // Infinity and projects every coordinate to NaN. Refused here: committing
  // non-finite coordinates would put the document into a state nothing
  // downstream (bbox, hit-test, serialization) can recover from.
  if (!Number.isFinite(scale) || scale <= 0) {
    return fatal(
      'non-finite-geometry',
      'SVG viewport produces an unusable import scale (degenerate viewBox).',
    );
  }
  const originX = snapToGrid(0.1 * opts.panelWidthMm);
  const originY = snapToGrid(0.15 * opts.panelHeightMm);

  const project = (points: PathPoint[]): PathPoint[] =>
    points.map((p) => projectPathPoint(p, viewport, scale, originX, originY));

  const layers: PathLayer[] = [];
  for (const shape of analysis.shapes) {
    const fill = shape.fillHex === null ? null : opts.colorMappings[shape.fillHex];
    const stroke = shape.strokeHex === null ? null : opts.colorMappings[shape.strokeHex];
    const strokeWidth = stroke === null ? 0 : shape.strokeWidth * scale;
    const allClosed = shape.contours.every((c: IrContour) => c.closed);

    if (allClosed) {
      const [primary, ...rest] = shape.contours;
      layers.push({
        id: opts.makeId('svg'),
        name: shape.name,
        type: 'path',
        points: project(primary.points),
        ...(rest.length > 0 ? { extraSubpaths: rest.map((c) => project(c.points)) } : {}),
        closed: true,
        fill,
        stroke,
        strokeWidth,
      });
    } else {
      // A stroke-only shape (only stroke-only shapes may carry open contours,
      // see the IrShape contract in types.ts) with at least one open contour
      // fans out to one PathLayer per contour: buildPath2D force-closes
      // extraSubpaths (path-geometry.ts:40-52), so open contours can never
      // ride as extras on a shared layer without silently becoming closed.
      for (const contour of shape.contours) {
        layers.push({
          id: opts.makeId('svg'),
          name: shape.name,
          type: 'path',
          points: project(contour.points),
          closed: contour.closed,
          fill,
          stroke,
          strokeWidth,
        });
      }
    }
  }

  // A fixed physical container cannot represent a path whose fill and stroke
  // map to different materials. Preserve both source mappings by splitting
  // that paint pair into independently routable ordinary paths; the SVG
  // dialog's preview uses this exact output too.
  const materialized = layers.flatMap((layer) => {
    if (
      layer.fill !== null &&
      layer.stroke !== null &&
      pcbLayerRoleForColor(layer.fill) !== pcbLayerRoleForColor(layer.stroke)
    ) {
      return [
        { ...layer, stroke: null, strokeWidth: 0 },
        { ...layer, id: opts.makeId('svg'), fill: null },
      ];
    }
    return [layer];
  });

  if (materialized.length > MAX_LAYERS) {
    return fatal(
      'too-many-layers',
      `SVG produces ${materialized.length} layers, exceeding the ${MAX_LAYERS} import limit.`,
    );
  }

  // A sane scale is not enough: extreme-but-finite source coordinates (an
  // overflowing transform composition, a huge stroke-width) still overflow to
  // Infinity/NaN once projected. Same refusal as the degenerate scale above.
  if (!materialized.every(isFiniteLayer)) {
    return fatal(
      'non-finite-geometry',
      'SVG projects to non-finite coordinates and cannot be imported.',
    );
  }

  return { ok: true, layers: materialized };
}
