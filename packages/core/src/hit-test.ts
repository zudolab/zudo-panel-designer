// Canvas hit-testing in mm space. TWO-TIER topmost-first scan (#97): pattern
// layers hit on their x/y/size square (like an image bbox), but new patterns
// are appended on TOP of the layer stack (picker add-new-layer), so a naive
// single top-down scan would let a covering pattern swallow every click on
// the objects beneath it. hitTestDoc therefore scans NON-pattern layers
// top-down first and only falls back to pattern layers (top-down among
// themselves) when nothing else hits.
//
// The spec references Path2D's isPointInPath(...,'evenodd')/isPointInStroke,
// but Path2D is a browser API unavailable in plain Node/Vitest. This module
// instead flattens beziers to polylines (see path-geometry.ts) and does its
// own even-odd ray casting + point-to-segment stroke distance, so @zpd/core
// stays dependency-free and testable in plain Node.
import type { Pt, Rect } from './bbox';
import { flattenPath, type PathLayerLike } from './path-geometry';

export interface RectLayerLike {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number; // deg clockwise about bbox center
}

export interface ShapeLayerLike extends RectLayerLike {
  type: 'shape';
  shape: 'rect' | 'ellipse';
}

export interface ImageLayerLike extends RectLayerLike {
  type: 'image';
}

export interface TextLayerLike {
  type: 'text';
  content: string;
  sizeMm: number;
  x: number; // bbox top-left, mm
  y: number;
  rotation?: number;
}

export interface HitTestPathLayerLike extends PathLayerLike {
  type: 'path';
  fill: number | null;
  stroke: number | null;
  strokeWidth: number; // mm
}

export interface PatternLayerLike {
  type: 'pattern';
  x: number;
  y: number;
  size: number; // square side, mm
}

export type LayerLike =
  | ShapeLayerLike
  | PatternLayerLike
  | HitTestPathLayerLike
  | TextLayerLike
  | ImageLayerLike;

export interface HitTestDocLike {
  layers: (LayerLike & { hidden?: boolean })[]; // bottom -> top
}

function pointInRotatedRect(
  mmX: number,
  mmY: number,
  rect: Rect,
  rotation: number | undefined,
  ellipse: boolean,
): boolean {
  let px = mmX;
  let py = mmY;
  if (rotation) {
    const rad = (-rotation * Math.PI) / 180;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const dx = mmX - cx;
    const dy = mmY - cy;
    px = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    py = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  if (ellipse) {
    const nx = (px - rect.x - rect.width / 2) / (rect.width / 2);
    const ny = (py - rect.y - rect.height / 2) / (rect.height / 2);
    return nx * nx + ny * ny <= 1;
  }
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

// @zpd/core has no canvas/DOM font metrics, so text hit-testing uses a rough
// monospace-ish estimate rather than real glyph measurement (that lives in
// the app's renderer). Good enough for click-to-select purposes.
const TEXT_CHAR_WIDTH_FACTOR = 0.6;
const TEXT_LINE_HEIGHT_FACTOR = 1.2;

export function estimateTextBbox(layer: TextLayerLike): Rect {
  const lines = layer.content.length > 0 ? layer.content.split('\n') : [''];
  const maxLen = Math.max(...lines.map((l) => l.length), 1);
  return {
    x: layer.x,
    y: layer.y,
    width: maxLen * layer.sizeMm * TEXT_CHAR_WIDTH_FACTOR,
    height: lines.length * layer.sizeMm * TEXT_LINE_HEIGHT_FACTOR,
  };
}

function pointInPolygonsEvenOdd(pt: Pt, polygons: Pt[][]): boolean {
  let inside = false;
  for (const poly of polygons) {
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const a = poly[i];
      const b = poly[j];
      const crosses = a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(pt: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / lenSq));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(pt.x - cx, pt.y - cy);
}

function pointNearPolyline(pt: Pt, polyline: Pt[], threshold: number): boolean {
  for (let i = 1; i < polyline.length; i += 1) {
    if (distanceToSegment(pt, polyline[i - 1], polyline[i]) <= threshold) return true;
  }
  return false;
}

// generous grab zone so thin strokes stay easy to click, mirrors the proto's
// `Math.max(layer.strokeWidth, 1.5)` canvas lineWidth floor
const MIN_STROKE_GRAB_MM = 1.5;

export function hitTestPath(layer: HitTestPathLayerLike, mmX: number, mmY: number): boolean {
  const pt: Pt = { x: mmX, y: mmY };
  const subpaths = flattenPath(layer.points, layer.closed, layer.extraSubpaths);
  if (layer.fill !== null && layer.closed && pointInPolygonsEvenOdd(pt, subpaths)) {
    return true;
  }
  if (layer.stroke !== null) {
    const halfWidth = Math.max(layer.strokeWidth, MIN_STROKE_GRAB_MM) / 2;
    if (subpaths.some((poly) => pointNearPolyline(pt, poly, halfWidth))) return true;
  }
  return false;
}

export function hitTestLayer(layer: LayerLike, mmX: number, mmY: number): boolean {
  switch (layer.type) {
    case 'shape':
      return pointInRotatedRect(mmX, mmY, layer, layer.rotation, layer.shape === 'ellipse');
    case 'image':
      return pointInRotatedRect(mmX, mmY, layer, layer.rotation, false);
    case 'text':
      return pointInRotatedRect(mmX, mmY, estimateTextBbox(layer), layer.rotation, false);
    case 'path':
      return hitTestPath(layer, mmX, mmY);
    case 'pattern':
      // Square bbox hit like an image (#97); patterns carry no rotation.
      return pointInRotatedRect(
        mmX,
        mmY,
        { x: layer.x, y: layer.y, width: layer.size, height: layer.size },
        undefined,
        false,
      );
  }
}

// Two-tier scan (#97, see the header comment): non-pattern layers first,
// topmost wins; pattern layers only when no non-pattern layer hits.
export function hitTestDoc(doc: HitTestDocLike, mmX: number, mmY: number): LayerLike | null {
  for (const patternTier of [false, true]) {
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i];
      if (layer.hidden || (layer.type === 'pattern') !== patternTier) continue;
      if (hitTestLayer(layer, mmX, mmY)) return layer;
    }
  }
  return null;
}
