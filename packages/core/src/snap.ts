// Snapping helpers, mm space. Pure math only — no React/canvas/DOM.
//
// Two-stage model (see issue #53): the grid always catches (every coordinate
// is within half a grid cell of a grid line), then an explicit guide within
// `toleranceMm` overrides that grid result. Guides win ties — whenever a guide
// is in range it takes priority over the grid, so a coordinate that sits an
// equal distance from a grid line and a guide lands on the guide.
import type { Pt, Rect } from './bbox';
import { rectCenter } from './bbox';
import type { Guide } from './types';

export const DEFAULT_SNAP_MM = 0.1;

// How close (mm, document space) a candidate point must be to a guide for the
// guide to catch it. Larger than half the grid cell so guides reach past the
// grid. The select-tool integration (#55) may pass a zoom-scaled tolerance so
// the catch distance feels constant on screen; core stays in mm.
export const DEFAULT_SNAP_TOLERANCE_MM = 0.5;

export interface SnapOptions {
  /** Grid cell size in mm. Defaults to DEFAULT_SNAP_MM (0.1). */
  gridMm?: number;
  /** Guide catch distance in mm. Defaults to DEFAULT_SNAP_TOLERANCE_MM (0.5). */
  toleranceMm?: number;
  /** All document guides. Hidden guides are ignored; each is applied to its own axis. */
  guides?: readonly Guide[];
}

export function snapToGrid(value: number, gridMm: number = DEFAULT_SNAP_MM): number {
  // round-trip through a fixed decimal string to avoid float noise like
  // 0.1 + 0.2 !== 0.3 leaking into snapped mm coordinates
  const snapped = Math.round(value / gridMm) * gridMm;
  return Number(snapped.toFixed(6));
}

export function snapPoint(pt: Pt, gridMm: number = DEFAULT_SNAP_MM): Pt {
  return { x: snapToGrid(pt.x, gridMm), y: snapToGrid(pt.y, gridMm) };
}

// Vertical guides constrain x (a vertical line lives at a constant x); horizontal
// guides constrain y. This maps a drag axis to the guides that can catch it.
function axisGuides(guides: readonly Guide[], axis: 'x' | 'y'): Guide[] {
  const want = axis === 'x' ? 'vertical' : 'horizontal';
  return guides.filter((g) => g.orientation === want && g.hidden !== true);
}

export interface ScalarSnap {
  value: number;
  /** The guide that caught this coordinate, or null if it snapped to the grid. */
  guide: Guide | null;
}

// Snap a single coordinate along one axis: grid first, then override with the
// nearest same-axis, non-hidden guide within tolerance (guides win ties).
export function snapScalar(value: number, axis: 'x' | 'y', options: SnapOptions = {}): ScalarSnap {
  const { gridMm = DEFAULT_SNAP_MM, toleranceMm = DEFAULT_SNAP_TOLERANCE_MM } = options;
  const guides = axisGuides(options.guides ?? [], axis);

  let best: Guide | null = null;
  let bestDist = toleranceMm;
  for (const guide of guides) {
    const dist = Math.abs(guide.position - value);
    // `<=` so a guide exactly at the tolerance boundary still wins over the grid.
    if (dist <= bestDist) {
      bestDist = dist;
      best = guide;
    }
  }
  if (best) return { value: best.position, guide: best };
  return { value: snapToGrid(value, gridMm), guide: null };
}

export interface AxisSnap {
  /** Amount to add to every point on this axis. */
  delta: number;
  /** The guide the group snapped to, or null if it snapped to the grid. */
  guide: Guide | null;
}

// Rigidly snap a group of candidate coordinates along one axis, returning a
// single delta to apply to all of them. Grid first, guides override within
// tolerance (guides win ties). Used for translating a whole bbox: every
// candidate moves together, so we pick the single best catch across candidates.
export function snapAxis(
  candidates: readonly number[],
  axis: 'x' | 'y',
  options: SnapOptions = {},
): AxisSnap {
  const { gridMm = DEFAULT_SNAP_MM, toleranceMm = DEFAULT_SNAP_TOLERANCE_MM } = options;
  const guides = axisGuides(options.guides ?? [], axis);

  let bestGuide: Guide | null = null;
  let bestGuideDelta = 0;
  let bestGuideDist = toleranceMm;
  for (const candidate of candidates) {
    for (const guide of guides) {
      const dist = Math.abs(guide.position - candidate);
      if (dist <= bestGuideDist) {
        bestGuideDist = dist;
        bestGuideDelta = guide.position - candidate;
        bestGuide = guide;
      }
    }
  }
  if (bestGuide) return { delta: bestGuideDelta, guide: bestGuide };

  // No guide in range — snap to the grid using whichever candidate sits closest
  // to a grid line (its correction is the smallest rigid shift that grid-aligns
  // that reference point).
  let gridDelta = 0;
  let gridDist = Infinity;
  for (const candidate of candidates) {
    const delta = snapToGrid(candidate, gridMm) - candidate;
    if (Math.abs(delta) < gridDist) {
      gridDist = Math.abs(delta);
      gridDelta = delta;
    }
  }
  return { delta: gridDelta, guide: null };
}

export interface SnapResult {
  /** The snapped bounding box (input shifted by dx/dy). */
  bbox: Rect;
  dx: number;
  dy: number;
  /** Vertical guide the bbox snapped to along x, or null (grid / no catch). */
  guideX: Guide | null;
  /** Horizontal guide the bbox snapped to along y, or null (grid / no catch). */
  guideY: Guide | null;
}

// Rigidly snap a bounding box (a move drag). Snap candidates per axis are the
// two edges, the centre, and — if given — the dragged handle. Grid first, then
// guides (guides win ties). Returns the snapped bbox, the applied delta, and
// which guides caught it so the caller can move geometry and draw feedback.
export function snapBbox(bbox: Rect, options: SnapOptions = {}, handle?: Pt): SnapResult {
  const center = rectCenter(bbox);
  const xCandidates = [bbox.x, bbox.x + bbox.width, center.x];
  const yCandidates = [bbox.y, bbox.y + bbox.height, center.y];
  if (handle) {
    xCandidates.push(handle.x);
    yCandidates.push(handle.y);
  }

  const sx = snapAxis(xCandidates, 'x', options);
  const sy = snapAxis(yCandidates, 'y', options);

  return {
    bbox: { x: bbox.x + sx.delta, y: bbox.y + sy.delta, width: bbox.width, height: bbox.height },
    dx: sx.delta,
    dy: sy.delta,
    guideX: sx.guide,
    guideY: sy.guide,
  };
}
