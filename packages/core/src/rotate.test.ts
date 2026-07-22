import { describe, expect, it } from 'vitest';
import {
  normalizeRotationDeg,
  rotatableLayer,
  rotateLayerAboutPivot,
  rotateLayersAboutPivot,
} from './rotate';
import type {
  ImageLayer,
  PathLayer,
  PatternLayer,
  ShapeLayer,
  TextLayer,
} from './types';

const pivot = { x: 0, y: 0 };

// 90deg clockwise (y-down) about the origin lands exactly on an axis, but
// Math.cos(Math.PI / 2) is ~6.1e-17 rather than an exact 0, so the
// "vanishing" coordinate comes back as a tiny nonzero float — assert with
// toBeCloseTo rather than toEqual on the whole point.
function expectPt(pt: { x: number; y: number }, x: number, y: number): void {
  expect(pt.x).toBeCloseTo(x);
  expect(pt.y).toBeCloseTo(y);
}

describe('normalizeRotationDeg', () => {
  it('is the identity within [-180, 180)', () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(90)).toBe(90);
    expect(normalizeRotationDeg(-90)).toBe(-90);
  });

  it('wraps at the +180 boundary onto -180 (half-open interval)', () => {
    expect(normalizeRotationDeg(180)).toBe(-180);
    expect(normalizeRotationDeg(-180)).toBe(-180);
  });

  it('wraps values beyond a full turn', () => {
    expect(normalizeRotationDeg(270)).toBe(-90);
    expect(normalizeRotationDeg(-270)).toBe(90);
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(450)).toBe(90);
  });

  it('rounds to 0.1 degree resolution', () => {
    expect(normalizeRotationDeg(45.03)).toBe(45);
    expect(normalizeRotationDeg(45.06)).toBe(45.1);
  });
});

describe('rotatableLayer', () => {
  it('is true for shape/text/image/path, false for pattern', () => {
    expect(rotatableLayer({ type: 'shape' } as unknown as ShapeLayer)).toBe(true);
    expect(rotatableLayer({ type: 'text' } as unknown as TextLayer)).toBe(true);
    expect(rotatableLayer({ type: 'image' } as unknown as ImageLayer)).toBe(true);
    expect(rotatableLayer({ type: 'path' } as unknown as PathLayer)).toBe(true);
    expect(rotatableLayer({ type: 'pattern' } as unknown as PatternLayer)).toBe(false);
  });
});

describe('rotateLayerAboutPivot — shape', () => {
  const shape: ShapeLayer = {
    id: 's1',
    name: 'rect',
    type: 'shape',
    shape: 'rect',
    x: 5,
    y: -5,
    width: 10,
    height: 10,
    color: 0,
  };
  const ownCenter = { x: 10, y: 0 }; // shape.x + width/2, shape.y + height/2

  it('orbits the center 90deg clockwise about the pivot and sets rotation', () => {
    const result = rotateLayerAboutPivot(shape, ownCenter, pivot, 90) as ShapeLayer;
    // (10, 0) about (0,0) by 90deg clockwise (y-down) -> (0, 10)
    expect(result.x).toBeCloseTo(-5); // 5 + (0 - 10)
    expect(result.y).toBeCloseTo(5); // -5 + (10 - 0)
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.rotation).toBe(90);
  });

  it('45deg orbit lands on the pinned diagonal point', () => {
    const result = rotateLayerAboutPivot(shape, ownCenter, pivot, 45) as ShapeLayer;
    const sqrt2over2 = Math.SQRT1_2;
    expect(result.x + result.width / 2).toBeCloseTo(10 * sqrt2over2);
    expect(result.y + result.height / 2).toBeCloseTo(10 * sqrt2over2);
    expect(result.rotation).toBe(45);
  });

  it('adds delta to an existing rotation with the parentheses honored (not swallowed by ??)', () => {
    const rotated: ShapeLayer = { ...shape, rotation: 30 };
    const result = rotateLayerAboutPivot(rotated, ownCenter, pivot, 45) as ShapeLayer;
    expect(result.rotation).toBe(75);
  });

  it('normalizes the resulting rotation into [-180, 180)', () => {
    const rotated: ShapeLayer = { ...shape, rotation: 170 };
    const result = rotateLayerAboutPivot(rotated, ownCenter, pivot, 20) as ShapeLayer;
    expect(result.rotation).toBe(-170);
  });

  it('does not mutate the input layer', () => {
    const before = structuredClone(shape);
    rotateLayerAboutPivot(shape, ownCenter, pivot, 90);
    expect(shape).toEqual(before);
  });

  it('is a pure function of (start, delta) — re-baking from the same start twice is idempotent', () => {
    const first = rotateLayerAboutPivot(shape, ownCenter, pivot, 45);
    const second = rotateLayerAboutPivot(shape, ownCenter, pivot, 45);
    expect(first).toEqual(second);
  });
});

describe('rotateLayerAboutPivot — image', () => {
  const image: ImageLayer = {
    id: 'i1',
    name: 'img',
    type: 'image',
    src: 'data:image/png;base64,x',
    x: 5,
    y: -5,
    width: 10,
    height: 10,
  };
  const ownCenter = { x: 10, y: 0 };

  it('orbits like a shape and sets rotation', () => {
    const result = rotateLayerAboutPivot(image, ownCenter, pivot, 90) as ImageLayer;
    expect(result.x).toBeCloseTo(-5);
    expect(result.y).toBeCloseTo(5);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.rotation).toBe(90);
  });
});

