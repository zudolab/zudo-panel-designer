import { describe, expect, it } from 'vitest';
import type { Guide } from './types';
import {
  DEFAULT_SNAP_TOLERANCE_MM,
  snapAxis,
  snapBbox,
  snapPoint,
  snapScalar,
  snapToGrid,
} from './snap';

const vGuide = (position: number, extra: Partial<Guide> = {}): Guide => ({
  id: `v-${position}`,
  orientation: 'vertical',
  position,
  ...extra,
});
const hGuide = (position: number, extra: Partial<Guide> = {}): Guide => ({
  id: `h-${position}`,
  orientation: 'horizontal',
  position,
  ...extra,
});

describe('snapToGrid', () => {
  it('rounds to the nearest 0.1mm by default', () => {
    expect(snapToGrid(1.23)).toBe(1.2);
    expect(snapToGrid(1.26)).toBe(1.3);
    expect(snapToGrid(0)).toBe(0);
  });

  it('avoids float noise (e.g. 0.1 + 0.2 style drift)', () => {
    expect(snapToGrid(0.15000001)).toBe(0.2);
    expect(Number.isFinite(snapToGrid(1.1))).toBe(true);
    expect(snapToGrid(1.1).toString().length).toBeLessThan(6); // no long float tail
  });

  it('supports a custom grid size', () => {
    expect(snapToGrid(7, 5)).toBe(5);
    expect(snapToGrid(8, 5)).toBe(10);
  });
});

describe('snapPoint', () => {
  it('snaps both axes independently', () => {
    expect(snapPoint({ x: 1.23, y: 4.56 })).toEqual({ x: 1.2, y: 4.6 });
  });
});

describe('snapScalar — grid then guides', () => {
  it('snaps to the grid when no guides are in range', () => {
    expect(snapScalar(1.23, 'x')).toEqual({ value: 1.2, guide: null });
  });

  it('snaps to a vertical guide within tolerance on the x axis (guide wins over grid)', () => {
    const g = vGuide(10);
    const r = snapScalar(10.3, 'x', { guides: [g] });
    expect(r.value).toBe(10);
    expect(r.guide).toBe(g);
  });

  it('applies the tolerance boundary inclusively', () => {
    const g = vGuide(10);
    const r = snapScalar(10 + DEFAULT_SNAP_TOLERANCE_MM, 'x', { guides: [g] });
    expect(r.guide).toBe(g);
  });

  it('ignores guides beyond the tolerance and falls back to the grid', () => {
    const g = vGuide(10);
    const r = snapScalar(12, 'x', { guides: [g] });
    expect(r.value).toBe(12);
    expect(r.guide).toBeNull();
  });

  it('only snaps to guides on the matching axis (vertical -> x, horizontal -> y)', () => {
    // a horizontal guide must not catch an x coordinate
    const r = snapScalar(10.2, 'x', { guides: [hGuide(10)] });
    expect(r.guide).toBeNull();
    expect(r.value).toBe(10.2);
  });

  it('does not snap to hidden guides', () => {
    const r = snapScalar(10.1, 'x', { guides: [vGuide(10, { hidden: true })] });
    expect(r.guide).toBeNull();
    expect(r.value).toBe(10.1);
  });

  it('picks the nearest of several guides', () => {
    const near = vGuide(10.1);
    const r = snapScalar(10.2, 'x', { guides: [vGuide(10.4), near] });
    expect(r.guide).toBe(near);
  });
});

describe('snapAxis — rigid group snap', () => {
  it('returns a small grid delta when no guide is in range', () => {
    const { delta, guide } = snapAxis([1.23, 11.23], 'x');
    expect(delta).toBeCloseTo(-0.03, 6);
    expect(guide).toBeNull();
  });

  it('returns the delta that lands the nearest candidate on a guide', () => {
    // right edge at 20.3 is 0.3 from a guide at 20 -> shift the group by -0.3
    const g = vGuide(20);
    const { delta, guide } = snapAxis([0.3, 20.3], 'x', { guides: [g] });
    expect(delta).toBeCloseTo(-0.3, 6);
    expect(guide).toBe(g);
  });

  it('prefers the closest candidate/guide pair across the group', () => {
    const g = vGuide(20);
    // candidate 20.4 (dist .4) vs 19.9 (dist .1) — .1 wins
    const { delta } = snapAxis([19.9, 20.4], 'x', { guides: [g] });
    expect(delta).toBeCloseTo(0.1, 6);
  });
});

describe('snapBbox — edges, centre, and dragged handle', () => {
  const box = { x: 10, y: 10, width: 20, height: 10 }; // edges x 10/30, centreX 20

  it('snaps the left edge to a vertical guide', () => {
    const g = vGuide(10.2);
    const r = snapBbox(box, { guides: [g] });
    expect(r.dx).toBeCloseTo(0.2, 6);
    expect(r.guideX).toBe(g);
    expect(r.bbox.x).toBeCloseTo(10.2, 6);
    expect(r.bbox.width).toBe(20); // rigid move — size unchanged
  });

  it('snaps the centre to a guide', () => {
    const g = vGuide(20.3);
    const r = snapBbox(box, { guides: [g] });
    expect(r.dx).toBeCloseTo(0.3, 6);
    expect(r.guideX).toBe(g);
  });

  it('snaps the right edge to a guide', () => {
    const g = vGuide(29.8);
    const r = snapBbox(box, { guides: [g] });
    expect(r.dx).toBeCloseTo(-0.2, 6);
  });

  it('snaps the dragged handle when supplied as an extra candidate', () => {
    const handle = { x: 30, y: 20 };
    const g = vGuide(30.4);
    const r = snapBbox(box, { guides: [g] }, handle);
    expect(r.dx).toBeCloseTo(0.4, 6);
    expect(r.guideX).toBe(g);
  });

  it('snaps x and y independently to their own guides', () => {
    const gx = vGuide(10.2);
    const gy = hGuide(10.1);
    const r = snapBbox(box, { guides: [gx, gy] });
    expect(r.guideX).toBe(gx);
    expect(r.guideY).toBe(gy);
    expect(r.dx).toBeCloseTo(0.2, 6);
    expect(r.dy).toBeCloseTo(0.1, 6);
  });

  it('does not snap to hidden guides (falls back to grid)', () => {
    const r = snapBbox(
      { x: 10.03, y: 10, width: 20, height: 10 },
      {
        guides: [vGuide(10, { hidden: true })],
      },
    );
    expect(r.guideX).toBeNull();
    // grid still catches: left edge 10.03 -> 10
    expect(r.bbox.x).toBeCloseTo(10, 6);
  });

  it('lets an explicit guide win a tie against the grid', () => {
    // left edge at 10.05 is 0.05 from grid line 10 and 0.05 from a guide at 10.1
    const g = vGuide(10.1);
    const r = snapBbox({ x: 10.05, y: 10, width: 20, height: 10 }, { guides: [g] });
    expect(r.guideX).toBe(g);
    expect(r.bbox.x).toBeCloseTo(10.1, 6);
  });
});
