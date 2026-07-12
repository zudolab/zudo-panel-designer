// Snapping helpers, mm space.
import type { Pt } from './bbox';

export const DEFAULT_SNAP_MM = 0.1;

export function snapToGrid(value: number, gridMm: number = DEFAULT_SNAP_MM): number {
  // round-trip through a fixed decimal string to avoid float noise like
  // 0.1 + 0.2 !== 0.3 leaking into snapped mm coordinates
  const snapped = Math.round(value / gridMm) * gridMm;
  return Number(snapped.toFixed(6));
}

export function snapPoint(pt: Pt, gridMm: number = DEFAULT_SNAP_MM): Pt {
  return { x: snapToGrid(pt.x, gridMm), y: snapToGrid(pt.y, gridMm) };
}
