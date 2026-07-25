// Layer ↔ kernel conversion. Adapted from pgen's test/pathfinder-convert.test.ts,
// minus everything that only existed to verify the bbox-fit + rotation projector
// zpd does not have: geometry here is authored in world mm and comes back in
// world mm, so a "round trip" is a real identity rather than a transform undo.
import { rotatePoint } from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBooleanEngine,
  ringSignedArea,
  type BooleanEngine,
  type KernelRing,
} from '../geometry-kernel';
import {
  bakePathContour,
  bakeShapeLeaf,
  isDegenerateContour,
  leafToKernelInput,
  ringsToSpecs,
  specHoleRings,
  specOuterRing,
} from './convert';
import {
  absArea,
  blobPath,
  compoundRectPath,
  ellipseShape,
  expectAreaClose,
  holeCount,
  pathLeaf,
  rectPath,
  rectPoints,
  rectShape,
  shapeLayerOf,
  specArea,
  specNetArea,
} from './test-fixtures';
import type { ResolvedInputStyle } from './types';

const GOLD: ResolvedInputStyle = { fill: 1, stroke: null, strokeWidth: 0 };

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

// ── bakePathContour: absolute anchors, absolute handles ──────────────────────

describe('bakePathContour', () => {
  it('emits one cubic per edge with degenerate handles for straight edges', () => {
    const ring = bakePathContour(rectPoints(10, 20, 100, 50), true);
    expect(ring).toHaveLength(4);
    for (const segment of ring) {
      expect(segment.c1).toEqual(segment.p0);
      expect(segment.c2).toEqual(segment.p3);
    }
    expect(ring[0]!.p0).toEqual({ x: 10, y: 20 });
    expect(absArea(ring)).toBeCloseTo(5000, 6);
  });

  it('carries hout/hin through as ABSOLUTE control points (no offset arithmetic)', () => {
    const ring = bakePathContour(
      [
        { x: 0, y: 0, hout: { x: 30, y: -10 } },
        { x: 100, y: 0, hin: { x: 70, y: -10 } },
      ],
      true,
    );
    expect(ring[0]!.c1).toEqual({ x: 30, y: -10 });
    expect(ring[0]!.c2).toEqual({ x: 70, y: -10 });
  });

  it('closes an OPEN contour with a straight segment (Shape Modes need a region)', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const open = bakePathContour(points, false);
    const closed = bakePathContour(points, true);
    expect(open).toHaveLength(3);
    expect(closed).toHaveLength(3);
    const last = open[2]!;
    expect(last.c1).toEqual(last.p0);
    expect(last.c2).toEqual(last.p3);
  });

  it('a sub-2-anchor contour has no ring at all', () => {
    expect(bakePathContour([{ x: 5, y: 5 }], false)).toEqual([]);
    expect(bakePathContour([], true)).toEqual([]);
  });

  it('does not alias the source PathPoint objects into kernel points', () => {
    const points = [
      { x: 0, y: 0, hout: { x: 5, y: 5 } },
      { x: 10, y: 0 },
    ];
    const ring = bakePathContour(points, true);
    expect(Object.keys(ring[0]!.p0)).toEqual(['x', 'y']);
  });
});

// ── bakeShapeLeaf ───────────────────────────────────────────────────────────

describe('bakeShapeLeaf', () => {
  it('bakes a rect into 4 straight cubics with the right area', () => {
    const ring = bakeShapeLeaf(shapeLayerOf(rectShape('r', 10, 20, 100, 50, 1)));
    expect(ring).toHaveLength(4);
    expect(absArea(ring)).toBeCloseTo(5000, 6);
  });

  it('normalizes a negative-dimension rect to the region the renderer paints', () => {
    const mirrored = bakeShapeLeaf(shapeLayerOf(rectShape('r', 110, 70, -100, -50, 1)));
    const plain = bakeShapeLeaf(shapeLayerOf(rectShape('r', 10, 20, 100, 50, 1)));
    expect(absArea(mirrored)).toBeCloseTo(absArea(plain), 6);
    const xs = mirrored.map((c) => c.p0.x);
    expect(Math.min(...xs)).toBeCloseTo(10, 6);
  });

  it('bakes rotation into the corners (core rotatePoint, clockwise, y-down)', () => {
    const ring = bakeShapeLeaf(shapeLayerOf(rectShape('r', 0, 0, 100, 40, 1, { rotation: 30 })));
    const center = { x: 50, y: 20 };
    const expected = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 0, y: 40 },
    ].map((corner) => rotatePoint(corner, center, 30));
    ring.forEach((segment, i) => {
      expect(segment.p0.x).toBeCloseTo(expected[i]!.x, 9);
      expect(segment.p0.y).toBeCloseTo(expected[i]!.y, 9);
    });
    // Rotation is rigid: the area is unchanged.
    expect(absArea(ring)).toBeCloseTo(4000, 6);
  });

  it('bakes an ellipse into a 4-segment kappa ring of ~π·rx·ry', () => {
    const ring = bakeShapeLeaf(shapeLayerOf(ellipseShape('e', 0, 0, 200, 120, 1)));
    expect(ring).toHaveLength(4);
    expectAreaClose(absArea(ring), Math.PI * 100 * 60);
  });
});

