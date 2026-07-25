// The Y flip is the single fabrication-critical transform in the export: skip
// it and the whole panel is mirrored, apply it twice and you are back where you
// started, which looks identical to skipping it. Both are pinned here.
import { describe, expect, it } from 'vitest';
import { toGerberPoint, toGerberRing } from './coordinate-frame';
import type { IrRing } from './ir';
import { ASYMMETRIC_REGIONS, FIXTURE_PANEL } from './test-ir';

/** A = ½ Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ), indices wrapping (DECISIONS.md Decision 0.2). */
function ringSignedArea(ring: IrRing): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

describe('toGerberPoint', () => {
  it('maps the doc-space top-left corner to the Gerber-space top-left corner', () => {
    expect(toGerberPoint({ x: 0, y: 0 }, 128.5)).toEqual({ x: 0, y: 128.5 });
  });

  it('maps the doc-space bottom-left corner to the Gerber origin', () => {
    expect(toGerberPoint({ x: 0, y: 128.5 }, 128.5)).toEqual({ x: 0, y: 0 });
  });

  it('leaves x untouched', () => {
    expect(toGerberPoint({ x: 42.75, y: 60 }, 128.5)).toEqual({ x: 42.75, y: 68.5 });
  });

  it('is its own inverse, which is exactly why applying it twice is a bug', () => {
    const original = { x: 12.3, y: 45.6 };
    const flippedTwice = toGerberPoint(toGerberPoint(original, 128.5), 128.5);
    expect(flippedTwice.y).toBeCloseTo(original.y, 12);
  });
});

describe('toGerberRing', () => {
  it('preserves vertex order — Gerber polarity is LPD/LPC, never winding', () => {
    const ring: IrRing = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    expect(toGerberRing(ring, 128.5).map((p) => p.x)).toEqual([1, 3, 5]);
  });

  it('inverts the signed area of every outer ring — the second Y-flip tripwire', () => {
    for (const region of ASYMMETRIC_REGIONS) {
      const docArea = ringSignedArea(region.outer);
      const gerberArea = ringSignedArea(toGerberRing(region.outer, FIXTURE_PANEL.heightMm));

      expect(docArea).toBeGreaterThan(0); // Decision 0.2: outer rings are positive in doc space
      expect(gerberArea).toBeLessThan(0);
      expect(gerberArea).toBeCloseTo(-docArea, 9);
    }
  });

  it('inverts the signed area of hole rings too, keeping them opposite to outer', () => {
    for (const region of ASYMMETRIC_REGIONS) {
      for (const hole of region.holes) {
        expect(ringSignedArea(hole)).toBeLessThan(0);
        expect(ringSignedArea(toGerberRing(hole, FIXTURE_PANEL.heightMm))).toBeGreaterThan(0);
      }
    }
  });
});
