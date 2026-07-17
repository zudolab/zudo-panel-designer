import { describe, expect, it } from 'vitest';
import { resizeRect, resizeRotatedRect, type ResizeHandle } from './resize';

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

// --- rotation-aware resize (stage 2) ---
//
// The invariants below are computed with independent geometry helpers (NOT the
// implementation's own math): a rotated rect's handle point / anchor point in
// world space, via corner rotation about the rect center.

interface Pt {
  x: number;
  y: number;
}
interface TestRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ALL_HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const OPPOSITE: Record<ResizeHandle, ResizeHandle> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  ne: 'sw',
  nw: 'se',
  se: 'nw',
  sw: 'ne',
};

function centerOf(r: TestRect): Pt {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// degrees clockwise about `c` (y-down screen coords), same convention as bbox.ts
function rotateAbout(p: Pt, c: Pt, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return {
    x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

// the handle's point on the unrotated rect: corner for corner handles, edge
// midpoint for edge handles
function handleLocalPoint(r: TestRect, handle: ResizeHandle): Pt {
  const c = centerOf(r);
  const x = handle.includes('w') ? r.x : handle.includes('e') ? r.x + r.width : c.x;
  const y = handle.includes('n') ? r.y : handle.includes('s') ? r.y + r.height : c.y;
  return { x, y };
}

function handleWorldPoint(r: TestRect, handle: ResizeHandle, deg: number): Pt {
  return rotateAbout(handleLocalPoint(r, handle), centerOf(r), deg);
}

function anchorWorld(r: TestRect, handle: ResizeHandle, deg: number): Pt {
  return handleWorldPoint(r, OPPOSITE[handle], deg);
}

function expectPtClose(actual: Pt, expected: Pt) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('resizeRotatedRect', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  const SQRT2 = Math.sqrt(2);

  it('rotation 0 / undefined is bit-identical to resizeRect', () => {
    for (const handle of ALL_HANDLES) {
      expect(resizeRotatedRect(rect, 0, handle, 5, 3)).toEqual(resizeRect(rect, handle, 5, 3));
      expect(resizeRotatedRect(rect, undefined, handle, 5, 3)).toEqual(resizeRect(rect, handle, 5, 3));
      expect(resizeRotatedRect(rect, 0, handle, -1000, -1000, 3)).toEqual(resizeRect(rect, handle, -1000, -1000, 3));
    }
  });

  it("at 90° the e handle points visually down: a downward drag grows width, west edge stays put", () => {
    // local +x axis rotated 90° cw = world +y (down). Dragging the (visually
    // bottom) 'e' handle down by 5 grows width by 5; the rect re-centers so the
    // opposite (west) edge midpoint stays visually fixed.
    const result = resizeRotatedRect(rect, 90, 'e', 0, 5);
    expect(result.x).toBeCloseTo(7.5, 9);
    expect(result.y).toBeCloseTo(12.5, 9);
    expect(result.width).toBeCloseTo(25, 9);
    expect(result.height).toBeCloseTo(20, 9);
  });

  it("at -90° the e handle points visually up: an upward drag grows width", () => {
    const result = resizeRotatedRect(rect, -90, 'e', 0, -5);
    expect(result.x).toBeCloseTo(7.5, 9);
    expect(result.y).toBeCloseTo(7.5, 9);
    expect(result.width).toBeCloseTo(25, 9);
    expect(result.height).toBeCloseTo(20, 9);
  });

  it('at 45° a drag along the local x axis only changes width', () => {
    // world (5, 5) is exactly along the 45°-rotated local x axis, magnitude 5√2
    const result = resizeRotatedRect(rect, 45, 'e', 5, 5);
    expect(result.width).toBeCloseTo(20 + 5 * SQRT2, 9);
    expect(result.height).toBeCloseTo(20, 9);
    expectPtClose(anchorWorld(result, 'e', 45), anchorWorld(rect, 'e', 45));
  });

  it('at 45° a drag perpendicular to the local x axis leaves the e handle resize a no-op', () => {
    // world (-5, 5) is along the local y axis — no local x component at all
    const result = resizeRotatedRect(rect, 45, 'e', -5, 5);
    expect(result.x).toBeCloseTo(rect.x, 9);
    expect(result.y).toBeCloseTo(rect.y, 9);
    expect(result.width).toBeCloseTo(rect.width, 9);
    expect(result.height).toBeCloseTo(rect.height, 9);
  });

  it.each([90, 45, -30])('keeps the opposite anchor visually fixed for every handle at %d°', (deg) => {
    for (const handle of ALL_HANDLES) {
      const result = resizeRotatedRect(rect, deg, handle, 5, 3);
      expectPtClose(anchorWorld(result, handle, deg), anchorWorld(rect, handle, deg));
    }
  });

  it.each([90, 45, -30])('a corner handle lands exactly where the pointer dragged it at %d°', (deg) => {
    const corners: ResizeHandle[] = ['ne', 'nw', 'se', 'sw'];
    for (const handle of corners) {
      const result = resizeRotatedRect(rect, deg, handle, 5, 3);
      const before = handleWorldPoint(rect, handle, deg);
      expectPtClose(handleWorldPoint(result, handle, deg), { x: before.x + 5, y: before.y + 3 });
    }
  });

  it.each([90, 45, -30])('an edge handle moves by the drag projected onto its local axis at %d°', (deg) => {
    const rad = (deg * Math.PI) / 180;
    const axisFor: Partial<Record<ResizeHandle, Pt>> = {
      e: { x: Math.cos(rad), y: Math.sin(rad) }, // local +x in world
      w: { x: Math.cos(rad), y: Math.sin(rad) },
      s: { x: -Math.sin(rad), y: Math.cos(rad) }, // local +y in world
      n: { x: -Math.sin(rad), y: Math.cos(rad) },
    };
    for (const handle of ['n', 's', 'e', 'w'] as ResizeHandle[]) {
      const axis = axisFor[handle]!;
      const dot = 5 * axis.x + 3 * axis.y;
      const result = resizeRotatedRect(rect, deg, handle, 5, 3);
      const before = handleWorldPoint(rect, handle, deg);
      expectPtClose(handleWorldPoint(result, handle, deg), {
        x: before.x + dot * axis.x,
        y: before.y + dot * axis.y,
      });
    }
  });

  it('clamps at minSize in the local frame while the anchor stays visually fixed', () => {
    const result = resizeRotatedRect(rect, 45, 'e', -100, -100, 2);
    expect(result.width).toBe(2);
    expect(result.height).toBeCloseTo(20, 9);
    expectPtClose(anchorWorld(result, 'e', 45), anchorWorld(rect, 'e', 45));
  });

  it('crosses the minimum size cleanly for every handle at every rotation without inverting', () => {
    for (const deg of [90, 45, -30]) {
      for (const handle of ALL_HANDLES) {
        const result = resizeRotatedRect(rect, deg, handle, -1000, -1000, 3);
        expect(result.width).toBeGreaterThanOrEqual(3);
        expect(result.height).toBeGreaterThanOrEqual(3);
        expectPtClose(anchorWorld(result, handle, deg), anchorWorld(rect, handle, deg));
      }
    }
  });

  it('uses DEFAULT_MIN_SIZE_MM when minSize is omitted', () => {
    const result = resizeRotatedRect(rect, 45, 'e', -1000, -1000);
    expect(result.width).toBe(1);
  });
});
