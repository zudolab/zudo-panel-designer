// The analyzer's public entry point (#139): raw SVG text in, SvgAnalysis out.
// Composition only -- the safety gate (parse-svg-document.ts) and the IR
// extractor (extract-shapes.ts) hold the logic.
import { extractShapes } from './extract-shapes';
import { parseSvgDocument } from './parse-svg-document';
import type { SvgAnalysis, SvgViewport } from './types';

// Reported alongside a fatal so callers never have to null-check the
// viewport; shapes are empty in that case anyway.
const NO_VIEWPORT: SvgViewport = { minX: 0, minY: 0, width: 0, height: 0 };

export function analyzeSvg(svgText: string): SvgAnalysis {
  const parsed = parseSvgDocument(svgText);
  if (parsed.status === 'fatal') {
    return {
      status: 'fatal',
      shapes: [],
      diagnostics: parsed.diagnostics,
      sourceColors: [],
      viewport: NO_VIEWPORT,
    };
  }

  const diagnostics = [...parsed.diagnostics];
  const { shapes, sourceColors } = extractShapes(parsed.root, parsed.viewport, diagnostics);
  // A fatal raised mid-extraction invalidates everything extracted before it:
  // the caller falls back to raster import, so a half-built shape list would
  // only be a trap.
  if (diagnostics.some((diagnostic) => diagnostic.level === 'fatal')) {
    return {
      status: 'fatal',
      shapes: [],
      diagnostics,
      sourceColors: [],
      viewport: parsed.viewport,
    };
  }
  return { status: 'ok', shapes, diagnostics, sourceColors, viewport: parsed.viewport };
}