// ── leafToKernelInput ───────────────────────────────────────────────────────

describe('leafToKernelInput', () => {
  it('a path leaf is ALWAYS evenodd, matching the renderer (even with no holes)', () => {
    expect(leafToKernelInput(rectPath('p', 0, 0, 10, 10, 1)).fillRule).toBe('evenodd');
    expect(
      leafToKernelInput(compoundRectPath('p', 0, 0, 10, 10, 1, [rectPoints(2, 2, 4, 4)])).fillRule,
    ).toBe('evenodd');
  });

  it('a shape leaf is a single nonzero contour', () => {
    const input = leafToKernelInput(rectShape('s', 0, 0, 10, 10, 1));
    expect(input.fillRule).toBe('nonzero');
    expect(input.contours).toHaveLength(1);
  });

  it('keeps every valid hole in source order after the outer contour', () => {
    const leaf = compoundRectPath('p', 0, 0, 200, 200, 1, [
      rectPoints(20, 20, 40, 40),
      rectPoints(120, 120, 40, 40),
    ]);
    const { contours } = leafToKernelInput(leaf);
    expect(contours).toHaveLength(3);
    expect(absArea(contours[0]!)).toBeCloseTo(40000, 6);
    expect(contours[1]![0]!.p0).toEqual({ x: 20, y: 20 });
    expect(contours[2]![0]!.p0).toEqual({ x: 120, y: 120 });
  });

  it('drops empty / single-point / collinear holes instead of making phantom operands', () => {
    const leaf = compoundRectPath('p', 0, 0, 200, 200, 1, [
      [],
      [{ x: 40, y: 40 }],
      [
        { x: 80, y: 80 },
        { x: 120, y: 80 },
        { x: 160, y: 80 },
      ],
    ]);
    expect(leafToKernelInput(leaf).contours).toHaveLength(1);
  });

  it('a degenerate outer contour makes the whole leaf the canonical empty input', () => {
    const flat = pathLeaf(
      'flat',
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      true,
      1,
      { extraSubpaths: [rectPoints(10, 10, 5, 5)] },
    );
    expect(leafToKernelInput(flat).contours).toEqual([]);
  });

  it('isDegenerateContour keeps a self-intersecting contour whose signed lobes cancel', () => {
    const ring = bakePathContour(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      true,
    );
    expect(ringSignedArea(ring)).toBeCloseTo(0, 6);
    expect(isDegenerateContour(ring)).toBe(false);
  });
});

// ── ringsToSpecs ────────────────────────────────────────────────────────────