describe('rotateLayerAboutPivot — text', () => {
  const text: TextLayer = {
    id: 't1',
    name: 'label',
    type: 'text',
    content: 'CV OUT',
    fontFamily: 'mono',
    sizeMm: 4,
    x: 8,
    y: -2,
    color: 2,
  };

  it('honors a deliberately off-center supplied center verbatim (canvas-measured, not core-estimated)', () => {
    // An off-center value core's own bbox estimate for this text would never
    // produce — proves the function trusts the caller-supplied center as-is
    // rather than recomputing one internally.
    const offCenter = { x: 100, y: -50 };
    // (100, -50) rotated 90deg clockwise about the origin (y-down) -> (50, 100)
    const newCenter = { x: 50, y: 100 };
    const result = rotateLayerAboutPivot(text, offCenter, pivot, 90) as TextLayer;
    expect(result.x).toBeCloseTo(text.x + (newCenter.x - offCenter.x));
    expect(result.y).toBeCloseTo(text.y + (newCenter.y - offCenter.y));
  });

  it('sets rotation from an initially-undefined value', () => {
    const result = rotateLayerAboutPivot(text, { x: 8, y: -2 }, pivot, 30) as TextLayer;
    expect(result.rotation).toBe(30);
  });
});

describe('rotateLayerAboutPivot — path', () => {
  const path: PathLayer = {
    id: 'p1',
    name: 'trace',
    type: 'path',
    points: [
      { x: 10, y: 0 },
      { x: 20, y: 0, hin: { x: 15, y: 0 }, hout: { x: 25, y: 0 } },
    ],
    closed: false,
    fill: null,
    stroke: 1,
    strokeWidth: 0.5,
  };

  it('rotates every anchor + hin/hout about the pivot directly, ignoring ownCenter', () => {
    const result = rotateLayerAboutPivot(path, { x: 999, y: 999 }, pivot, 90) as PathLayer;
    expectPt(result.points[0], 0, 10);
    expectPt(result.points[1], 0, 20);
    expectPt(result.points[1].hin!, 0, 15);
    expectPt(result.points[1].hout!, 0, 25);
  });

  it('rotates extraSubpaths too', () => {
    const withSubpaths: PathLayer = {
      ...path,
      extraSubpaths: [[{ x: 30, y: 0 }]],
    };
    const result = rotateLayerAboutPivot(withSubpaths, pivot, pivot, 90) as PathLayer;
    expect(result.extraSubpaths?.[0][0].x).toBeCloseTo(0);
    expect(result.extraSubpaths?.[0][0].y).toBeCloseTo(30);
  });

  it('has no rotation field to set — path bakes geometry only', () => {
    const result = rotateLayerAboutPivot(path, pivot, pivot, 90) as PathLayer;
    expect(result).not.toHaveProperty('rotation');
  });

  it('leaves closed/fill/stroke/strokeWidth unchanged', () => {
    const result = rotateLayerAboutPivot(path, pivot, pivot, 90) as PathLayer;
    expect(result.closed).toBe(false);
    expect(result.fill).toBeNull();
    expect(result.stroke).toBe(1);
    expect(result.strokeWidth).toBe(0.5);
  });

  it('does not mutate the input points', () => {
    const before = structuredClone(path);
    rotateLayerAboutPivot(path, pivot, pivot, 90);
    expect(path).toEqual(before);
  });

  it('is idempotent when re-baked from the same start', () => {
    const first = rotateLayerAboutPivot(path, pivot, pivot, 45);
    const second = rotateLayerAboutPivot(path, pivot, pivot, 45);
    expect(first).toEqual(second);
  });
});

describe('rotateLayerAboutPivot — pattern', () => {
  it('returns the pattern layer unchanged, by reference', () => {
    const pattern: PatternLayer = {
      id: 'pt1',
      name: 'grid',
      type: 'pattern',
      patternType: 'dots',
      params: { spacing: 5 },
      color: 1,
      x: 2,
      y: 3,
      size: 60,
    };
    expect(rotateLayerAboutPivot(pattern, { x: 0, y: 0 }, pivot, 90)).toBe(pattern);
  });
});

describe('rotateLayersAboutPivot', () => {
  const shape: ShapeLayer = {
    id: 's1',
    name: 'rect',
    type: 'shape',
    shape: 'rect',
    x: 5,
    y: -5,
    width: 10,
    height: 10,
    color: 0,
  };
  const path: PathLayer = {
    id: 'p1',
    name: 'trace',
    type: 'path',
    points: [{ x: 10, y: 0 }],
    closed: false,
    fill: null,
    stroke: 1,
    strokeWidth: 0.5,
  };
  const pattern: PatternLayer = {
    id: 'pt1',
    name: 'grid',
    type: 'pattern',
    patternType: 'dots',
    params: {},
    color: 1,
    x: 0,
    y: 0,
    size: 10,
  };

  it('rotates each eligible layer by the shared delta about the shared pivot', () => {
    const centersById = { s1: { x: 10, y: 0 } };
    const result = rotateLayersAboutPivot([shape, path, pattern], centersById, pivot, 90);
    const rotatedShape = result[0] as ShapeLayer;
    expect(rotatedShape.rotation).toBe(90);
    expect(rotatedShape.x).toBeCloseTo(-5);
    expect(rotatedShape.y).toBeCloseTo(5);

    const rotatedPath = result[1] as PathLayer;
    expectPt(rotatedPath.points[0], 0, 10);

    expect(result[2]).toBe(pattern); // pattern pass-through by reference
  });

  it('leaves a rotatable layer unchanged if its center is missing from centersById', () => {
    const result = rotateLayersAboutPivot([shape], {}, pivot, 90);
    expect(result[0]).toBe(shape);
  });

  it('does not mutate the input array or its layers', () => {
    const layers = [shape, path, pattern];
    const before = structuredClone(layers);
    rotateLayersAboutPivot(layers, { s1: { x: 10, y: 0 } }, pivot, 90);
    expect(layers).toEqual(before);
  });
});
