// 8-handle resize math, mm space. Stage 1 was axis-aligned only; stage 2
// (resizeRotatedRect) resolves the screen-space drag in the layer's local
// rotated frame so rotated rects resize along their visual edges, keeping the
// opposite edge/corner visually anchored. Rotation is degrees clockwise about
// the rect's own center (same convention as bbox.ts).
import type { Pt, Rect } from './bbox';

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const DEFAULT_MIN_SIZE_MM = 1;

interface AxisResult {
  pos: number;
  size: number;
}

// edge: which edge of the axis this handle drags. 'start' keeps the far
// (opposite) edge fixed; 'end' keeps the near edge fixed.
function resizeAxis(pos: number, size: number, delta: number, edge: 'start' | 'end', minSize: number): AxisResult {
  if (edge === 'end') {
    return { pos, size: Math.max(minSize, size + delta) };
  }
  const far = pos + size;
  const newSize = Math.max(minSize, size - delta);
  return { pos: far - newSize, size: newSize };
}

const HANDLE_AXES: Record<ResizeHandle, { x?: 'start' | 'end'; y?: 'start' | 'end' }> = {
  n: { y: 'start' },
  s: { y: 'end' },
  e: { x: 'end' },
  w: { x: 'start' },
  ne: { x: 'end', y: 'start' },
  nw: { x: 'start', y: 'start' },
  se: { x: 'end', y: 'end' },
  sw: { x: 'start', y: 'end' },
};

// dx/dy is the handle's drag delta in mm. Clamped so the rect can never
// shrink past minSize or invert.
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize: number = DEFAULT_MIN_SIZE_MM,
): Rect {
  const axes = HANDLE_AXES[handle];
  const horizontal = axes.x ? resizeAxis(rect.x, rect.width, dx, axes.x, minSize) : { pos: rect.x, size: rect.width };
  const vertical = axes.y ? resizeAxis(rect.y, rect.height, dy, axes.y, minSize) : { pos: rect.y, size: rect.height };
  return { x: horizontal.pos, y: vertical.pos, width: horizontal.size, height: vertical.size };
}

// The point of the rect that a handle's drag must keep fixed, in world space:
// the opposite corner for corner handles, the opposite edge's midpoint for
// edge handles (the unconstrained axis anchors at the center, which is the
// same point). cos/sin are of the rect's clockwise rotation.
function anchorWorldPoint(rect: Rect, handle: ResizeHandle, cos: number, sin: number): Pt {
  const axes = HANDLE_AXES[handle];
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const ax = axes.x === 'end' ? rect.x : axes.x === 'start' ? rect.x + rect.width : cx;
  const ay = axes.y === 'end' ? rect.y : axes.y === 'start' ? rect.y + rect.height : cy;
  const dx = ax - cx;
  const dy = ay - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// Rotation-aware resize. The rect stays axis-aligned in the model (rotation is
// a separate render-time transform about its center), so we (1) rotate the
// screen-space drag delta into the rect's local frame, (2) run the plain
// axis-aligned resize there, then (3) translate the result so the anchor
// (opposite edge/corner) — which WOULD drift because rotation pivots on a
// center that moved with the size change — stays visually fixed.
// rotationDeg 0/undefined delegates to resizeRect and is bit-identical to it.
export function resizeRotatedRect(
  rect: Rect,
  rotationDeg: number | undefined,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minSize: number = DEFAULT_MIN_SIZE_MM,
): Rect {
  if (!rotationDeg) return resizeRect(rect, handle, dx, dy, minSize);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;
  const resized = resizeRect(rect, handle, localDx, localDy, minSize);
  const anchorBefore = anchorWorldPoint(rect, handle, cos, sin);
  const anchorAfter = anchorWorldPoint(resized, handle, cos, sin);
  return {
    x: resized.x + anchorBefore.x - anchorAfter.x,
    y: resized.y + anchorBefore.y - anchorAfter.y,
    width: resized.width,
    height: resized.height,
  };
}
