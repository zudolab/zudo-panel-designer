import { describe, expect, it } from 'vitest';
import { KAPPA, sampleCubicAt } from '../geometry-kernel';
import {
  circularArcToCubics,
  ellipseToRing,
  ellipticalArcToCubics,
  measureArcDeviation,
} from './arc';
import { DEFAULT_IR_TOLERANCE, INITIAL_ELLIPSE_SEGMENTS, MAX_ELLIPSE_SEGMENTS } from './tolerance';

const TAU = Math.PI * 2;
const TOL = DEFAULT_IR_TOLERANCE.arcMm;

/** Worst |distance-from-centre − r| over a dense sample of the cubic chain. */
function maxRadialError(
  cubics: ReturnType<typeof ellipticalArcToCubics>,
  cx: number,
  cy: number,
  r: number,
): number {
  let worst = 0;
  for (const c of cubics) {
    for (let i = 0; i <= 64; i++) {
      const p = sampleCubicAt(c, i / 64);
      worst = Math.max(worst, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
    }
  }
  return worst;
}

describe('arc → cubic approximation (Decision 6.1)', () => {
  it('starts at 8 cubics per full ellipse, not 4', () => {
    const ring = ellipseToRing(0, 0, 5, 5, TOL);
    expect(ring.length).toBe(INITIAL_ELLIPSE_SEGMENTS);
  });

  it('measures deviation over a probe set that includes — but is not only — t = 0.5', () => {
    const cubics = ellipticalArcToCubics(0, 0, 64, 64, 0, TAU, TOL);
    expect(measureArcDeviation(cubics, 0, 0, 64, 64)).toBeLessThanOrEqual(TOL);
    // Decision 6.1's literal t = 0.5 probe is identically zero for this
    // construction — KAPPA is derived from forcing the midpoint onto the arc —
    // so measuring only there would never trigger the subdivision loop.
    for (const c of cubics) {
      const mid = sampleCubicAt(c, 0.5);
      expect(Math.abs(Math.hypot(mid.x, mid.y) - 64)).toBeLessThan(1e-9);
    }
  });

  it('keeps an r = 64 mm circle inside the 2.5 µm arc budget everywhere, not only at t = 0.5', () => {
    const cubics = ellipticalArcToCubics(0, 0, 64, 64, 0, TAU, TOL);
    expect(maxRadialError(cubics, 0, 0, 64)).toBeLessThanOrEqual(TOL);
  });

  it('beats the 4-cubic KAPPA circle it deliberately does not use', () => {
    // The classic construction, for comparison only: peak radial error is
    // ≈ 2.725e-4 × r, i.e. ~17 µm at r = 64 mm — over 3× the whole 5 µm budget.
    const r = 64;
    const k = KAPPA * r;
    const kappaCircle = [0, 1, 2, 3].map((q) => {
      const a = (q * Math.PI) / 2;
      const b = a + Math.PI / 2;
      const p0 = { x: r * Math.cos(a), y: r * Math.sin(a) };
      const p3 = { x: r * Math.cos(b), y: r * Math.sin(b) };
      return {
        p0,
        c1: { x: p0.x - k * Math.sin(a), y: p0.y + k * Math.cos(a) },
        c2: { x: p3.x + k * Math.sin(b), y: p3.y - k * Math.cos(b) },
        p3,
      };
    });
    const kappaError = maxRadialError(kappaCircle, 0, 0, r);
    expect(kappaError).toBeGreaterThan(0.015);
    const ours = maxRadialError(ellipticalArcToCubics(0, 0, r, r, 0, TAU, TOL), 0, 0, r);
    // Error falls as θ⁶, so halving the arc angle divides it by 64.
    expect(ours).toBeLessThan(kappaError / 50);
    expect(ours).toBeLessThanOrEqual(TOL);
  });

  it('leaves every panel-scale ellipse at the 8-segment start, as Decision 6.1 predicts', () => {
    // "every ellipse that fits a 128.5 mm panel is already inside budget at
    // the starting value" — including a strongly eccentric one.
    for (const [rx, ry] of [
      [64, 64],
      [60, 2],
      [40.45, 64.25],
    ] as const) {
      const cubics = ellipticalArcToCubics(0, 0, rx, ry, 0, TAU, TOL);
      expect(cubics.length).toBe(INITIAL_ELLIPSE_SEGMENTS);
      expect(measureArcDeviation(cubics, 0, 0, rx, ry)).toBeLessThanOrEqual(TOL);
    }
  });

  it('actually subdivides once the radius makes 8 segments too coarse', () => {
    const cubics = ellipticalArcToCubics(0, 0, 2000, 2000, 0, TAU, TOL);
    expect(cubics.length).toBeGreaterThan(INITIAL_ELLIPSE_SEGMENTS);
    expect(measureArcDeviation(cubics, 0, 0, 2000, 2000)).toBeLessThanOrEqual(TOL);
  });

  it('caps at 256 segments per full ellipse', () => {
    // An impossible tolerance must terminate at the cap, not spin.
    const cubics = ellipticalArcToCubics(0, 0, 60, 2, 0, TAU, 1e-12);
    expect(cubics.length).toBe(MAX_ELLIPSE_SEGMENTS);
  });

  it('traverses increasing φ with a POSITIVE shoelace area (Decision 0.2 outer sign)', () => {
    const ring = ellipseToRing(10, 20, 5, 3, TOL);
    let area = 0;
    for (const c of ring) {
      // exact Green's-theorem term, same form as the kernel's cubicSignedArea
      area +=
        (0.6 * (c.p0.x * c.c1.y - c.c1.x * c.p0.y) +
          0.3 * (c.p0.x * c.c2.y - c.c2.x * c.p0.y) +
          0.1 * (c.p0.x * c.p3.y - c.p3.x * c.p0.y) +
          0.3 * (c.c1.x * c.c2.y - c.c2.x * c.c1.y) +
          0.3 * (c.c1.x * c.p3.y - c.p3.x * c.c1.y) +
          0.6 * (c.c2.x * c.p3.y - c.p3.x * c.c2.y)) /
        2;
    }
    expect(area).toBeGreaterThan(0);
    expect(area).toBeCloseTo(Math.PI * 5 * 3, 3);
  });

  it('closes the ring exactly on its own start point', () => {
    const ring = ellipseToRing(1, 2, 3, 4, TOL);
    expect(ring[ring.length - 1].p3).toBe(ring[0].p0);
  });

  it('holds the same 2.5 µm bound for a stroker round cap, which is an arc like any other', () => {
    const cap = circularArcToCubics({ x: 0, y: 0 }, 25, 0, Math.PI, TOL);
    expect(maxRadialError(cap, 0, 0, 25)).toBeLessThanOrEqual(TOL);
  });

  it('contributes nothing for a degenerate radius or zero sweep', () => {
    expect(ellipticalArcToCubics(0, 0, 0, 5, 0, TAU, TOL)).toEqual([]);
    expect(ellipticalArcToCubics(0, 0, 5, 5, 0, 0, TOL)).toEqual([]);
    expect(ellipseToRing(0, 0, 5, 0, TOL)).toEqual([]);
  });
});
