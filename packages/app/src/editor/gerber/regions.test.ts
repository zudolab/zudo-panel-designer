import { describe, expect, it } from 'vitest';
import { reverseRing } from '../geometry-kernel';
import { polygonSignedArea } from './flatten';
import type { IrRing } from './ir';
import { rectToRing } from './primitives';
import { countRegionVertices, ringsToRegions } from './regions';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const TOL = DEFAULT_IR_TOLERANCE;

function bbox(ring: IrRing): [number, number, number, number] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('ringsToRegions — winding (Decision 0.2)', () => {
  it('pins outer rings positive and holes negative by shoelace sign in doc space', () => {
    const regions = ringsToRegions(
      [rectToRing(0, 0, 10, 10), reverseRing(rectToRing(2, 2, 6, 6))],
      TOL,
    );
    expect(regions).toHaveLength(1);
    expect(polygonSignedArea(regions[0].outer)).toBeGreaterThan(0);
    expect(regions[0].holes).toHaveLength(1);
    expect(polygonSignedArea(regions[0].holes[0])).toBeLessThan(0);
  });

  it('normalises whatever winding the kernel hands back', () => {
    // path-bool returns outer rings NEGATIVELY wound; the IR contract is the
    // opposite, so the sign has to be re-derived rather than trusted.
    const regions = ringsToRegions(
      [reverseRing(rectToRing(0, 0, 10, 10)), rectToRing(2, 2, 6, 6)],
      TOL,
    );
    expect(polygonSignedArea(regions[0].outer)).toBeGreaterThan(0);
    expect(polygonSignedArea(regions[0].holes[0])).toBeLessThan(0);
  });

  it('leaves rings implicitly closed with at least 3 vertices', () => {
    const regions = ringsToRegions([rectToRing(0, 0, 10, 10)], TOL);
    expect(regions[0].outer).toHaveLength(4);
    expect(regions[0].outer[0]).not.toEqual(regions[0].outer[3]);
  });
});

describe('ringsToRegions — nesting (Decision 0.3)', () => {
  // outer 0–100, its hole 20–80, an island 30–70 inside that hole, and the
  // island's own hole 40–60. There is no hole-of-a-hole in the IR.
  const NESTED = [
    rectToRing(0, 0, 100, 100),
    rectToRing(20, 20, 60, 60),
    rectToRing(30, 30, 40, 40),
    rectToRing(40, 40, 20, 20),
  ];

  it('promotes an island inside a hole to its own later region', () => {
    const regions = ringsToRegions(NESTED, TOL);
    expect(regions).toHaveLength(2);

    expect(bbox(regions[0].outer)).toEqual([0, 0, 100, 100]);
    expect(regions[0].holes).toHaveLength(1);
    expect(bbox(regions[0].holes[0])).toEqual([20, 20, 80, 80]);

    // The island is a REGION, not a second entry in the first region's holes.
    expect(bbox(regions[1].outer)).toEqual([30, 30, 70, 70]);
    expect(regions[1].holes).toHaveLength(1);
    expect(bbox(regions[1].holes[0])).toEqual([40, 40, 60, 60]);
  });

  it('orders a contained region after the region whose hole contains it', () => {
    // Gerber is an ordered image stream: an island emitted before the %LPC*%
    // that clears its surroundings is erased. Shuffling the input must not
    // change the emitted order.
    for (const order of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
    ]) {
      const regions = ringsToRegions(
        order.map((i) => NESTED[i]),
        TOL,
      );
      expect(bbox(regions[0].outer)).toEqual([0, 0, 100, 100]);
      expect(bbox(regions[1].outer)).toEqual([30, 30, 70, 70]);
    }
  });

  it('sorts siblings deterministically by min(y) then min(x)', () => {
    const regions = ringsToRegions(
      [rectToRing(50, 50, 5, 5), rectToRing(10, 5, 5, 5), rectToRing(0, 5, 5, 5)],
      TOL,
    );
    expect(regions.map((r) => bbox(r.outer)[0])).toEqual([0, 10, 50]);
    expect(regions.map((r) => bbox(r.outer)[1])).toEqual([5, 5, 50]);
  });

  it('counts every emitted vertex for the complexity ceiling', () => {
    expect(countRegionVertices(ringsToRegions(NESTED, TOL))).toBe(16);
  });

  it('splits a point-touching run into simple lobes before classifying it', () => {
    // Two squares meeting at exactly one corner come back from path-bool as a
    // single non-simple run with the shared vertex repeated (a documented
    // kernel limit). Emitting that as one IrRing would break the contract and
    // hand the writer a self-touching G36 contour.
    const bothLobes = [...rectToRing(0, 0, 10, 10), ...rectToRing(10, 10, 10, 10)];
    const regions = ringsToRegions([bothLobes], TOL);
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => bbox(r.outer))).toEqual([
      [0, 0, 10, 10],
      [10, 10, 20, 20],
    ]);
    for (const region of regions) {
      expect(region.outer).toHaveLength(4);
      expect(polygonSignedArea(region.outer)).toBeGreaterThan(0);
    }
  });

  it('leaves an ordinary simple ring whole', () => {
    const regions = ringsToRegions([rectToRing(0, 0, 10, 10)], TOL);
    expect(regions).toHaveLength(1);
    expect(regions[0].outer).toHaveLength(4);
  });

  it('drops a ring that flattens below 3 vertices', () => {
    expect(ringsToRegions([rectToRing(0, 0, 1e-7, 1e-7)], TOL)).toEqual([]);
  });
});
