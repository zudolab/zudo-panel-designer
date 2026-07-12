import { describe, expect, it } from 'vitest';
import { snapPoint, snapToGrid } from './snap';

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
