// Bezier path helpers in mm space (mirrors pgen core path-geometry, shrunk).
import type { PathLayer, PathPoint } from './types';

function appendSubpath(path: Path2D, points: PathPoint[], closed: boolean): void {
  if (points.length === 0) return;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const c1 = prev.hout ?? { x: prev.x, y: prev.y };
    const c2 = curr.hin ?? { x: curr.x, y: curr.y };
    path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, curr.x, curr.y);
  }
  if (closed && points.length > 1) {
    const last = points[points.length - 1];
    const first = points[0];
    const c1 = last.hout ?? { x: last.x, y: last.y };
    const c2 = first.hin ?? { x: first.x, y: first.y };
    path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.x, first.y);
    path.closePath();
  }
}

export function buildPath2D(
  points: PathPoint[],
  closed: boolean,
  extraSubpaths?: PathPoint[][],
): Path2D {
  const path = new Path2D();
  appendSubpath(path, points, closed);
  for (const sub of extraSubpaths ?? []) {
    appendSubpath(path, sub, true);
  }
  return path;
}

export interface Bbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pathBbox(points: PathPoint[], extraSubpaths?: PathPoint[][]): Bbox {
  // approximation over anchors + handles — good enough for selection chrome
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const list of [points, ...(extraSubpaths ?? [])]) {
    for (const p of list) {
      for (const q of [p, p.hin, p.hout]) {
        if (!q) continue;
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

let hitCtx: CanvasRenderingContext2D | null = null;
function getHitCtx(): CanvasRenderingContext2D {
  if (!hitCtx) {
    hitCtx = document.createElement('canvas').getContext('2d');
    if (!hitCtx) throw new Error('2d context unavailable');
  }
  return hitCtx;
}

export function hitTestPath(layer: PathLayer, mmX: number, mmY: number): boolean {
  const ctx = getHitCtx();
  const path = buildPath2D(layer.points, layer.closed, layer.extraSubpaths);
  if (
    layer.fill !== null &&
    layer.closed &&
    ctx.isPointInPath(path, mmX, mmY, 'evenodd')
  ) {
    return true;
  }
  if (layer.stroke !== null) {
    ctx.lineWidth = Math.max(layer.strokeWidth, 1.5); // generous grab zone in mm
    if (ctx.isPointInStroke(path, mmX, mmY)) return true;
  }
  return false;
}

export function translatePoints(points: PathPoint[], dx: number, dy: number): PathPoint[] {
  return points.map((p) => ({
    x: p.x + dx,
    y: p.y + dy,
    ...(p.hin ? { hin: { x: p.hin.x + dx, y: p.hin.y + dy } } : {}),
    ...(p.hout ? { hout: { x: p.hout.x + dx, y: p.hout.y + dy } } : {}),
  }));
}

export function translatePathLayer(
  layer: PathLayer,
  dx: number,
  dy: number,
): Pick<PathLayer, 'points'> & Partial<Pick<PathLayer, 'extraSubpaths'>> {
  return {
    points: translatePoints(layer.points, dx, dy),
    ...(layer.extraSubpaths
      ? { extraSubpaths: layer.extraSubpaths.map((sub) => translatePoints(sub, dx, dy)) }
      : {}),
  };
}

export function movePathAnchor(
  points: PathPoint[],
  index: number,
  x: number,
  y: number,
): PathPoint[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    const dx = x - p.x;
    const dy = y - p.y;
    return {
      x,
      y,
      ...(p.hin ? { hin: { x: p.hin.x + dx, y: p.hin.y + dy } } : {}),
      ...(p.hout ? { hout: { x: p.hout.x + dx, y: p.hout.y + dy } } : {}),
    };
  });
}

export function movePathHandle(
  points: PathPoint[],
  index: number,
  which: 'hin' | 'hout',
  x: number,
  y: number,
  mirror: boolean,
): PathPoint[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    const next: PathPoint = { ...p, [which]: { x, y } };
    if (mirror) {
      const other = which === 'hin' ? 'hout' : 'hin';
      next[other] = { x: p.x * 2 - x, y: p.y * 2 - y };
    }
    return next;
  });
}
