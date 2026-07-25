import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BooleanEngine,
  KernelCubic,
  KernelInput,
  KernelPoint,
  KernelRing,
} from '../geometry-kernel';
import {
  createBooleanEngine,
  flattenRing,
  ringSignedArea,
  sampleCubicAt,
} from '../geometry-kernel';
import { ellipseToRing } from './arc';
import { degenerateCubic } from './primitives';
import {
  CANVAS_DEFAULT_JOIN_STYLE,
  maxTurnForHalfWidth,
  strokeSubpathsToInputs,
  type StrokeStyle,
} from './stroker';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const TOL = DEFAULT_IR_TOLERANCE;

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

function polyline(...points: KernelPoint[]): KernelCubic[] {
  const out: KernelCubic[] = [];
  for (let i = 1; i < points.length; i++) out.push(degenerateCubic(points[i - 1], points[i]));
  return out;
}

function ringOf(...points: KernelPoint[]): KernelCubic[] {
  return polyline(...points, points[0]);
}

function isLeft(a: KernelPoint, b: KernelPoint, p: KernelPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

function windingNumber(pt: KernelPoint, poly: readonly KernelPoint[]): number {
  let w = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    if (a.y <= pt.y) {
      if (b.y > pt.y && isLeft(a, b, pt) > 0) w++;
    } else if (b.y <= pt.y && isLeft(a, b, pt) < 0) w--;
  }
  return w;
}

function unionOf(inputs: readonly KernelInput[]): KernelRing[] {
  if (inputs.length === 0) return [];
  return engine.arrange(inputs.map((i) => ({ ...i }))).unite();
}

/** Membership in the unioned region the stroker's inputs describe. */
function filled(inputs: readonly KernelInput[], pt: KernelPoint): boolean {
  let w = 0;
  for (const ring of unionOf(inputs)) w += windingNumber(pt, flattenRing(ring, 64));
  return w !== 0;
}

function unionArea(inputs: readonly KernelInput[]): number {
  return Math.abs(unionOf(inputs).reduce((sum, r) => sum + ringSignedArea(r), 0));
}

function style(over: Partial<StrokeStyle> = {}): StrokeStyle {
  return { width: 2, ...CANVAS_DEFAULT_JOIN_STYLE, ...over };
}

function stroke(
  subpaths: readonly { contour: KernelCubic[]; closed: boolean }[],
  s: StrokeStyle,
  t = TOL,
): KernelInput[] {
  return strokeSubpathsToInputs(subpaths, s, t, engine);
}

const SEGMENT = [{ contour: polyline({ x: 0, y: 0 }, { x: 10, y: 0 }), closed: false }];

describe('stroker — caps (Decision 5)', () => {
  it('butt stops flat at the endpoint', () => {
    const rings = stroke(SEGMENT, style({ cap: 'butt' }), TOL);
    expect(filled(rings, { x: 0.5, y: 0 })).toBe(true);
    expect(filled(rings, { x: 9.5, y: 0.9 })).toBe(true);
    expect(filled(rings, { x: -0.5, y: 0 })).toBe(false);
    expect(filled(rings, { x: 10.5, y: 0 })).toBe(false);
    expect(unionArea(rings)).toBeCloseTo(10 * 2, 6);
  });

  it('round adds a half-disk of the stroke radius at each end', () => {
    const rings = stroke(SEGMENT, style({ cap: 'round' }), TOL);
    expect(filled(rings, { x: -0.5, y: 0 })).toBe(true);
    expect(filled(rings, { x: -1.5, y: 0 })).toBe(false);
    // A round cap corner is outside the radius; a square cap corner is inside.
    expect(filled(rings, { x: -0.9, y: 0.9 })).toBe(false);
    expect(unionArea(rings)).toBeCloseTo(10 * 2 + Math.PI, 4);
  });

  it('square extends by half the width and keeps its corners', () => {
    const rings = stroke(SEGMENT, style({ cap: 'square' }), TOL);
    expect(filled(rings, { x: -0.9, y: 0.9 })).toBe(true);
    expect(filled(rings, { x: -1.1, y: 0 })).toBe(false);
    expect(unionArea(rings)).toBeCloseTo(12 * 2, 6);
  });
});

