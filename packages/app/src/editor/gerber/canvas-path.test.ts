/**
 * Canvas2D path semantics, pinned as facts.
 *
 * These are deliberately separate from the raster parity suite. Parity proves
 * the two implementations AGREE; it cannot prove they are both right about the
 * spec, because both encode the same reading of it. So the spec behaviours that
 * a naive recording proxy gets wrong are asserted here directly, against
 * hand-computed geometry.
 */

import { describe, expect, it } from 'vitest';
import { ringSignedArea } from '../geometry-kernel';
import {
  CanvasPathBuilder,
  canvasArcSweep,
  strokeSubpathsOf,
  subpathFillRing,
} from './canvas-path';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const TAU = Math.PI * 2;

function builder(): CanvasPathBuilder {
  return new CanvasPathBuilder(DEFAULT_IR_TOLERANCE.arcMm);
}

describe('canvasArcSweep', () => {
  it('takes the angle the short way round in the travelled direction', () => {
    expect(canvasArcSweep(0, Math.PI / 2, false)).toBeCloseTo(Math.PI / 2, 12);
    expect(canvasArcSweep(Math.PI * 1.5, TAU, false)).toBeCloseTo(Math.PI / 2, 12);
    // Clockwise from 3π/2 to π/2 wraps forwards through 0, it does not go back.
    expect(canvasArcSweep(Math.PI * 1.5, Math.PI / 2, false)).toBeCloseTo(Math.PI, 12);
    expect(canvasArcSweep(Math.PI / 2, Math.PI * 1.5, true)).toBeCloseTo(-Math.PI, 12);
  });

  it('is the whole circle at a full turn or more, in either direction', () => {
    expect(canvasArcSweep(0, TAU, false)).toBe(TAU);
    expect(canvasArcSweep(0, TAU * 3, false)).toBe(TAU);
    expect(canvasArcSweep(0, -TAU, true)).toBe(-TAU);
  });

  it('keeps a hair under a full turn as a gapped arc, not a closed circle', () => {
    // `labyrinth-classical` passes exactly this shape: gap + GAP_ANGLE →
    // gap − GAP_ANGLE + 2π. Snapping it to a full circle would close the gap
    // the whole pattern is made of.
    const gap = 0.3;
    const sweep = canvasArcSweep(gap + 0.05, gap - 0.05 + TAU, false);
    expect(sweep).toBeLessThan(TAU);
    expect(sweep).toBeCloseTo(TAU - 0.1, 12);
  });
});

describe('CanvasPathBuilder — subpath bookkeeping', () => {
  it('treats lineTo on an EMPTY path as a moveTo, not as a segment from nowhere', () => {
    const b = builder();
    b.lineTo(3, 4);
    const [sub] = b.snapshot();
    expect(sub.start).toEqual({ x: 3, y: 4 });
    expect(sub.contour).toHaveLength(0);
  });

  it('keeps a zero-length subpath, which Canvas paints as a dot or a square', () => {
    const b = builder();
    b.moveTo(1, 1);
    b.lineTo(1, 1);
    const [sub] = b.snapshot();
    expect(sub.contour).toHaveLength(1);
    expect(strokeSubpathsOf(b.snapshot())).toHaveLength(1);
  });

  it('does not paint a bare moveTo', () => {
    const b = builder();
    b.moveTo(1, 1);
    expect(strokeSubpathsOf(b.snapshot())).toHaveLength(0);
    expect(subpathFillRing(b.snapshot()[0])).toEqual([]);
  });

  it('closePath appends the closing edge AND opens a subpath at the same origin', () => {
    const b = builder();
    b.moveTo(0, 0);
    b.lineTo(10, 0);
    b.lineTo(10, 10);
    b.closePath();
    // The next lineTo continues from the CLOSED subpath's first point, not from
    // (10, 10) — this is the behaviour that silently reshapes artwork if missed.
    b.lineTo(-5, 0);

    const subs = b.snapshot();
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].contour).toHaveLength(3);
    expect(subs[0].contour[2].p3).toEqual({ x: 0, y: 0 });
    expect(subs[1].start).toEqual({ x: 0, y: 0 });
    expect(subs[1].contour[0].p3).toEqual({ x: -5, y: 0 });
  });

  it('fill closes an open subpath implicitly, without the builder being closed', () => {
    const b = builder();
    b.moveTo(0, 0);
    b.lineTo(10, 0);
    b.lineTo(10, 10);
    const [sub] = b.snapshot();
    expect(sub.closed).toBe(false);
    const ring = subpathFillRing(sub);
    expect(ring).toHaveLength(3);
    expect(ring[2].p3).toEqual({ x: 0, y: 0 });
    expect(ringSignedArea(ring)).toBeCloseTo(50, 9);
  });

  it('rect adds a closed quad and then a fresh, unpaintable point subpath', () => {
    const b = builder();
    b.rect(1, 2, 4, 6);
    const subs = b.snapshot();
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].contour).toHaveLength(4);
    expect(subs[1].contour).toHaveLength(0);
    expect(strokeSubpathsOf(subs)).toHaveLength(1);
    expect(ringSignedArea(subpathFillRing(subs[0]))).toBeCloseTo(24, 9);
  });

  it('rect with a negative dimension REVERSES the winding rather than normalising', () => {
    // Which matters under nonzero: a reversed contour cancels an overlapping
    // one instead of adding to it.
    const b = builder();
    b.rect(10, 10, -4, 6);
    const area = ringSignedArea(subpathFillRing(b.snapshot()[0]));
    expect(Math.abs(area)).toBeCloseTo(24, 9);
    expect(area).toBeLessThan(0);
  });

  it('ignores a non-finite coordinate instead of poisoning the path', () => {
    const b = builder();
    b.moveTo(0, 0);
    b.lineTo(Number.NaN, 5);
    b.lineTo(10, 0);
    const [sub] = b.snapshot();
    expect(sub.contour).toHaveLength(1);
    expect(sub.contour[0].p3).toEqual({ x: 10, y: 0 });
  });
});

