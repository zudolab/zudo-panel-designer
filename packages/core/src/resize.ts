// Axis-aligned 8-handle resize math, mm space. Resize is only offered for
// unrotated layers in stage 1 (a rotated bbox's handles don't align with its
// visual edges) — isResizable is the one-line guard the app UI checks before
// showing resize handles at all.
import type { Rect } from './bbox';

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const DEFAULT_MIN_SIZE_MM = 1;

export function isResizable(rotation: number | undefined): boolean {
  return !rotation;
}

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
