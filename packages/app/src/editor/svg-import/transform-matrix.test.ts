import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  IDENTITY,
  isSingular,
  multiply,
  parseTransformList,
  uniformScale,
} from './transform-matrix';

function point(raw: string, x: number, y: number) {
  const m = parseTransformList(raw);
  expect(m).not.toBeNull();
  return applyMatrix(m!, { x, y });
}

describe('parseTransformList -- grammar', () => {
  it('parses a single translate', () => {
    expect(point('translate(10 20)', 1, 2)).toEqual({ x: 11, y: 22 });
  });

  it('defaults translate ty to 0', () => {
    expect(point('translate(10)', 1, 2)).toEqual({ x: 11, y: 2 });
  });

  it('defaults scale sy to sx', () => {
    expect(point('scale(3)', 1, 2)).toEqual({ x: 3, y: 6 });
  });

  it('parses a comma-separated transform list left-to-right', () => {
    // translate first, then scale applies in the translated frame
    expect(point('translate(10,0), scale(2,4)', 1, 2)).toEqual({ x: 12, y: 8 });
  });

  it('parses a whitespace-separated transform list', () => {
    expect(point('translate(10 0) scale(2 4)', 1, 2)).toEqual({ x: 12, y: 8 });
  });

  it('parses matrix()', () => {
    expect(point('matrix(2 0 0 3 5 7)', 1, 1)).toEqual({ x: 7, y: 10 });
  });

  it('rotates about an explicit center', () => {
    const p = point('rotate(90 10 10)', 20, 10);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(20, 9);
  });

  it('parses skewX', () => {
    const p = point('skewX(45)', 0, 2);
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(2, 9);
  });

  it('parses skewY', () => {
    const p = point('skewY(45)', 2, 0);
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(2, 9);
  });

  it('accepts exponent notation', () => {
    expect(point('translate(1e2 -1e1)', 0, 0)).toEqual({ x: 100, y: -10 });
  });

  it('treats an empty attribute as identity', () => {
    expect(parseTransformList('   ')).toEqual(IDENTITY);
  });

  it.each([
    ['unknown function', 'wobble(2)'],
    ['wrong argument count', 'matrix(1 2 3)'],
    ['non-numeric argument', 'translate(10px 4)'],
    ['junk between functions', 'translate(1 2) oops scale(2)'],
    ['trailing junk', 'scale(2) )'],
    ['lowercased skewx', 'skewx(10)'],
  ])('rejects %s', (_label, raw) => {
    expect(parseTransformList(raw)).toBeNull();
  });
});

describe('uniformScale', () => {
  it('accepts identity', () => {
    expect(uniformScale(IDENTITY)).toBe(1);
  });

  it('accepts a uniform scale', () => {
    expect(uniformScale(parseTransformList('scale(4)')!)).toBeCloseTo(4, 9);
  });

  it('accepts rotation combined with uniform scale', () => {
    expect(uniformScale(parseTransformList('rotate(37) scale(2.5)')!)).toBeCloseTo(2.5, 9);
  });

  it('accepts a reflection', () => {
    expect(uniformScale(parseTransformList('scale(-3 3)')!)).toBeCloseTo(3, 9);
  });

  it('rejects a nonuniform scale', () => {
    expect(uniformScale(parseTransformList('scale(2 5)')!)).toBeNull();
  });

  it('rejects a skew', () => {
    expect(uniformScale(parseTransformList('skewX(20)')!)).toBeNull();
  });
});

describe('isSingular', () => {
  it('is false for an invertible matrix', () => {
    expect(isSingular(parseTransformList('scale(2) rotate(10)')!)).toBe(false);
  });

  it('is true for scale(0)', () => {
    expect(isSingular(parseTransformList('scale(0)')!)).toBe(true);
  });

  it('is true for a one-axis collapse', () => {
    expect(isSingular(parseTransformList('scale(1 0)')!)).toBe(true);
  });
});

describe('multiply', () => {
  it('applies the outer matrix after the inner one', () => {
    const composed = multiply(
      parseTransformList('translate(10 0)')!,
      parseTransformList('scale(2)')!,
    );
    expect(applyMatrix(composed, { x: 3, y: 4 })).toEqual({ x: 16, y: 8 });
  });
});
