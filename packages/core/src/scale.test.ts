import { describe, expect, it } from 'vitest';
import { scaleLayer } from './scale';
import type {
  ImageLayer,
  PathLayer,
  PatternLayer,
  ShapeLayer,
  TextLayer,
} from './types';

const anchor = { x: 10, y: 10 };

const shape: ShapeLayer = {
  id: 's1',
  name: 'rect',
  type: 'shape',
  shape: 'rect',
  x: 20,
  y: 30,
  width: 10,
  height: 20,
  color: 0,
};

describe('scaleLayer — shape', () => {
  it('scales x/y/width/height uniformly about the anchor', () => {
    const result = scaleLayer(shape, 2, anchor) as ShapeLayer;
    expect(result).toEqual({ ...shape, x: 30, y: 50, width: 20, height: 40 });
  });

  it('factor 1 is the identity', () => {
    expect(scaleLayer(shape, 1, anchor)).toEqual(shape);
  });

  it('preserves rotation untouched on a rotated shape', () => {
    const rotated: ShapeLayer = { ...shape, rotation: 33 };
    const result = scaleLayer(rotated, 2, anchor) as ShapeLayer;
    expect(result.rotation).toBe(33);
    expect(result).toEqual({ ...rotated, x: 30, y: 50, width: 20, height: 40 });
  });

  it('scales the rect center exactly about the anchor (rotation pivot stays consistent)', () => {
    const result = scaleLayer(shape, 3, anchor) as ShapeLayer;
    // center (25, 40) scaled about (10, 10) by 3 -> (55, 100)
    expect(result.x + result.width / 2).toBeCloseTo(55);
    expect(result.y + result.height / 2).toBeCloseTo(100);
  });

  it('preserves the aspect ratio through the min-size clamp', () => {
    const result = scaleLayer(shape, 0.0001, anchor, 2) as ShapeLayer;
    expect(result.height / result.width).toBeCloseTo(shape.height / shape.width);
  });

  it('clamps the FACTOR so the smallest dimension bottoms out at minSize, staying uniform', () => {
    // 10x20 at factor 0.01 with minSize 2: effective factor is 2/10 = 0.2,
    // so width lands exactly on minSize and height keeps the 1:2 aspect ratio.
    const result = scaleLayer(shape, 0.01, anchor, 2) as ShapeLayer;
    expect(result.width).toBe(2);
    expect(result.height).toBe(4);
    expect(result.x).toBeCloseTo(12); // 10 + (20 - 10) * 0.2
    expect(result.y).toBeCloseTo(14); // 10 + (30 - 10) * 0.2
  });

  it('position uses the clamped factor too — the layer does not drift toward the anchor once clamped', () => {
    const clamped = scaleLayer(shape, 0.01, anchor, 2) as ShapeLayer;
    const atFloor = scaleLayer(shape, 0.2, anchor, 2) as ShapeLayer;
    expect(clamped).toEqual(atFloor);
  });

  it('uses DEFAULT_MIN_SIZE_MM (1) when minSize is omitted', () => {
    const result = scaleLayer(shape, 0.001, anchor) as ShapeLayer;
    expect(result.width).toBe(1);
    expect(result.height).toBe(2);
  });

  it('does not mutate the input layer', () => {
    const before = structuredClone(shape);
    scaleLayer(shape, 2, anchor);
    expect(shape).toEqual(before);
  });

  it('clamps a mirrored shape (negative width) by its magnitude, preserving the sign', () => {
    // width -10 has the same visual size as +10, so a shrink to factor 0.01
    // with minSize 2 clamps to the same 0.2 effective factor. The clamped
    // width keeps its negative sign: -10 * 0.2 = -2 (magnitude at the floor).
    const mirrored: ShapeLayer = { ...shape, width: -10 };
    const result = scaleLayer(mirrored, 0.01, anchor, 2) as ShapeLayer;
    expect(result.width).toBe(-2);
    expect(result.height).toBe(4);
    expect(Math.abs(result.width)).toBe(2);
  });
});

