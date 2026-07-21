import { describe, expect, it } from 'vitest';
import {
  buildPath2D,
  flattenPath,
  flattenSubpath,
  movePathAnchor,
  movePathHandle,
  pathBbox,
  rotatePathLayer,
  rotatePoints,
  translatePathLayer,
  translatePoints,
  type PathPointLike,
} from './path-geometry';

describe('buildPath2D', () => {
  it('returns null in Node (no global Path2D) instead of throwing', () => {
    expect(buildPath2D([{ x: 0, y: 0 }], false)).toBeNull();
  });
});

describe('flattenSubpath', () => {
  it('flattens a straight (handle-less) two-point open subpath onto the line exactly', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const poly = flattenSubpath(points, false, 4);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]).toEqual({ x: 10, y: 0 });
    for (const p of poly) {
      expect(p.y).toBeCloseTo(0, 9);
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('appends the wraparound segment when closed', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const open = flattenSubpath(points, false, 2);
    const closed = flattenSubpath(points, true, 2);
    expect(closed.length).toBeGreaterThan(open.length);
    expect(closed[closed.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('returns an empty polyline for zero points', () => {
    expect(flattenSubpath([], false)).toEqual([]);
  });

  it('bulges outward for a curved handle (not a straight line)', () => {
    const points: PathPointLike[] = [
      { x: 0, y: 0, hout: { x: 0, y: 10 } },
      { x: 10, y: 0, hin: { x: 10, y: 10 } },
    ];
    const poly = flattenSubpath(points, false, 20);
    const mid = poly[Math.floor(poly.length / 2)];
    expect(mid.y).toBeGreaterThan(1); // bulges toward the handles, off the straight chord
  });
});

describe('flattenPath', () => {
  it('returns one polyline per subpath (main + extras)', () => {
    const main: PathPointLike[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const hole: PathPointLike[] = [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }];
    const result = flattenPath(main, true, [hole]);
    expect(result).toHaveLength(2);
  });
});

describe('pathBbox', () => {
  it('bounds anchors and handles (approximation, not the flattened curve)', () => {
    const points: PathPointLike[] = [
      { x: 0, y: 0, hout: { x: -5, y: 0 } },
      { x: 10, y: 0 },
    ];
    expect(pathBbox(points)).toEqual({ x: -5, y: 0, width: 15, height: 0 });
  });

  it('returns a zero rect for no points', () => {
    expect(pathBbox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('includes extraSubpaths in the bounds', () => {
    const main: PathPointLike[] = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    const extra: PathPointLike[][] = [[{ x: 20, y: 20 }]];
    expect(pathBbox(main, extra)).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });
});

describe('translatePoints / translatePathLayer', () => {
  it('shifts anchors and handles by the same delta', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0, hin: { x: -1, y: -1 }, hout: { x: 1, y: 1 } }];
    const moved = translatePoints(points, 10, -5);
    expect(moved).toEqual([{ x: 10, y: -5, hin: { x: 9, y: -6 }, hout: { x: 11, y: -4 } }]);
  });

  it('translates extraSubpaths too, and omits the key when absent', () => {
    const layer = { points: [{ x: 0, y: 0 }], closed: true };
    expect(translatePathLayer(layer, 2, 3)).toEqual({ points: [{ x: 2, y: 3 }] });

    const withExtras = { points: [{ x: 0, y: 0 }], extraSubpaths: [[{ x: 1, y: 1 }]], closed: true };
    expect(translatePathLayer(withExtras, 2, 3)).toEqual({
      points: [{ x: 2, y: 3 }],
      extraSubpaths: [[{ x: 3, y: 4 }]],
    });
  });
});

// 90deg clockwise (y-down) about the origin lands exactly on an axis, but
// Math.cos(Math.PI / 2) is ~6.1e-17 rather than an exact 0, so the "vanishing"
// coordinate comes back as a tiny nonzero float — assert with toBeCloseTo
// rather than toEqual on the whole point.
function expectPt(pt: { x: number; y: number }, x: number, y: number): void {
  expect(pt.x).toBeCloseTo(x);
  expect(pt.y).toBeCloseTo(y);
}

describe('rotatePoints / rotatePathLayer', () => {
  it('rotates anchors and handles about the center (90deg clockwise, y-down)', () => {
    const points: PathPointLike[] = [{ x: 10, y: 0, hin: { x: 5, y: 0 }, hout: { x: 20, y: 0 } }];
    const rotated = rotatePoints(points, { x: 0, y: 0 }, 90);
    expectPt(rotated[0], 0, 10);
    expectPt(rotated[0].hin!, 0, 5);
    expectPt(rotated[0].hout!, 0, 20);
  });

  it('omits hin/hout on points that have none', () => {
    const rotated = rotatePoints([{ x: 10, y: 0 }], { x: 0, y: 0 }, 90);
    expect(rotated[0]).not.toHaveProperty('hin');
    expect(rotated[0]).not.toHaveProperty('hout');
  });

  it('rotates extraSubpaths too, and omits the key when absent', () => {
    const layer = { points: [{ x: 10, y: 0 }], closed: true };
    const noExtras = rotatePathLayer(layer, { x: 0, y: 0 }, 90);
    expect(noExtras).not.toHaveProperty('extraSubpaths');
    expectPt(noExtras.points[0], 0, 10);

    const withExtras = {
      points: [{ x: 10, y: 0 }],
      extraSubpaths: [[{ x: 0, y: 10 }]],
      closed: true,
    };
    const rotated = rotatePathLayer(withExtras, { x: 0, y: 0 }, 90);
    expectPt(rotated.points[0], 0, 10);
    expectPt(rotated.extraSubpaths![0][0], -10, 0);
  });

  it('does not mutate the input points', () => {
    const points: PathPointLike[] = [{ x: 10, y: 0, hin: { x: 5, y: 0 } }];
    const before = structuredClone(points);
    rotatePoints(points, { x: 0, y: 0 }, 90);
    expect(points).toEqual(before);
  });
});

describe('movePathAnchor', () => {
  it('moves the anchor and carries handles along by the same delta', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0, hin: { x: -1, y: 0 }, hout: { x: 1, y: 0 } }];
    const moved = movePathAnchor(points, 0, 5, 5);
    expect(moved).toEqual([{ x: 5, y: 5, hin: { x: 4, y: 5 }, hout: { x: 6, y: 5 } }]);
  });

  it('leaves points at other indices untouched', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const moved = movePathAnchor(points, 0, 1, 1);
    expect(moved[1]).toBe(points[1]);
  });
});

describe('movePathHandle', () => {
  it('moves the given handle without mirroring the opposite one', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0, hin: { x: -2, y: 0 }, hout: { x: 2, y: 0 } }];
    const moved = movePathHandle(points, 0, 'hout', 3, 4, false);
    expect(moved[0].hout).toEqual({ x: 3, y: 4 });
    expect(moved[0].hin).toEqual({ x: -2, y: 0 });
  });

  it('mirrors the opposite handle through the anchor when mirror is set', () => {
    const points: PathPointLike[] = [{ x: 0, y: 0, hin: { x: -2, y: 0 } }];
    const moved = movePathHandle(points, 0, 'hout', 3, 4, true);
    expect(moved[0].hout).toEqual({ x: 3, y: 4 });
    expect(moved[0].hin).toEqual({ x: -3, y: -4 }); // reflected about the (0,0) anchor
  });
});
