import { describe, expect, it } from 'vitest';
import type { KernelCubic, KernelPoint } from '../geometry-kernel';
import { sampleCubicAt } from '../geometry-kernel';
import { ellipseToRing } from './arc';
import {
  collapseRingVertices,
  flattenChain,
  flattenRingAdaptive,
  polygonSignedArea,
} from './flatten';
import { DEFAULT_IR_TOLERANCE, IR_TOTAL_TOLERANCE_MM, MAX_FLATTEN_DEPTH } from './tolerance';

const { flattenMm, minSegmentMm } = DEFAULT_IR_TOLERANCE;

function distanceToSegment(p: KernelPoint, a: KernelPoint, b: KernelPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Worst distance from the analytic cubic to the emitted polyline. */
function maxChordDeviation(
  chain: readonly KernelCubic[],
  polyline: readonly KernelPoint[],
): number {
  let worst = 0;
  for (const c of chain) {
    for (let i = 0; i <= 2000; i++) {
      const p = sampleCubicAt(c, i / 2000);
      let best = Infinity;
      for (let k = 1; k < polyline.length; k++) {
        best = Math.min(best, distanceToSegment(p, polyline[k - 1], polyline[k]));
      }
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

// A deliberately nasty fixture: a long, high-curvature S with unevenly
// distributed control points, which is exactly what uniform-`t` sampling
// under-resolves.
const HIGH_CURVATURE: KernelCubic = {
  p0: { x: 0, y: 0 },
  c1: { x: 90, y: 0.2 },
  c2: { x: -30, y: 40 },
  p3: { x: 60, y: 40 },
};

describe('adaptive flattening (Decision 6.2)', () => {
  it('holds max chord deviation ≤ 2.5 µm on a high-curvature fixture', () => {
    const polyline = flattenChain([HIGH_CURVATURE], flattenMm, minSegmentMm);
    expect(maxChordDeviation([HIGH_CURVATURE], polyline)).toBeLessThanOrEqual(flattenMm);
  });

  it('beats a fixed 24-segment uniform sampling on the same fixture', () => {
    // DEFAULT_FLATTEN_SEGMENTS = 24 is a fixed count per cubic regardless of
    // arc length — fine for hit-testing, an order of magnitude out of budget
    // here. This is why #209 does not reuse it.
    const uniform: KernelPoint[] = [];
    for (let i = 0; i <= 24; i++) uniform.push(sampleCubicAt(HIGH_CURVATURE, i / 24));
    expect(maxChordDeviation([HIGH_CURVATURE], uniform)).toBeGreaterThan(flattenMm * 10);
  });

  it('scales the segment count with arc length rather than fixing it per cubic', () => {
    const tiny: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 0.03, y: 0 },
      c2: { x: 0.1, y: 0.07 },
      p3: { x: 0.1, y: 0.1 },
    };
    const huge: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 30, y: 0 },
      c2: { x: 100, y: 70 },
      p3: { x: 100, y: 100 },
    };
    expect(flattenChain([tiny], flattenMm, minSegmentMm).length).toBeLessThan(
      flattenChain([huge], flattenMm, minSegmentMm).length,
    );
  });

  it('subdivides a cubic whose control overshoots the chord but hugs its line', () => {
    // A line-distance flatness test calls this flat — both controls sit 1 µm
    // off the p0→p3 line — while the curve swings out to x ≈ −4.2 mm. Emitting
    // it as one chord would silently drop millimetres of artwork.
    const overshoot: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: -10, y: 0.001 },
      c2: { x: 0.3, y: 0.001 },
      p3: { x: 1, y: 0 },
    };
    const polyline = flattenChain([overshoot], flattenMm, minSegmentMm);
    expect(polyline.length).toBeGreaterThan(2);
    expect(Math.min(...polyline.map((p) => p.x))).toBeLessThan(-4);
    expect(maxChordDeviation([overshoot], polyline)).toBeLessThanOrEqual(flattenMm);
  });

  it('terminates on a degenerate cusped cubic instead of subdividing forever', () => {
    const cusp: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 10, y: 10 },
      c2: { x: -10, y: 10 },
      p3: { x: 0, y: 0 },
    };
    const polyline = flattenChain([cusp], flattenMm, minSegmentMm);
    expect(polyline.length).toBeGreaterThan(2);
    expect(polyline.length).toBeLessThan(2 ** MAX_FLATTEN_DEPTH);
    expect(polyline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('emits no segment shorter than the 1 µm minimum', () => {
    const polyline = flattenChain([HIGH_CURVATURE], flattenMm, minSegmentMm);
    const collapsed = collapseRingVertices(polyline, minSegmentMm);
    for (let i = 1; i < collapsed.length; i++) {
      expect(
        Math.hypot(collapsed[i].x - collapsed[i - 1].x, collapsed[i].y - collapsed[i - 1].y),
      ).toBeGreaterThanOrEqual(minSegmentMm);
    }
  });

  it('leaves an IrRing implicitly closed and collapses near-duplicates', () => {
    const ring = flattenRingAdaptive(
      ellipseToRing(0, 0, 8, 8, DEFAULT_IR_TOLERANCE.arcMm),
      flattenMm,
      minSegmentMm,
    );
    expect(ring.length).toBeGreaterThan(3);
    const first = ring[0];
    const last = ring[ring.length - 1];
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThanOrEqual(minSegmentMm);
  });

  it('drops a ring left with fewer than 3 vertices', () => {
    const speck: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 0 },
      c2: { x: 1e-5, y: 0 },
      p3: { x: 1e-5, y: 0 },
    };
    expect(
      flattenRingAdaptive(
        [speck, { p0: speck.p3, c1: speck.p3, c2: speck.p0, p3: speck.p0 }],
        flattenMm,
        minSegmentMm,
      ),
    ).toEqual([]);
  });

  it('lands an r = 64 mm ellipse within the 5 µm TOTAL budget end-to-end', () => {
    // The check that catches an in-budget flattener sitting on top of an
    // out-of-budget arc approximation (Decision 6.2).
    const ring = flattenRingAdaptive(
      ellipseToRing(0, 0, 64, 64, DEFAULT_IR_TOLERANCE.arcMm),
      flattenMm,
      minSegmentMm,
    );
    let worst = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const p of [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]) {
        worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - 64));
      }
    }
    expect(worst).toBeLessThanOrEqual(IR_TOTAL_TOLERANCE_MM);
  });

  it('signs a y-down clockwise polygon positive', () => {
    expect(
      polygonSignedArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(100);
  });
});
