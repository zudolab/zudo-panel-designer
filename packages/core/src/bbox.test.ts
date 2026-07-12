import { describe, expect, it } from 'vitest';
import { boundsOfPoints, mergeBboxes, rectCenter, rectCorners, rotatedRectAABB, unionBbox } from './bbox';

describe('rectCenter', () => {
  it('returns the midpoint', () => {
    expect(rectCenter({ x: 0, y: 0, width: 10, height: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('rectCorners', () => {
  it('returns the 4 corners in tl/tr/br/bl order', () => {
    expect(rectCorners({ x: 1, y: 2, width: 10, height: 5 })).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 2 },
      { x: 11, y: 7 },
      { x: 1, y: 7 },
    ]);
  });
});

describe('boundsOfPoints', () => {
  it('returns a zero rect for no points', () => {
    expect(boundsOfPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('bounds an arbitrary point set', () => {
    expect(boundsOfPoints([{ x: 3, y: 5 }, { x: -1, y: 2 }, { x: 4, y: -2 }])).toEqual({
      x: -1,
      y: -2,
      width: 5,
      height: 7,
    });
  });
});

describe('rotatedRectAABB', () => {
  it('is a no-op when rotation is 0 or undefined', () => {
    const rect = { x: 0, y: 0, width: 10, height: 4 };
    expect(rotatedRectAABB(rect)).toEqual(rect);
    expect(rotatedRectAABB(rect, 0)).toEqual(rect);
  });

  it('expands to a square AABB for a 45deg rotated rect', () => {
    const rect = { x: -5, y: -5, width: 10, height: 10 };
    const aabb = rotatedRectAABB(rect, 45);
    const diag = Math.sqrt(200); // 10*sqrt(2)
    expect(aabb.width).toBeCloseTo(diag, 5);
    expect(aabb.height).toBeCloseTo(diag, 5);
    expect(aabb.x).toBeCloseTo(-diag / 2, 5);
    expect(aabb.y).toBeCloseTo(-diag / 2, 5);
  });

  it('swaps width/height for a 90deg rotation of a non-square rect', () => {
    const rect = { x: 0, y: 0, width: 20, height: 10 };
    const aabb = rotatedRectAABB(rect, 90);
    expect(aabb.width).toBeCloseTo(10, 5);
    expect(aabb.height).toBeCloseTo(20, 5);
  });
});

describe('unionBbox / mergeBboxes', () => {
  it('unions two overlapping rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: -5, width: 10, height: 10 };
    expect(unionBbox(a, b)).toEqual({ x: 0, y: -5, width: 15, height: 15 });
  });

  it('merges a list of rects, and returns a zero rect for an empty list', () => {
    expect(mergeBboxes([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    const rects = [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 5, y: 5, width: 2, height: 2 },
      { x: -3, y: 1, width: 1, height: 1 },
    ];
    expect(mergeBboxes(rects)).toEqual({ x: -3, y: 0, width: 10, height: 7 });
  });
});
