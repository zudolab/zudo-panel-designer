import { describe, expect, it } from 'vitest';
import { isResizable, resizeRect, type ResizeHandle } from './resize';

describe('isResizable', () => {
  it('is true when unrotated (undefined or 0), false when rotated', () => {
    expect(isResizable(undefined)).toBe(true);
    expect(isResizable(0)).toBe(true);
    expect(isResizable(45)).toBe(false);
    expect(isResizable(-90)).toBe(false);
  });
});

describe('resizeRect', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };

  it('e/w only change width, keeping the opposite edge fixed', () => {
    expect(resizeRect(rect, 'e', 5, 0)).toEqual({ x: 10, y: 10, width: 25, height: 20 });
    expect(resizeRect(rect, 'w', 5, 0)).toEqual({ x: 15, y: 10, width: 15, height: 20 });
  });

  it('n/s only change height, keeping the opposite edge fixed', () => {
    expect(resizeRect(rect, 's', 0, 5)).toEqual({ x: 10, y: 10, width: 20, height: 25 });
    expect(resizeRect(rect, 'n', 0, 5)).toEqual({ x: 10, y: 15, width: 20, height: 15 });
  });

  it('corner handles change both axes, keeping the opposite corner fixed', () => {
    expect(resizeRect(rect, 'se', 5, 5)).toEqual({ x: 10, y: 10, width: 25, height: 25 });
    expect(resizeRect(rect, 'sw', 5, 5)).toEqual({ x: 15, y: 10, width: 15, height: 25 });
    expect(resizeRect(rect, 'ne', 5, 5)).toEqual({ x: 10, y: 15, width: 25, height: 15 });
    expect(resizeRect(rect, 'nw', 5, 5)).toEqual({ x: 15, y: 15, width: 15, height: 15 });
  });

  it('clamps at minSize instead of shrinking further', () => {
    const result = resizeRect(rect, 'e', -100, 0, 2);
    expect(result.width).toBe(2);
  });

  it('never inverts: dragging a start-edge handle past the far edge clamps to minSize and stops', () => {
    const result = resizeRect(rect, 'w', 100, 0, 2); // dragging the west edge far past the east edge
    expect(result.width).toBe(2);
    expect(result.x).toBe(rect.x + rect.width - 2); // opposite (east) edge stays fixed
  });

  it('crosses the minimum size cleanly for every handle without inverting the rect', () => {
    const handles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const handle of handles) {
      const result = resizeRect(rect, handle, -1000, -1000, 3);
      expect(result.width).toBeGreaterThanOrEqual(3);
      expect(result.height).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses DEFAULT_MIN_SIZE_MM when minSize is omitted', () => {
    const result = resizeRect(rect, 'e', -1000, 0);
    expect(result.width).toBe(1);
  });
});