describe('ringsToSpecs', () => {
  it('containment → one spec whose hole winds OPPOSITE the outer ring', () => {
    const rings = engine
      .arrange([
        leafToKernelInput(rectShape('big', 0, 0, 200, 200, 1)),
        leafToKernelInput(rectShape('small', 50, 50, 100, 100, 2)),
      ])
      .subtract();
    const specs = ringsToSpecs(rings, GOLD, 'Minus Front');

    expect(specs).toHaveLength(1);
    const spec = specs[0]!;
    expect(holeCount(spec)).toBe(1);
    expect(specNetArea(spec)).toBeCloseTo(30000, 0);
    expect(Math.sign(ringSignedArea(specHoleRings(spec)[0]!))).toBe(
      -Math.sign(ringSignedArea(specOuterRing(spec))),
    );
    expect(spec.fill).toBe(1);
    expect(spec.stroke).toBeNull();
    expect(spec.closed).toBe(true);
    expect(spec.name).toBe('Minus Front');
  });

  it('two disjoint components become two specs, each in world mm (no origin shift)', () => {
    const rings = engine
      .arrange([
        leafToKernelInput(rectShape('a', 0, 0, 50, 50, 1)),
        leafToKernelInput(rectShape('b', 200, 200, 50, 50, 1)),
      ])
      .unite();
    const specs = ringsToSpecs(rings, GOLD, 'Unite');

    expect(specs).toHaveLength(2);
    const origins = specs
      .map((spec) => Math.min(...spec.points.map((p) => p.x)))
      .sort((a, b) => a - b);
    expect(origins[0]).toBeCloseTo(0, 6);
    expect(origins[1]).toBeCloseTo(200, 6);
    for (const spec of specs) expect(holeCount(spec)).toBe(0);
  });

  it('emits nothing for no rings', () => {
    expect(ringsToSpecs([], GOLD, 'Unite')).toEqual([]);
  });
});

// ── Thin-wall containment (regression) ─────────────────────────────────────
//
// `ringInteriorPoint` steps inward from a ring's topmost vertex by a fraction
// of that ring's OWN bbox diagonal and only checks the result against that same
// ring — so on a thin frame the step clears the wall and lands inside the hole.
// Classifying containment without an area guard then made the outer and inner
// rings each other's container, gave both odd depth, and silently dropped the
// whole result. A border trace is exactly this shape, so it is not exotic.

describe('thin-walled results', () => {
  it('a 1mm frame survives Minus Front instead of vanishing as a no-op', () => {
    const rings = engine
      .arrange([
        leafToKernelInput(rectShape('outer', 0, 0, 100, 100, 1)),
        leafToKernelInput(rectShape('inner', 1, 1, 98, 98, 2)),
      ])
      .subtract();
    const specs = ringsToSpecs(rings, GOLD, 'Minus Front');

    expect(specs).toHaveLength(1);
    expect(holeCount(specs[0]!)).toBe(1);
    expectAreaClose(specNetArea(specs[0]!), 100 * 100 - 98 * 98);
    expect(Math.sign(ringSignedArea(specHoleRings(specs[0]!)[0]!))).toBe(
      -Math.sign(ringSignedArea(specOuterRing(specs[0]!))),
    );
  });

  it('still splits an island out of a thin frame’s hole (nesting depth intact)', () => {
    // A thin frame plus a disc sitting inside its hole: the frame is one spec
    // with one hole, the disc is its own top-level spec — not a third level.
    const rings = engine
      .arrange([
        leafToKernelInput(rectShape('outer', 0, 0, 100, 100, 1)),
        leafToKernelInput(rectShape('inner', 1, 1, 98, 98, 2)),
      ])
      .subtract()
      .concat(engine.arrange([leafToKernelInput(rectShape('island', 40, 40, 20, 20, 1))]).unite());
    const specs = ringsToSpecs(rings, GOLD, 'Exclude');

    expect(specs).toHaveLength(2);
    const frame = specs.find((spec) => holeCount(spec) === 1);
    const island = specs.find((spec) => holeCount(spec) === 0);
    expect(frame).toBeDefined();
    expect(island).toBeDefined();
    expectAreaClose(specNetArea(frame!), 100 * 100 - 98 * 98);
    expectAreaClose(specArea(island!), 400);
  });
});

// ── Compound round trip: spec → kernel → spec ───────────────────────────────

