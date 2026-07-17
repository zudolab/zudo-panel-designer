// Alignment/distribution math over caller-supplied bboxes. Canvas-free by
// design: the app renderer owns the rotation-aware layerBbox that produces
// the `{id, x, y, w, h}` rects fed in here — core only does the arithmetic.
// Mirrors pgen's composer-align-utils.ts (computeAlignment /
// computeAlignmentToCanvas), collapsed into two reference modes rather than
// two separate functions.
import type { Rect } from './bbox';

export type AlignType = 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

export interface AlignRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AlignResult {
  id: string;
  dx: number;
  dy: number;
}

// 'selection' aligns/distributes within the combined bbox of the given rects;
// 'panel' aligns/distributes against the panel rect (canvas-relative).
export type AlignReference = { mode: 'selection' } | { mode: 'panel'; panel: Rect };

const MIN_ALIGN_SELECTION = 2;
const MIN_DISTRIBUTE_SELECTION = 3;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function selectionBounds(rects: readonly AlignRect[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

function panelBounds(panel: Rect): Bounds {
  return { minX: panel.x, minY: panel.y, maxX: panel.x + panel.width, maxY: panel.y + panel.height };
}

function alignOne(r: AlignRect, type: AlignType, bounds: Bounds): AlignResult {
  switch (type) {
    case 'left':
      return { id: r.id, dx: bounds.minX - r.x, dy: 0 };
    case 'center-h':
      return { id: r.id, dx: (bounds.minX + bounds.maxX) / 2 - r.w / 2 - r.x, dy: 0 };
    case 'right':
      return { id: r.id, dx: bounds.maxX - r.w - r.x, dy: 0 };
    case 'top':
      return { id: r.id, dx: 0, dy: bounds.minY - r.y };
    case 'middle-v':
      return { id: r.id, dx: 0, dy: (bounds.minY + bounds.maxY) / 2 - r.h / 2 - r.y };
    case 'bottom':
      return { id: r.id, dx: 0, dy: bounds.maxY - r.h - r.y };
  }
}

// Align each rect's left/center/right (or top/middle/bottom) edge to the
// reference bounds. 'selection' needs 2+ rects (a single rect has nothing to
// align against) and is a no-op ([]) below that; 'panel' works from 1+.
export function alignLayers(rects: readonly AlignRect[], type: AlignType, reference: AlignReference): AlignResult[] {
  if (rects.length === 0) return [];
  if (reference.mode === 'selection' && rects.length < MIN_ALIGN_SELECTION) return [];
  const bounds = reference.mode === 'selection' ? selectionBounds(rects) : panelBounds(reference.panel);
  return rects.map((r) => alignOne(r, type, bounds));
}

// Distributes rects with equal gaps along the axis, sorted by their current
// position. The two endpoint rects (first/last by position) anchor the span
// and are unmoved; interior rects are re-spaced between them.
function distributeWithinSelection(rects: readonly AlignRect[], axis: DistributeAxis): AlignResult[] {
  const sorted = [...rects].sort((a, b) => (axis === 'horizontal' ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const cursorMap = new Map<string, number>();
  if (axis === 'horizontal') {
    const totalW = sorted.reduce((sum, r) => sum + r.w, 0);
    const gap = (last.x + last.w - first.x - totalW) / (sorted.length - 1);
    let cursor = first.x;
    for (const r of sorted) {
      cursorMap.set(r.id, cursor);
      cursor += r.w + gap;
    }
    return rects.map((r) => ({ id: r.id, dx: cursorMap.get(r.id)! - r.x, dy: 0 }));
  }
  const totalH = sorted.reduce((sum, r) => sum + r.h, 0);
  const gap = (last.y + last.h - first.y - totalH) / (sorted.length - 1);
  let cursor = first.y;
  for (const r of sorted) {
    cursorMap.set(r.id, cursor);
    cursor += r.h + gap;
  }
  return rects.map((r) => ({ id: r.id, dx: 0, dy: cursorMap.get(r.id)! - r.y }));
}

// Canvas-relative distribution: equal gaps (including before the first and
// after the last rect) across the full panel span. Mirrors
// computeAlignmentToCanvas's distribute-h/distribute-v in the reference app.
function distributeWithinPanel(rects: readonly AlignRect[], axis: DistributeAxis, panel: Rect): AlignResult[] {
  const sorted = [...rects].sort((a, b) => (axis === 'horizontal' ? a.x - b.x : a.y - b.y));
  const cursorMap = new Map<string, number>();
  if (axis === 'horizontal') {
    const totalW = sorted.reduce((sum, r) => sum + r.w, 0);
    const gap = (panel.width - totalW) / (sorted.length + 1);
    let cursor = panel.x + gap;
    for (const r of sorted) {
      cursorMap.set(r.id, cursor);
      cursor += r.w + gap;
    }
    return rects.map((r) => ({ id: r.id, dx: cursorMap.get(r.id)! - r.x, dy: 0 }));
  }
  const totalH = sorted.reduce((sum, r) => sum + r.h, 0);
  const gap = (panel.height - totalH) / (sorted.length + 1);
  let cursor = panel.y + gap;
  for (const r of sorted) {
    cursorMap.set(r.id, cursor);
    cursor += r.h + gap;
  }
  return rects.map((r) => ({ id: r.id, dx: 0, dy: cursorMap.get(r.id)! - r.y }));
}

// 'selection' needs 3+ rects (2 rects have no interior gap to redistribute)
// and is a no-op ([]) below that; 'panel' works from 1+ (canvas-relative
// centering/spacing, per the reference app). Defaults to 'selection'.
export function distributeLayers(
  rects: readonly AlignRect[],
  axis: DistributeAxis,
  reference: AlignReference = { mode: 'selection' },
): AlignResult[] {
  if (rects.length === 0) return [];
  if (reference.mode === 'selection') {
    return rects.length < MIN_DISTRIBUTE_SELECTION ? [] : distributeWithinSelection(rects, axis);
  }
  return distributeWithinPanel(rects, axis, reference.panel);
}
