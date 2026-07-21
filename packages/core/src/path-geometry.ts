// Bezier path helpers in mm space. Pure TS so @zpd/core stays dependency-free
// and testable in plain Node (no browser Path2D/canvas at runtime).
// Mirrors _temp-resource/1-panel-designer-proto/src/path-geometry.ts, which
// mirrors pgen core path-geometry.
import { rotatePoint, type Pt, type Rect } from './bbox';

export interface PathPointLike extends Pt {
  hin?: Pt; // absolute bezier handle coords, mm
  hout?: Pt;
}

export interface PathLayerLike {
  points: PathPointLike[]; // primary subpath
  extraSubpaths?: PathPointLike[][];
  closed: boolean;
}

function appendSubpath(path: Path2D, points: PathPointLike[], closed: boolean): void {
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

// Returns null in Node (no global Path2D) — for app/browser use only. Core's
// own hit-test/bbox/tests use flattenPath instead, which works everywhere.
export function buildPath2D(
  points: PathPointLike[],
  closed: boolean,
  extraSubpaths?: PathPointLike[][],
): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const path = new Path2D();
  appendSubpath(path, points, closed);
  for (const sub of extraSubpaths ?? []) {
    appendSubpath(path, sub, true);
  }
  return path;
}

const DEFAULT_FLATTEN_SEGMENTS = 24;

function cubicPointAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

function flattenSegment(p0: PathPointLike, p1: PathPointLike, segments: number): Pt[] {
  const c1 = p0.hout ?? { x: p0.x, y: p0.y };
  const c2 = p1.hin ?? { x: p1.x, y: p1.y };
  const out: Pt[] = [];
  for (let i = 1; i <= segments; i += 1) {
    out.push(cubicPointAt(p0, c1, c2, p1, i / segments));
  }
  return out;
}

// Flattens one subpath (anchors + bezier handles) to a polyline. When
// closed, appends the wraparound segment from the last anchor back to the
// first so the result is ready for both point-in-polygon and stroke tests.
export function flattenSubpath(
  points: PathPointLike[],
  closed: boolean,
  segments: number = DEFAULT_FLATTEN_SEGMENTS,
): Pt[] {
  if (points.length === 0) return [];
  const out: Pt[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i += 1) {
    out.push(...flattenSegment(points[i - 1], points[i], segments));
  }
  if (closed && points.length > 1) {
    out.push(...flattenSegment(points[points.length - 1], points[0], segments));
  }
  return out;
}

// Flattens the primary subpath plus any extra (hole/island) subpaths, which
// are always treated as closed — see PathLayerLike.extraSubpaths.
export function flattenPath(
  points: PathPointLike[],
  closed: boolean,
  extraSubpaths?: PathPointLike[][],
): Pt[][] {
  const subpaths = [flattenSubpath(points, closed)];
  for (const sub of extraSubpaths ?? []) {
    subpaths.push(flattenSubpath(sub, true));
  }
  return subpaths;
}

// Approximation over anchors + handles (not the flattened curve) — cheap
// and good enough for selection chrome / bbox display.
export function pathBbox(points: PathPointLike[], extraSubpaths?: PathPointLike[][]): Rect {
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

export function translatePoints(points: PathPointLike[], dx: number, dy: number): PathPointLike[] {
  return points.map((p) => ({
    x: p.x + dx,
    y: p.y + dy,
    ...(p.hin ? { hin: { x: p.hin.x + dx, y: p.hin.y + dy } } : {}),
    ...(p.hout ? { hout: { x: p.hout.x + dx, y: p.hout.y + dy } } : {}),
  }));
}

export function translatePathLayer<T extends PathLayerLike>(
  layer: T,
  dx: number,
  dy: number,
): Pick<T, 'points'> & Partial<Pick<T, 'extraSubpaths'>> {
  return {
    points: translatePoints(layer.points, dx, dy),
    ...(layer.extraSubpaths
      ? { extraSubpaths: layer.extraSubpaths.map((sub) => translatePoints(sub, dx, dy)) }
      : {}),
  } as Pick<T, 'points'> & Partial<Pick<T, 'extraSubpaths'>>;
}

// Path has no rotation field (unlike shape/text/image) — baking a rotation
// into a path means rotating every anchor AND its hin/hout handles about the
// pivot, mirroring translatePoints's shape.
export function rotatePoints(points: PathPointLike[], center: Pt, rotationDeg: number): PathPointLike[] {
  return points.map((p) => ({
    ...rotatePoint(p, center, rotationDeg),
    ...(p.hin ? { hin: rotatePoint(p.hin, center, rotationDeg) } : {}),
    ...(p.hout ? { hout: rotatePoint(p.hout, center, rotationDeg) } : {}),
  }));
}

export function rotatePathLayer<T extends PathLayerLike>(
  layer: T,
  center: Pt,
  rotationDeg: number,
): Pick<T, 'points'> & Partial<Pick<T, 'extraSubpaths'>> {
  return {
    points: rotatePoints(layer.points, center, rotationDeg),
    ...(layer.extraSubpaths
      ? { extraSubpaths: layer.extraSubpaths.map((sub) => rotatePoints(sub, center, rotationDeg)) }
      : {}),
  } as Pick<T, 'points'> & Partial<Pick<T, 'extraSubpaths'>>;
}

// Moves an anchor and carries its two handles along with it (handles keep
// their offset relative to the anchor).
export function movePathAnchor(points: PathPointLike[], index: number, x: number, y: number): PathPointLike[] {
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

// Moves one handle. When mirror is set, reflects the opposite handle about
// the anchor so the curve stays smooth (standard bezier-editor behavior).
export function movePathHandle(
  points: PathPointLike[],
  index: number,
  which: 'hin' | 'hout',
  x: number,
  y: number,
  mirror: boolean,
): PathPointLike[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    const next: PathPointLike = { ...p, [which]: { x, y } };
    if (mirror) {
      const other = which === 'hin' ? 'hout' : 'hin';
      next[other] = { x: p.x * 2 - x, y: p.y * 2 - y };
    }
    return next;
  });
}
