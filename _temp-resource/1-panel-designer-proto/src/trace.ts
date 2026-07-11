// Image -> vector pipeline (mirrors pgen's imagetracer flow, shrunk to the
// fixed 3-color palette): raster -> @image-tracer-ts SVG -> cubic-bezier
// PathLayers with palette-index colors, scaled into the source layer's mm rect.
import { CreatePaletteMode, ImageTracerBrowser } from '@image-tracer-ts/browser';
import { SVGPathData } from 'svg-pathdata';
import { PALETTE } from './palette';
import type { ColorIndex, PathLayer, PathPoint } from './types';
import { mintId } from './types';

export interface TraceOptions {
  usePalette: boolean; // quantize directly to the 3 panel colors
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

const MAX_TRACE_SIDE = 600;
const MAX_TRACE_LAYERS = 300;

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
  // flatten alpha onto white so transparency doesn't contaminate the palette
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export async function traceToSvg(imageData: ImageData, options: TraceOptions): Promise<string> {
  const base = {
    minShapeOutline: options.minShapeOutline,
    blurRadius: options.blurRadius,
    lineErrorMargin: 1,
    curveErrorMargin: 1,
  };
  const paletteOptions = options.usePalette
    ? {
        colorSamplingMode: CreatePaletteMode.PALETTE,
        palette: PALETTE.map((p) => ({ ...hexToRgb(p.hex), a: 255 })),
        numberOfColors: PALETTE.length,
      }
    : { numberOfColors: options.numberOfColors };
  const svg = await ImageTracerBrowser.fromImageData(imageData, { ...base, ...paletteOptions });
  return typeof svg === 'string' ? svg : String(svg);
}

function nearestPaletteIndex(r: number, g: number, b: number): ColorIndex {
  // plain RGB distance; production should use OKLab like pgen's
  // nearest-palette-color.ts
  let best = 0;
  let bestDist = Infinity;
  PALETTE.forEach((p, i) => {
    const c = hexToRgb(p.hex);
    const dist = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best as ColorIndex;
}

function parseFillColor(fill: string | null): ColorIndex | null {
  if (!fill || fill === 'none') return null;
  const rgbMatch = fill.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgbMatch) {
    return nearestPaletteIndex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
  }
  const hexMatch = fill.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const c = hexToRgb(fill);
    return nearestPaletteIndex(c.r, c.g, c.b);
  }
  return null;
}

interface SubPath {
  points: PathPoint[];
  closed: boolean;
}

function commandsToSubPaths(d: string): SubPath[] {
  // normalizeHVZ(false, ...) — keep Z commands intact; normalizing Z would
  // rewrite close-path into a plain line-to and lose the closed flag
  const data = new SVGPathData(d).toAbs().aToC().normalizeST().qtToC().normalizeHVZ(false);
  const subPaths: SubPath[] = [];
  let current: SubPath | null = null;
  for (const cmd of data.commands) {
    if (cmd.type === SVGPathData.MOVE_TO) {
      current = { points: [{ x: cmd.x, y: cmd.y }], closed: false };
      subPaths.push(current);
    } else if (!current) {
      continue;
    } else if (cmd.type === SVGPathData.LINE_TO) {
      current.points.push({ x: cmd.x, y: cmd.y });
    } else if (cmd.type === SVGPathData.CURVE_TO) {
      const prev = current.points[current.points.length - 1];
      prev.hout = { x: cmd.x1, y: cmd.y1 };
      current.points.push({ x: cmd.x, y: cmd.y, hin: { x: cmd.x2, y: cmd.y2 } });
    } else if (cmd.type === SVGPathData.CLOSE_PATH) {
      current.closed = true;
      // drop a duplicated closing anchor if the tracer emitted one
      const first = current.points[0];
      const last = current.points[current.points.length - 1];
      if (
        current.points.length > 1 &&
        Math.abs(first.x - last.x) < 1e-6 &&
        Math.abs(first.y - last.y) < 1e-6
      ) {
        if (last.hin) first.hin = last.hin;
        current.points.pop();
      }
    }
  }
  // raster-trace output is fill-region outlines — always closed shapes
  for (const sp of subPaths) {
    if (sp.points.length >= 3) sp.closed = true;
  }
  return subPaths.filter((sp) => sp.points.length >= 2);
}

export interface TraceTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function svgToPathLayers(svg: string, target: TraceTarget): PathLayer[] {
  const svgTag = svg.match(/<svg[^>]*>/)?.[0] ?? '';
  const viewBoxMatch = svgTag.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
  const widthMatch = svgTag.match(/width="([\d.]+)/);
  const heightMatch = svgTag.match(/height="([\d.]+)/);
  const svgW = Number(widthMatch?.[1] ?? viewBoxMatch?.[1] ?? 0) || 1;
  const svgH = Number(heightMatch?.[1] ?? viewBoxMatch?.[2] ?? 0) || 1;
  const sx = target.width / svgW;
  const sy = target.height / svgH;

  const layers: PathLayer[] = [];
  const pathTags = svg.match(/<path\s[^>]*?\/?>/g) ?? [];
  let n = 0;
  const scale = (p: { x: number; y: number }) => ({
    x: target.x + p.x * sx,
    y: target.y + p.y * sy,
  });
  const scalePoints = (points: PathPoint[]): PathPoint[] =>
    points.map((p) => ({
      ...scale(p),
      ...(p.hin ? { hin: scale(p.hin) } : {}),
      ...(p.hout ? { hout: scale(p.hout) } : {}),
    }));
  for (const tag of pathTags) {
    const dMatch = tag.match(/\sd="([^"]+)"/);
    if (!dMatch) continue;
    const fillMatch = tag.match(/\sfill="([^"]+)"/);
    const fill = parseFillColor(fillMatch ? fillMatch[1] : null);
    if (fill === null) continue;
    // one layer per traced color region; the region's compound subpaths
    // (holes/islands) stay together so evenodd fill preserves the holes
    const subs = commandsToSubPaths(dMatch[1]);
    if (subs.length === 0) continue;
    n += 1;
    layers.push({
      id: mintId('trace'),
      name: `trace-${n}`,
      type: 'path',
      points: scalePoints(subs[0].points),
      ...(subs.length > 1
        ? { extraSubpaths: subs.slice(1).map((s) => scalePoints(s.points)) }
        : {}),
      closed: true,
      fill,
      stroke: null,
      strokeWidth: 0,
    });
    if (layers.length >= MAX_TRACE_LAYERS) return layers;
  }
  return layers;
}