describe('CanvasPathBuilder — arc', () => {
  it('adds the implicit straight line from the current point to the arc start', () => {
    const b = builder();
    b.moveTo(0, 0);
    b.arc(10, 0, 5, 0, Math.PI);
    const [sub] = b.snapshot();
    // First segment is the connector (0,0) → (15,0), the arc's start point.
    expect(sub.contour[0].p0).toEqual({ x: 0, y: 0 });
    expect(sub.contour[0].p3.x).toBeCloseTo(15, 9);
    expect(sub.contour[0].p3.y).toBeCloseTo(0, 9);
    expect(sub.contour.length).toBeGreaterThan(1);
  });

  it('starts a subpath at the arc start when the path is empty', () => {
    const b = builder();
    b.arc(10, 0, 5, 0, Math.PI);
    const [sub] = b.snapshot();
    expect(sub.start.x).toBeCloseTo(15, 9);
    expect(sub.contour[0].p0.x).toBeCloseTo(15, 9);
  });

  it('makes two concentric arcs ONE subpath — the via annulus, not two circles', () => {
    // `via-grid-array` relies on this: the connector between the two circles is
    // what lets a single even-odd contour drill the hole.
    const b = builder();
    b.arc(0, 0, 4, 0, TAU);
    b.arc(0, 0, 2, 0, TAU);
    const subs = b.snapshot();
    expect(subs).toHaveLength(1);
    const ring = subpathFillRing(subs[0]);
    // Both circles traverse the same way, so their signed areas ADD under a
    // plain shoelace — it is the even-odd rule, applied later, that subtracts.
    expect(ringSignedArea(ring)).toBeCloseTo(Math.PI * (16 + 4), 2);
  });

  it('closes a full circle exactly on its own start point', () => {
    const b = builder();
    b.arc(3, 7, 5, 0, TAU);
    const [sub] = b.snapshot();
    const last = sub.contour[sub.contour.length - 1];
    expect(last.p3).toEqual(sub.contour[0].p0);
  });

  it('traverses a positive signed area for an increasing sweep in y-down space', () => {
    const b = builder();
    b.arc(0, 0, 5, 0, TAU);
    expect(ringSignedArea(subpathFillRing(b.snapshot()[0]))).toBeCloseTo(Math.PI * 25, 3);
  });

  it('adds only the connector for a zero sweep', () => {
    const b = builder();
    b.moveTo(0, 0);
    b.arc(10, 0, 5, 1, 1);
    const [sub] = b.snapshot();
    expect(sub.contour).toHaveLength(1);
  });

  it('mirrors Canvas by throwing on a negative radius', () => {
    expect(() => builder().arc(0, 0, -1, 0, TAU)).toThrow(RangeError);
  });
});
