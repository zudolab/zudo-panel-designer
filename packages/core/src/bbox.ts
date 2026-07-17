// Rect/bbox math shared across geometry modules. Document space is
// millimeters; rotation is degrees clockwise about the rect's own center.

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// alias for call sites that read more naturally as "bbox" than "rect"
export type Bbox = Rect;

// Flip negative width/height to positive, shifting the origin so the rect still
// covers the same region. Mirrored geometry — a negative width/height, which
// the numeric inspectors permit and the renderer paints as a flip — otherwise
// corrupts any consumer that assumes min=origin/max=origin+size: union bounds,
// scale/anchor corners, and panel-boundary tests. Normalize at the point a rect
// enters that kind of math.
export function normalizeRect(rect: Rect): Rect {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

export function rectCenter(rect: Rect): Pt {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function rotatePoint(pt: Pt, center: Pt, rotationDeg: number): Pt {
  const rad = (rotationDeg * Math.PI) / 180;
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export function rectCorners(rect: Rect): [Pt, Pt, Pt, Pt] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

export function boundsOfPoints(points: Pt[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Rotated axis-aligned bounding box: rotate the 4 corners about the rect's
// own center, then take min/max. rotationDeg 0/undefined is a fast no-op.
export function rotatedRectAABB(rect: Rect, rotationDeg?: number): Rect {
  // Return a fresh copy (never the input by reference) so callers can freely
  // mutate the result, matching the rest of this module.
  if (!rotationDeg) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const center = rectCenter(rect);
  const corners = rectCorners(rect).map((c) => rotatePoint(c, center, rotationDeg));
  return boundsOfPoints(corners);
}

// AABB overlap test. Inclusive: rects that merely touch along an edge or at a
// corner DO intersect — a marquee that grazes a layer's edge should pick it up.
// Tolerates negative width/height (in-progress resize drags produce them) via
// normalizeRect.
export function rectsIntersect(a: Rect, b: Rect): boolean {
  const na = normalizeRect(a);
  const nb = normalizeRect(b);
  return (
    na.x <= nb.x + nb.width &&
    nb.x <= na.x + na.width &&
    na.y <= nb.y + nb.height &&
    nb.y <= na.y + na.height
  );
}

export function unionBbox(a: Rect, b: Rect): Rect {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function mergeBboxes(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return rects.reduce((acc, r) => unionBbox(acc, r));
}
