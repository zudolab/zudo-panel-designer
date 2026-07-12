// Browser-only half of the image -> vector pipeline: raster source ->
// downscaled ImageData -> @image-tracer-ts SVG string. Needs a real <canvas>,
// so it is exercised via /headless-browser rather than unit tests; the
// DOM-free half (SVG -> PathLayer[]) lives in svg-to-path-layers.ts.
//
// @image-tracer-ts/browser reads the global `ImageData` at its own MODULE TOP
// LEVEL (not just when called), and jsdom doesn't provide one — a static
// import here would crash every test that transitively imports the dialogs
// folder (import.meta.glob eager-loads all of dialogs/*), including tests
// that never touch tracing. A dynamic import defers that read to when
// traceToSvg() actually runs, which real browsers (where ImageData always
// exists) do immediately and jsdom tests never do at all.
import { PALETTE } from '@zpd/core';

export interface TraceOptions {
  usePalette: boolean; // quantize directly to the fixed 3-color panel palette
  numberOfColors: number; // free-color mode only
  minShapeOutline: number;
  blurRadius: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  usePalette: true,
  numberOfColors: 4,
  minShapeOutline: 12,
  blurRadius: 0,
};

// Longest side a source image is downscaled to before tracing — keeps the
// live preview responsive regardless of the uploaded image's resolution.
const MAX_TRACE_SIDE = 600;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function imageToImageData(img: HTMLImageElement): ImageData {
  const scale = Math.min(1, MAX_TRACE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  // flatten alpha onto white so a transparent background doesn't get sampled
  // into the traced palette as a phantom color
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function traceToSvg(imageData: ImageData, options: TraceOptions): Promise<string> {
  const { CreatePaletteMode, ImageTracerBrowser } = await import('@image-tracer-ts/browser');
  const base = {
    minShapeOutline: options.minShapeOutline,
    blurRadius: options.blurRadius,
    lineErrorMargin: 1,
    curveErrorMargin: 1,
  };
  const paletteOptions = options.usePalette
    ? {
        colorSamplingMode: CreatePaletteMode.PALETTE,
        palette: PALETTE.map((entry) => ({ ...hexToRgb(entry.hex), a: 255 })),
        numberOfColors: PALETTE.length,
      }
    : { numberOfColors: options.numberOfColors };
  const svg = await ImageTracerBrowser.fromImageData(imageData, { ...base, ...paletteOptions });
  return typeof svg === 'string' ? svg : String(svg);
}