describe('compound round-trip (points + extraSubpaths → engine → back)', () => {
  const donut = () => compoundRectPath('donut', 0, 0, 200, 200, 1, [rectPoints(50, 50, 100, 100)]);

  it('preserves the hole under evenodd, and is a fixed point of a second pass', () => {
    const first = ringsToSpecs(engine.arrange([leafToKernelInput(donut())]).unite(), GOLD, 'Unite');
    expect(first).toHaveLength(1);
    expect(holeCount(first[0]!)).toBe(1);
    expect(specNetArea(first[0]!)).toBeCloseTo(30000, 0);

    // Feed the result back in as a real compound leaf: same geometry out.
    const roundTripped = pathLeaf('round', first[0]!.points, true, 1, {
      extraSubpaths: first[0]!.extraSubpaths,
    });
    const second = ringsToSpecs(
      engine.arrange([leafToKernelInput(roundTripped)]).unite(),
      GOLD,
      'Unite',
    );
    expect(second).toHaveLength(1);
    expect(holeCount(second[0]!)).toBe(1);
    expect(specNetArea(second[0]!)).toBeCloseTo(30000, 0);
    expect(absArea(specOuterRing(second[0]!))).toBeCloseTo(40000, 0);
  });

  it('specOuterRing / specHoleRings re-derive the spec exactly (bakePathContour is the inverse)', () => {
    const spec = ringsToSpecs(
      engine.arrange([leafToKernelInput(donut())]).unite(),
      GOLD,
      'Unite',
    )[0]!;
    const rebuilt = bakePathContour(spec.points, spec.closed);
    expect(rebuilt).toEqual(specOuterRing(spec));
    expect(specHoleRings(spec)).toHaveLength(1);
  });

  it('keeps a CURVED hole\u2019s handles through the round trip', () => {
    const disc = ellipseShape('disc', 60, 60, 80, 80, 2);
    const rings = engine
      .arrange([leafToKernelInput(rectShape('plate', 0, 0, 200, 200, 1)), leafToKernelInput(disc)])
      .subtract();
    const spec = ringsToSpecs(rings, GOLD, 'Minus Front')[0]!;

    const hole = specHoleRings(spec)[0]!;
    expectAreaClose(absArea(hole), Math.PI * 40 * 40);
    // Curvature survived: at least one hole anchor carries a real handle.
    expect(spec.extraSubpaths![0]!.some((p) => p.hin || p.hout)).toBe(true);
  });
});

// ── Area invariant across curve-native inputs ───────────────────────────────

describe('area invariant', () => {
  const pairs: [KernelRing, KernelRing][] = [
    [
      bakeShapeLeaf(shapeLayerOf(rectShape('a', 0, 0, 100, 100, 1))),
      bakeShapeLeaf(shapeLayerOf(rectShape('b', 40, 40, 100, 100, 1))),
    ],
    [
      bakeShapeLeaf(shapeLayerOf(ellipseShape('a', 0, 0, 200, 120, 1))),
      bakeShapeLeaf(shapeLayerOf(ellipseShape('b', 80, 40, 200, 120, 1))),
    ],
    [
      bakeShapeLeaf(shapeLayerOf(ellipseShape('a', 0, 0, 150, 150, 1))),
      bakeShapeLeaf(shapeLayerOf(rectShape('b', 60, 40, 150, 90, 1))),
    ],
  ];

  it.each(pairs.map((_, i) => i))('area(A∪B) + area(A∩B) ≈ area(A) + area(B) [%i]', (index) => {
    const [a, b] = pairs[index]!;
    const inputs = [
      { contours: [a], fillRule: 'nonzero' as const },
      { contours: [b], fillRule: 'nonzero' as const },
    ];
    const union = engine.arrange(inputs).unite();
    const inter = engine.arrange(inputs).intersect();
    const lhs =
      union.reduce((s, r) => s + absArea(r), 0) + inter.reduce((s, r) => s + absArea(r), 0);
    const rhs = absArea(a) + absArea(b);
    expect(Math.abs(lhs - rhs)).toBeLessThan(rhs * 3e-3 + 0.5);
  });

  it('holds for a curve-native bezier blob against a rect', () => {
    const blob = leafToKernelInput(blobPath('blob', 100, 100, 60, 1));
    const rect = leafToKernelInput(rectShape('r', 80, 80, 120, 120, 1));
    const areaBlob = blob.contours.reduce((s, r) => s + absArea(r), 0);
    const areaRect = rect.contours.reduce((s, r) => s + absArea(r), 0);
    const union = engine.arrange([blob, rect]).unite();
    const inter = engine.arrange([blob, rect]).intersect();
    const lhs =
      union.reduce((s, r) => s + absArea(r), 0) + inter.reduce((s, r) => s + absArea(r), 0);
    expect(Math.abs(lhs - (areaBlob + areaRect))).toBeLessThan((areaBlob + areaRect) * 3e-3 + 0.5);
  });
});