describe('stroker — joins (Decision 5)', () => {
  // Right-angle corner: east then south, half-width 1. The miter tip is at
  // (11, -1); a round join stops at radius 1 from (10, 0); a bevel cuts the
  // chord (10,-1)→(11,0).
  const ELL = [
    { contour: polyline({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }), closed: false },
  ];
  const MITER_TIP = { x: 10.9, y: -0.9 };

  it('miter reaches the tip', () => {
    const rings = stroke(ELL, style({ join: 'miter' }), TOL);
    expect(filled(rings, MITER_TIP)).toBe(true);
    expect(filled(rings, { x: 11.1, y: -1.1 })).toBe(false);
    // Two 2×10 bars overlapping in a 1×1 corner, plus the 1×1 mitre quad.
    expect(unionArea(rings)).toBeCloseTo(20 + 20 - 1 + 1, 6);
  });

  it('round stops at the stroke radius', () => {
    const rings = stroke(ELL, style({ join: 'round' }), TOL);
    expect(filled(rings, MITER_TIP)).toBe(false);
    expect(filled(rings, { x: 10.6, y: -0.6 })).toBe(true);
  });

  it('bevel cuts the corner off', () => {
    const rings = stroke(ELL, style({ join: 'bevel' }), TOL);
    expect(filled(rings, MITER_TIP)).toBe(false);
    expect(filled(rings, { x: 10.4, y: -0.4 })).toBe(true);
    expect(unionArea(rings)).toBeCloseTo(20 + 20 - 1 + 0.5, 6);
  });

  it('keeps the inner corner filled — a join must never slice stroke area away', () => {
    for (const join of ['miter', 'round', 'bevel'] as const) {
      const rings = stroke(ELL, style({ join }), TOL);
      expect(filled(rings, { x: 9.5, y: 0.5 })).toBe(true);
      expect(filled(rings, { x: 9.2, y: 0.8 })).toBe(true);
    }
  });

  it('clamps at the miter limit and falls back to bevel, exactly as Canvas does', () => {
    // A 6° included angle: the miter ratio is 1/sin(3°) ≈ 19.1, well over 10.
    const included = (6 * Math.PI) / 180;
    const spike = [
      {
        contour: polyline(
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20 - 20 * Math.cos(included), y: 20 * Math.sin(included) },
        ),
        closed: false,
      },
    ];
    const clamped = stroke(spike, style({ join: 'miter', miterLimit: 10 }), TOL);
    const allowed = stroke(spike, style({ join: 'miter', miterLimit: 50 }), TOL);
    const bevelled = stroke(spike, style({ join: 'bevel' }), TOL);

    expect(unionArea(clamped)).toBeCloseTo(unionArea(bevelled), 6);
    expect(unionArea(allowed)).toBeGreaterThan(unionArea(clamped) + 1);

    // The spike tip reaches h / cos(turn/2) past the vertex along the bisector.
    const reach = 1 / Math.sin(included / 2);
    const tip = { x: 20 + reach * Math.cos(included / 2), y: -reach * Math.sin(included / 2) };
    const nearTip = { x: 20 + (tip.x - 20) * 0.9, y: tip.y * 0.9 };
    expect(filled(allowed, nearTip)).toBe(true);
    expect(filled(clamped, nearTip)).toBe(false);
  });
});

