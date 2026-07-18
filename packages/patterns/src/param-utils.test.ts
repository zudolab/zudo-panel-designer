import { describe, it, expect } from 'vitest';
import { hash01 } from './param-utils';

// hash01 backs "was rand() in pgen" per-cell choices (tile orientation, cell
// skip, jitter) for ported patterns — see .claude/skills/port-pgen-patterns/.
// It must be a pure deterministic integer hash with a uniform-ish [0,1) spread
// and independent channels, including for the negative cell indices produced by
// the centered lattice.

const SPAN = 50; // test grid: cell indices in [-SPAN, SPAN] on both axes

function sampleGrid(channel = 0, salt = 0): number[] {
  const out: number[] = [];
  for (let iy = -SPAN; iy <= SPAN; iy += 1) {
    for (let ix = -SPAN; ix <= SPAN; ix += 1) {
      out.push(hash01(ix, iy, channel, salt));
    }
  }
  return out;
}

describe('hash01', () => {
  it('is deterministic: identical inputs give identical outputs', () => {
    const cases: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [1, 2, 3, 4],
      [-7, 13, 1, 0],
      [123456, -654321, 2, 99],
    ];
    for (const [ix, iy, channel, salt] of cases) {
      expect(hash01(ix, iy, channel, salt)).toBe(hash01(ix, iy, channel, salt));
    }
  });

  it('defaults channel and salt to 0', () => {
    expect(hash01(3, 4)).toBe(hash01(3, 4, 0, 0));
    expect(hash01(-3, 4)).toBe(hash01(-3, 4, 0, 0));
  });

  it('stays in [0,1) and never returns NaN, including extreme inputs', () => {
    const extremes = [0, 1, -1, 2 ** 31 - 1, -(2 ** 31), 2 ** 40, -(2 ** 40)];
    for (const ix of extremes) {
      for (const iy of extremes) {
        for (const channel of [0, 1, 7]) {
          const v = hash01(ix, iy, channel, 5);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }
    }
    for (const v of sampleGrid()) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads uniform-ish: mean near 0.5 and every decile populated evenly', () => {
    const values = sampleGrid();
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);

    const buckets = new Array<number>(10).fill(0);
    for (const v of values) buckets[Math.min(9, Math.floor(v * 10))] += 1;
    const expected = values.length / 10;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });

  it('decorrelates neighbouring cells (no visible striping)', () => {
    let flips = 0;
    let total = 0;
    for (let iy = -SPAN; iy <= SPAN; iy += 1) {
      for (let ix = -SPAN; ix < SPAN; ix += 1) {
        const a = hash01(ix, iy) < 0.5;
        const b = hash01(ix + 1, iy) < 0.5;
        if (a !== b) flips += 1;
        total += 1;
      }
    }
    // A coin-flip decision should disagree with its right neighbour ~50% of
    // the time; heavy striping or mirroring would push this toward 0 or 1.
    expect(flips / total).toBeGreaterThan(0.45);
    expect(flips / total).toBeLessThan(0.55);
  });

  it('does not mirror negative indices onto positive ones', () => {
    let same = 0;
    for (let i = 1; i <= 100; i += 1) {
      if (hash01(-i, i) === hash01(i, i)) same += 1;
      if (hash01(i, -i) === hash01(i, i)) same += 1;
    }
    expect(same).toBe(0);
  });

  it('separates channels: same cell, different channel, independent values', () => {
    const a = sampleGrid(0);
    const b = sampleGrid(1);
    let identical = 0;
    let bothHigh = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) identical += 1;
      if (a[i] >= 0.5 && b[i] >= 0.5) bothHigh += 1;
    }
    // Practically no collisions cell-for-cell...
    expect(identical / a.length).toBeLessThan(0.001);
    // ...and no correlation between the two decision streams: independent
    // fair coins land on (high, high) ~25% of the time.
    expect(bothHigh / a.length).toBeGreaterThan(0.2);
    expect(bothHigh / a.length).toBeLessThan(0.3);
  });

  it('separates salts: same cell and channel, different salt', () => {
    let identical = 0;
    let total = 0;
    for (let iy = -20; iy <= 20; iy += 1) {
      for (let ix = -20; ix <= 20; ix += 1) {
        if (hash01(ix, iy, 0, 0) === hash01(ix, iy, 0, 1)) identical += 1;
        total += 1;
      }
    }
    expect(identical / total).toBeLessThan(0.001);
  });
});
