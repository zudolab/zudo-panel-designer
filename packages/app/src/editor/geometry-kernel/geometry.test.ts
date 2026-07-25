// Pure-geometry helpers — no boolean backend involved, so these run without
// touching path-bool. The exactness claims in geometry.ts's comments (Green's
// theorem coefficients, de Casteljau round-trip) are what get pinned here;
// they are what lets the engine tests use tight tolerances instead of
// sampling fudge factors.
import { describe, expect, it } from 'vitest';
import {
  cubicSignedArea,
  flattenRing,
  KAPPA,
  pointInPolygon,
  reverseRing,
  ringInteriorPoint,
  ringSignedArea,
  sampleCubicAt,
  splitCubicAt,
} from './geometry';
import type { KernelCubic, KernelRing } from './types';

function line(p0: { x: number; y: number }, p3: { x: number; y: number }): KernelCubic {
  return { p0, c1: p0, c2: p3, p3 };
}

function rectRing(x: number, y: number, w: number, h: number): KernelRing {
  const tl = { x, y };
  const tr = { x: x + w, y };
  const br = { x: x + w, y: y + h };
  const bl = { x, y: y + h };
  return [line(tl, tr), line(tr, br), line(br, bl), line(bl, tl)];
}

// A circle of radius r centred at (cx, cy) as four kappa cubics, clockwise in
// y-down space (positive signed area).
function circleRing(cx: number, cy: number, r: number): KernelRing {
  const k = KAPPA * r;
  const e = { x: cx + r, y: cy };
  const s = { x: cx, y: cy + r };
  const w = { x: cx - r, y: cy };
  const n = { x: cx, y: cy - r };
  return [
    { p0: e, c1: { x: e.x, y: e.y + k }, c2: { x: s.x + k, y: s.y }, p3: s },
    { p0: s, c1: { x: s.x - k, y: s.y }, c2: { x: w.x, y: w.y + k }, p3: w },
    { p0: w, c1: { x: w.x, y: w.y - k }, c2: { x: n.x - k, y: n.y }, p3: n },
    { p0: n, c1: { x: n.x + k, y: n.y }, c2: { x: e.x, y: e.y - k }, p3: e },
  ];
}

describe('sampleCubicAt', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const c = line({ x: 2, y: 3 }, { x: 8, y: 11 });
    expect(sampleCubicAt(c, 0)).toEqual({ x: 2, y: 3 });
    expect(sampleCubicAt(c, 1)).toEqual({ x: 8, y: 11 });
  });

  it('traces a degenerate cubic as a straight line, but not at uniform speed', () => {
    // c1 === p0 and c2 === p3, so the curve IS the segment (0,0)→(10,20) and
    // every sample is collinear — yet the Bernstein parameter is NOT the chord
    // fraction (t=0.25 lands 0.15625 along it). That gap is exactly what
    // engine.ts's lineFractionToCubicParameter exists to undo.
    const c = line({ x: 0, y: 0 }, { x: 10, y: 20 });
    const p = sampleCubicAt(c, 0.25);
    expect(p.y).toBeCloseTo(p.x * 2, 12); // on the line y = 2x
    expect(p.x / 10).toBeCloseTo(0.15625, 12);
  });
});

describe('splitCubicAt', () => {
  const curve: KernelCubic = {
    p0: { x: 0, y: 0 },
    c1: { x: 0, y: 10 },
    c2: { x: 10, y: 10 },
    p3: { x: 10, y: 0 },
  };

  it('shares the on-curve midpoint between both halves', () => {
    const { left, right, mid } = splitCubicAt(curve, 0.4);
    expect(left.p3).toEqual(mid);
    expect(right.p0).toEqual(mid);
    expect(mid.x).toBeCloseTo(sampleCubicAt(curve, 0.4).x, 12);
    expect(mid.y).toBeCloseTo(sampleCubicAt(curve, 0.4).y, 12);
  });

  it('retraces the original curve exactly (no visual deformation)', () => {
    const t = 0.3;
    const { left, right } = splitCubicAt(curve, t);
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const onLeft = sampleCubicAt(left, u);
      const onOriginal = sampleCubicAt(curve, u * t);
      expect(onLeft.x).toBeCloseTo(onOriginal.x, 12);
      expect(onLeft.y).toBeCloseTo(onOriginal.y, 12);

      const onRight = sampleCubicAt(right, u);
      const onOrigRight = sampleCubicAt(curve, t + u * (1 - t));
      expect(onRight.x).toBeCloseTo(onOrigRight.x, 12);
      expect(onRight.y).toBeCloseTo(onOrigRight.y, 12);
    }
  });

  it('conserves total signed area across the split', () => {
    const { left, right } = splitCubicAt(curve, 0.62);
    expect(cubicSignedArea(left) + cubicSignedArea(right)).toBeCloseTo(cubicSignedArea(curve), 12);
  });
});

describe('ringSignedArea', () => {
  it('is exact for a rectangle of degenerate cubics', () => {
    // 40mm x 25mm = 1000mm^2; clockwise in y-down space => positive.
    expect(ringSignedArea(rectRing(5, 7, 40, 25))).toBe(1000);
  });

  it('matches pi*r^2 to kappa-approximation accuracy for a circle', () => {
    const area = ringSignedArea(circleRing(0, 0, 10));
    // The 4-cubic kappa circle is a ~0.03% area underestimate of a true circle;
    // the closed form is exact FOR THOSE CONTROL POINTS, which is the claim.
    expect(area / (Math.PI * 100)).toBeCloseTo(1, 3);
  });

  it('flips sign under reverseRing without changing magnitude', () => {
    const ring = circleRing(3, -4, 7);
    expect(ringSignedArea(reverseRing(ring))).toBeCloseTo(-ringSignedArea(ring), 12);
  });
});

describe('reverseRing', () => {
  it('reverses traversal and swaps the control points of each segment', () => {
    const ring = rectRing(0, 0, 10, 10);
    const rev = reverseRing(ring);
    expect(rev).toHaveLength(ring.length);
    // The reversed ring starts where the original ended.
    expect(rev[0]!.p0).toEqual(ring[ring.length - 1]!.p3);
    // Round-tripping is the identity.
    expect(reverseRing(rev)).toEqual(ring);
  });
});

describe('pointInPolygon / ringInteriorPoint', () => {
  it('classifies inside and outside points of a rectangle', () => {
    const poly = flattenRing(rectRing(0, 0, 10, 10));
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, poly)).toBe(false);
  });

  it('finds an interior point of a rectangle (horizontal top edge)', () => {
    const ring = rectRing(0, 0, 10, 10);
    expect(pointInPolygon(ringInteriorPoint(ring), flattenRing(ring))).toBe(true);
  });

  it('finds an interior point of a very thin ring', () => {
    // 50mm x 0.05mm — a plausible trace-shaped result region.
    const ring = rectRing(0, 0, 50, 0.05);
    expect(pointInPolygon(ringInteriorPoint(ring), flattenRing(ring))).toBe(true);
  });

  it('finds an interior point of a curved ring', () => {
    const ring = circleRing(12, -8, 3);
    expect(pointInPolygon(ringInteriorPoint(ring), flattenRing(ring))).toBe(true);
  });

  it('is stable for an empty ring', () => {
    expect(ringInteriorPoint([])).toEqual({ x: 0, y: 0 });
  });
});

describe('KAPPA', () => {
  it('is the 90-degree circular-arc handle constant', () => {
    expect(KAPPA).toBeCloseTo(0.5522847498307933, 15);
  });
});