describe('stroker — subpath shapes', () => {
  const SQUARE_PATH = ringOf({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 });

  it('turns a closed subpath into an annulus, not a filled disk', () => {
    const rings = stroke([{ contour: SQUARE_PATH, closed: true }], style({ join: 'miter' }), TOL);
    expect(filled(rings, { x: 5, y: 0 })).toBe(true);
    expect(filled(rings, { x: 5, y: 5 })).toBe(false);
    expect(filled(rings, { x: 5, y: 1.5 })).toBe(false);
    expect(filled(rings, { x: -1.5, y: -1.5 })).toBe(false);
    // Mitred outer square 12×12 minus inner 8×8.
    expect(unionArea(rings)).toBeCloseTo(144 - 64, 6);
  });

  it('fills the middle when the stroke is wider than the shape it follows', () => {
    // The case a traced inner offset gets catastrophically wrong: the inner
    // ring turns inside out and subtracts a hole from solid metal.
    const small = [
      {
        contour: ringOf({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }),
        closed: true,
      },
    ];
    const rings = stroke(small, style({ width: 6 }), TOL);
    expect(filled(rings, { x: 1, y: 1 })).toBe(true);
    expect(unionArea(rings)).toBeCloseTo(8 * 8, 6);
  });

  it('paints a zero-length subpath as a dot / square / nothing, per cap', () => {
    const dot = [{ contour: [degenerateCubic({ x: 4, y: 4 }, { x: 4, y: 4 })], closed: false }];
    expect(stroke(dot, style({ cap: 'butt' }), TOL)).toEqual([]);

    const round = stroke(dot, style({ cap: 'round' }), TOL);
    expect(unionArea(round)).toBeCloseTo(Math.PI, 4);
    expect(filled(round, { x: 4.9, y: 4.9 })).toBe(false);

    const square = stroke(dot, style({ cap: 'square' }), TOL);
    expect(unionArea(square)).toBeCloseTo(4, 6);
    expect(filled(square, { x: 4.9, y: 4.9 })).toBe(true);
  });

  it('contributes no geometry for a non-positive or non-finite width', () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stroke(SEGMENT, style({ width }), TOL)).toEqual([]);
    }
  });
});

describe('stroker — curved centrelines', () => {
  /** A real curved centreline, so the flattener has something to subdivide. */
  const circleCentreline = (r: number): KernelCubic[] => ellipseToRing(0, 0, r, r, TOL.arcMm);

  it('offsets a circular centreline to an annulus of the right area', () => {
    const r = 20;
    const h = 1;
    const rings = stroke(
      [{ contour: circleCentreline(r), closed: true }],
      style({ width: h * 2 }),
      TOL,
    );
    expect(filled(rings, { x: r, y: 0 })).toBe(true);
    expect(filled(rings, { x: 0, y: 0 })).toBe(false);
    expect(filled(rings, { x: r + 1.5, y: 0 })).toBe(false);
    expect(unionArea(rings)).toBeCloseTo(Math.PI * ((r + h) ** 2 - (r - h) ** 2), 1);
  });

  it('bounds the turn per flattened segment so offsetting cannot magnify chord error', () => {
    const h = 1;
    const turn = maxTurnForHalfWidth(h, TOL.flattenMm);
    expect(h * (1 - Math.cos(turn / 2))).toBeCloseTo(TOL.flattenMm, 12);
    // A thread-thin stroke needs no angular constraint at all.
    expect(maxTurnForHalfWidth(1e-4, TOL.flattenMm)).toBe(Infinity);
  });

  it('keeps a stroke far wider than the local radius within 2.5 µm of the true offset', () => {
    // Half-width 4× the radius of curvature. A plain chord-tolerance flattener
    // gets the outer boundary wrong here by (1 + h/R) ≈ 5×, which is what
    // maxTurnForHalfWidth exists to prevent.
    const r = 0.5;
    const h = 2;
    const rings = stroke(
      [{ contour: circleCentreline(r), closed: true }],
      style({ width: h * 2, join: 'miter' }),
      TOL,
    );
    const outline = unionOf(rings);
    let worst = 0;
    for (const ring of outline) {
      for (const cubic of ring) {
        for (let i = 0; i <= 32; i++) {
          const p = sampleCubicAt(cubic, i / 32);
          worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - (r + h)));
        }
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(TOL.flattenMm);
  });
});
