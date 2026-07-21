// Affine transform support for native SVG vector import (#139). SVG
// `transform` lists compose into a single 2x3 affine, which the extractor
// bakes straight into the geometry: zpd's PathPoint stores bezier handles as
// absolute coordinates, so there is nowhere to carry a transform alongside
// the points -- anchors and handles both go through the matrix.
import type { Pt } from '@zpd/core';

// Column-vector convention, matching SVG's matrix(a b c d e f):
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// `outer` is applied after `inner` -- multiply(parentMatrix, ownMatrix) is
// how a transform on a child composes under its ancestors.
export function multiply(outer: Matrix, inner: Matrix): Matrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function determinant(m: Matrix): number {
  return m.a * m.d - m.b * m.c;
}

// A matrix collapsing geometry onto a line/point (scale(0), scale(1,0), ...)
// -- the shape has no renderable area or length left, so the extractor drops
// it rather than emitting degenerate points.
export function isSingular(m: Matrix): boolean {
  return Math.abs(determinant(m)) < 1e-12;
}

// Uniform scale factor when the linear part is a similarity (uniform scale x
// rotation, reflection included), null when it is nonuniform or skewed.
// zpd carries ONE scalar stroke width, so only a similarity can be baked into
// a stroked shape; the caller turns null into a fatal `nonuniform-stroke`.
export function uniformScale(m: Matrix): number | null {
  const colX = Math.hypot(m.a, m.b);
  const colY = Math.hypot(m.c, m.d);
  const scale = (colX + colY) / 2;
  const tolerance = 1e-9 * Math.max(1, scale);
  if (Math.abs(colX - colY) > tolerance) return null;
  // The columns of a similarity are orthogonal; a nonzero dot product is
  // skew. The dot product scales with scale^2, so the tolerance does too.
  if (Math.abs(m.a * m.c + m.b * m.d) > tolerance * Math.max(1, scale)) return null;
  return scale;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
// Function name + parenthesized argument list; nested parens are not part of
// the transform grammar, so [^()]* is exact rather than lenient.
const TRANSFORM_FN = /([a-zA-Z]+)\s*\(([^()]*)\)/g;
const SEPARATOR_ONLY = /^[\s,]*$/;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function parseArgs(raw: string): number[] | null {
  const tokens = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const values: number[] = [];
  for (const token of tokens) {
    if (!NUMBER.test(token)) return null;
    const value = Number(token);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return values;
}

// SVG transform function names are case-sensitive (skewX, not skewx).
function transformFunction(name: string, args: number[]): Matrix | null {
  switch (name) {
    case 'matrix':
      if (args.length !== 6) return null;
      return { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
    case 'translate':
      if (args.length !== 1 && args.length !== 2) return null;
      return { ...IDENTITY, e: args[0], f: args[1] ?? 0 };
    case 'scale': {
      if (args.length !== 1 && args.length !== 2) return null;
      const sy = args[1] ?? args[0];
      return { a: args[0], b: 0, c: 0, d: sy, e: 0, f: 0 };
    }
    case 'rotate': {
      if (args.length !== 1 && args.length !== 3) return null;
      const angle = toRadians(args[0]);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (args.length === 1) return rotation;
      const [, cx, cy] = args;
      return multiply(multiply({ ...IDENTITY, e: cx, f: cy }, rotation), {
        ...IDENTITY,
        e: -cx,
        f: -cy,
      });
    }
    case 'skewX':
      if (args.length !== 1) return null;
      return { ...IDENTITY, c: Math.tan(toRadians(args[0])) };
    case 'skewY':
      if (args.length !== 1) return null;
      return { ...IDENTITY, b: Math.tan(toRadians(args[0])) };
    default:
      return null;
  }
}

// Parses a whole `transform` attribute into one composed matrix. Returns null
// for anything malformed -- an unknown function, a bad argument count, a
// non-finite number, or junk between/after the functions. Nothing is silently
// dropped: a transform the importer cannot reproduce must not render as if it
// were absent.
export function parseTransformList(raw: string): Matrix | null {
  const fnPattern = new RegExp(TRANSFORM_FN.source, 'g');
  let result = IDENTITY;
  let consumedTo = 0;
  let match: RegExpExecArray | null;
  while ((match = fnPattern.exec(raw)) !== null) {
    if (!SEPARATOR_ONLY.test(raw.slice(consumedTo, match.index))) return null;
    consumedTo = match.index + match[0].length;
    const args = parseArgs(match[2]);
    if (!args) return null;
    const fn = transformFunction(match[1], args);
    if (!fn) return null;
    result = multiply(result, fn);
  }
  if (!SEPARATOR_ONLY.test(raw.slice(consumedTo))) return null;
  return result;
}