describe('scaleLayer — image', () => {
  const image: ImageLayer = {
    id: 'i1',
    name: 'img',
    type: 'image',
    src: 'data:image/png;base64,x',
    x: 20,
    y: 20,
    width: 40,
    height: 30,
  };

  it('scales x/y/width/height uniformly about the anchor', () => {
    const result = scaleLayer(image, 0.5, anchor) as ImageLayer;
    expect(result).toEqual({ ...image, x: 15, y: 15, width: 20, height: 15 });
  });
});

describe('scaleLayer — text', () => {
  const text: TextLayer = {
    id: 't1',
    name: 'label',
    type: 'text',
    content: 'CV OUT',
    fontFamily: 'mono',
    sizeMm: 4,
    x: 30,
    y: 50,
    rotation: 90,
    color: 2,
  };

  it('scales x/y and sizeMm, preserving rotation', () => {
    const result = scaleLayer(text, 2, anchor) as TextLayer;
    expect(result).toEqual({ ...text, x: 50, y: 90, sizeMm: 8, rotation: 90 });
  });

  it('clamps the factor so sizeMm bottoms out at minSize, and x/y use the same clamped factor', () => {
    // sizeMm 4 at factor 0.01 with minSize 2: effective factor is 2/4 = 0.5.
    const result = scaleLayer(text, 0.01, anchor, 2) as TextLayer;
    expect(result.sizeMm).toBe(2);
    expect(result.x).toBeCloseTo(20); // 10 + (30 - 10) * 0.5
    expect(result.y).toBeCloseTo(30); // 10 + (50 - 10) * 0.5
  });
});

describe('scaleLayer — path', () => {
  const path: PathLayer = {
    id: 'p1',
    name: 'trace',
    type: 'path',
    points: [
      { x: 20, y: 20 },
      { x: 40, y: 20, hin: { x: 30, y: 10 }, hout: { x: 50, y: 30 } },
    ],
    closed: false,
    fill: null,
    stroke: 1,
    strokeWidth: 0.5,
  };

  it('scales every anchor point and its hin/hout bezier handles about the anchor', () => {
    const result = scaleLayer(path, 2, anchor) as PathLayer;
    expect(result.points).toEqual([
      { x: 30, y: 30 },
      { x: 70, y: 30, hin: { x: 50, y: 10 }, hout: { x: 90, y: 50 } },
    ]);
  });

  it('does not add hin/hout to points that have none', () => {
    const result = scaleLayer(path, 2, anchor) as PathLayer;
    expect(result.points[0]).not.toHaveProperty('hin');
    expect(result.points[0]).not.toHaveProperty('hout');
  });

  it('scales extraSubpaths too', () => {
    const withSubpaths: PathLayer = {
      ...path,
      extraSubpaths: [[{ x: 12, y: 14, hout: { x: 16, y: 18 } }]],
    };
    const result = scaleLayer(withSubpaths, 2, anchor) as PathLayer;
    expect(result.extraSubpaths).toEqual([[{ x: 14, y: 18, hout: { x: 22, y: 26 } }]]);
  });

  it('leaves closed/fill/stroke/strokeWidth unchanged', () => {
    const result = scaleLayer(path, 2, anchor) as PathLayer;
    expect(result.closed).toBe(false);
    expect(result.fill).toBeNull();
    expect(result.stroke).toBe(1);
    expect(result.strokeWidth).toBe(0.5);
  });

  it('does not mutate the input points', () => {
    const before = structuredClone(path);
    scaleLayer(path, 2, anchor);
    expect(path).toEqual(before);
  });
});

describe('scaleLayer — pattern', () => {
  it('returns the pattern layer unchanged (scaling stays excluded until the interaction sub)', () => {
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
    expect(scaleLayer(pattern, 2, anchor)).toBe(pattern);
  });
});
