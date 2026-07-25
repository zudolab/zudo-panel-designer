// Outline (edge extraction). Adapted from pgen's test/pathfinder-outline.test.ts.
//
// Edge granularity contract (see outline-op.ts): the atomic edge is one input
// SEGMENT (anchor to anchor), further subdivided at every intersection —
// cross-input, same-input, and a single cubic's own loop. The exact counts below
// follow from that rule. Coordinates are world mm and come back unchanged, so
// crossings can be asserted exactly.
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine, type KernelCubic } from '../geometry-kernel';
import { OUTLINE_EDGE_STROKE_WIDTH_MM, outlineOp } from './outline-op';
import { ellipseShape, pathLeaf, rectPath, rectPoints } from './test-fixtures';
import type { KernelPathSpec } from '../geometry-kernel';
import type { PathPoint } from '@zpd/core';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

/** World-mm anchors of an emitted edge — no transform to add back. */
const specEndpoints = (spec: KernelPathSpec) => spec.points.map((p) => ({ x: p.x, y: p.y }));

/** The world-mm cubic one two-anchor edge represents. */
function specCubic(spec: KernelPathSpec): KernelCubic {
  const [start, end] = spec.points;
  if (!start || !end) throw new Error('an Outline edge must have exactly two anchors');
  const p0 = { x: start.x, y: start.y };
  const p3 = { x: end.x, y: end.y };
  return { p0, c1: start.hout ?? p0, c2: end.hin ?? p3, p3 };
}

const isCurved = (spec: KernelPathSpec) => spec.points.some((p) => p.hin || p.hout);

function expectValidEdge(spec: KernelPathSpec): void {
  expect(spec.closed).toBe(false);
  expect(spec.fill).toBeNull();
  expect(spec.stroke).not.toBeNull();
  expect(spec.strokeWidth).toBe(OUTLINE_EDGE_STROKE_WIDTH_MM);
  expect(spec.extraSubpaths).toBeUndefined();
  expect(spec.points).toHaveLength(2);
}

function expectCubicNear(actual: KernelCubic, expected: KernelCubic): void {
  for (const key of ['p0', 'c1', 'c2', 'p3'] as const) {
    expect(
      Math.hypot(actual[key].x - expected[key].x, actual[key].y - expected[key].y),
    ).toBeLessThan(1e-6);
  }
}

const endpointCount = (specs: KernelPathSpec[], x: number, y: number): number =>
  specs.filter((spec) =>
    specEndpoints(spec).some((point) => Math.hypot(point.x - x, point.y - y) < 1e-6),
  ).length;

// ── Two overlapping rectangles ──────────────────────────────────────────────

describe('outlineOp — two overlapping rectangles', () => {
  it('splits each boundary at the 2 crossings; edges stroke with the source FILL', async () => {
    // A = (0,0,100,100) fill 0; B = (50,50,100,100) fill 2. They cross at
    // (100,50) and (50,100). Each rect: 4 sides, the 2 crossed sides split → 6.
    const a = rectPath('A', 0, 0, 100, 100, 0);
    const b = rectPath('B', 50, 50, 100, 100, 2);
    const { specs, target } = await outlineOp([a, b], engine);

    expect(specs).toHaveLength(12);
    for (const spec of specs) expectValidEdge(spec);
    expect(specs.filter((s) => s.stroke === 0)).toHaveLength(6);
    expect(specs.filter((s) => s.stroke === 2)).toHaveLength(6);
    // Each crossing cuts one side of A and one of B → 2 split sides → 4 ends.
    expect(endpointCount(specs, 100, 50)).toBe(4);
    expect(endpointCount(specs, 50, 100)).toBe(4);
    expect(target).toEqual({ role: 'copper', frontmostLeafId: 'B' });
  });
});

// ── Self-intersecting inputs ────────────────────────────────────────────────

describe('outlineOp — single self-intersecting polyline (bowtie)', () => {
  it('splits the two crossing segments at their interior crossing', async () => {
    // (0,0)→(100,0)→(0,100)→(100,100)→close. The two diagonals cross at (50,50):
    // 4 sides, the 2 diagonals split → 6 edges.
    const bowtie = pathLeaf(
      'BOW',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      true,
      1,
    );
    const { specs } = await outlineOp([bowtie], engine);

    expect(specs).toHaveLength(6);
    for (const spec of specs) {
      expectValidEdge(spec);
      expect(spec.stroke).toBe(1);
    }
    expect(endpointCount(specs, 50, 50)).toBe(4);
  });
});

describe('outlineOp — single self-intersecting cubic (loop)', () => {
  it('splits the looping cubic at both self-intersection params (3 pieces)', async () => {
    const loop = pathLeaf(
      'LOOP',
      [
        { x: 0, y: 0, hout: { x: 150, y: 100 } },
        { x: 100, y: 0, hin: { x: -50, y: 100 } },
      ],
      false,
      2,
    );
    const { specs } = await outlineOp([loop], engine);

    expect(specs).toHaveLength(3);
    for (const spec of specs) {
      expectValidEdge(spec);
      expect(spec.stroke).toBe(2);
    }
    // Curve preserved — at least one piece keeps its handles (no flattening).
    expect(specs.some(isCurved)).toBe(true);
  });
});

// ── Open vs closed ──────────────────────────────────────────────────────────

describe('outlineOp — open vs closed input', () => {
  const points: PathPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('an OPEN 3-anchor path contributes 2 edges (no invented closing edge)', async () => {
    const { specs } = await outlineOp([pathLeaf('OPEN', points, false, 1)], engine);
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      expectValidEdge(spec);
      expect(spec.stroke).toBe(1);
    }
  });

  it('the SAME points CLOSED contribute 3 edges (the closing side is drawn)', async () => {
    const { specs } = await outlineOp([pathLeaf('CLOSED', points, true, 1)], engine);
    expect(specs).toHaveLength(3);
    for (const spec of specs) expectValidEdge(spec);
  });
});

// ── Compound paths ──────────────────────────────────────────────────────────

describe('outlineOp — compound paths', () => {
  it('emits outer then every inner contour in source order, all closed', async () => {
    const outer = rectPoints(0, 0, 200, 200);
    const innerA = rectPoints(25, 25, 50, 50);
    const innerB = rectPoints(125, 125, 50, 50);

    const oneRing = await outlineOp([pathLeaf('COMPOUND', outer, true, 1)], engine);
    const { specs } = await outlineOp(
      [pathLeaf('COMPOUND', outer, true, 1, { extraSubpaths: [innerA, innerB] })],
      engine,
    );

    // Three contours × four straight segments; every contour keeps its closing
    // segment, including both inner ones (which are always closed).
    expect(specs).toHaveLength(12);
    for (const spec of specs) {
      expectValidEdge(spec);
      expect(spec.stroke).toBe(1);
      expect(spec.name).toBe('COMPOUND');
    }
    // The one-ring behaviour stays first, byte for byte.
    expect(specs.slice(0, 4)).toEqual(oneRing.specs);
    expect(specs.map(specEndpoints)).toEqual(
      [outer, innerA, innerB].flatMap((ring) =>
        ring.map((p, i) => [
          { x: p.x, y: p.y },
          { x: ring[(i + 1) % ring.length]!.x, y: ring[(i + 1) % ring.length]!.y },
        ]),
      ),
    );
  });

  it('keeps a compound outer path OPEN while always closing its inner contour', async () => {
    const openOuter: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const inner = rectPoints(50, 25, 25, 25);
    const { specs } = await outlineOp(
      [pathLeaf('OPEN-COMPOUND', openOuter, false, 1, { extraSubpaths: [inner] })],
      engine,
    );

    // Open outer: 2 drawn segments, no phantom (100,100)→(0,0) close.
    // Inner: all 4 segments, including its close.
    expect(specs).toHaveLength(6);
    expect(specs.map(specEndpoints)).toEqual([
      [openOuter[0], openOuter[1]],
      [openOuter[1], openOuter[2]],
      ...inner.map((p, i) => [
        { x: p.x, y: p.y },
        { x: inner[(i + 1) % inner.length]!.x, y: inner[(i + 1) % inner.length]!.y },
      ]),
    ]);
    for (const spec of specs) expectValidEdge(spec);
  });

  it('splits crossings between the outer and an inner boundary', async () => {
    const outer: PathPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const crossingInner: PathPoint[] = [
      { x: 25, y: -25 },
      { x: 75, y: -25 },
      { x: 75, y: 25 },
      { x: 25, y: 25 },
    ];
    const { specs } = await outlineOp(
      [pathLeaf('CROSSING', outer, true, 2, { extraSubpaths: [crossingInner] })],
      engine,
    );

    // The two authored outer top segments and the two inner verticals each take
    // one cut: outer 5 + 2, inner 4 + 2.
    expect(specs).toHaveLength(13);
    for (const spec of specs) expectValidEdge(spec);
    expect(endpointCount(specs, 25, 0)).toBe(4);
    expect(endpointCount(specs, 75, 0)).toBe(4);
  });

  it('splits non-midpoint straight crossings in cubic parameter space', async () => {
    const outer = rectPoints(0, 0, 100, 100);
    const crossingInner: PathPoint[] = [
      { x: 25, y: -20 },
      { x: 75, y: -20 },
      { x: 75, y: 80 },
      { x: 25, y: 80 },
    ];
    const { specs } = await outlineOp(
      [pathLeaf('ASYMMETRIC', outer, true, 2, { extraSubpaths: [crossingInner] })],
      engine,
    );

    // The outer top edge crosses at 25% and 75% of its chord; each inner
    // vertical at 20%. Degenerate straight cubics have non-linear Bernstein
    // parameters, so the kernel must normalize path-bool's chord fractions
    // before Outline samples and splits the authored cubics.
    expect(specs).toHaveLength(12);
    for (const spec of specs) expectValidEdge(spec);
    expect(endpointCount(specs, 25, 0)).toBe(4);
    expect(endpointCount(specs, 75, 0)).toBe(4);
  });
});

describe('outlineOp — curved inner boundary intersections', () => {
  it('splits inner cubics by exact de Casteljau subdivision', async () => {
    const outer = rectPoints(0, 0, 200, 200);
    // Closed two-cubic lens. A vertical blade crosses each cubic at t = 0.5.
    const innerLens: PathPoint[] = [
      { x: 50, y: 100, hin: { x: 50, y: 140 }, hout: { x: 50, y: 60 } },
      { x: 150, y: 100, hin: { x: 150, y: 60 }, hout: { x: 150, y: 140 } },
    ];
    const upperBlade = pathLeaf(
      'BLADE-UPPER',
      [
        { x: 100, y: 40 },
        { x: 100, y: 100 },
        { x: 110, y: 100 },
      ],
      false,
      2,
    );
    const lowerBlade = pathLeaf(
      'BLADE-LOWER',
      [
        { x: 100, y: 100 },
        { x: 100, y: 160 },
        { x: 110, y: 160 },
      ],
      false,
      2,
    );
    const compound = pathLeaf('CURVED', outer, true, 1, { extraSubpaths: [innerLens] });

    const { specs } = await outlineOp([compound, upperBlade, lowerBlade], engine);

    // outer 4 + inner (2 cubics, one cut each → 4) + two blades (2 segments,
    // one cut each → 3 apiece).
    expect(specs).toHaveLength(14);
    for (const spec of specs) expectValidEdge(spec);
    expect(specs.slice(0, 8).every((spec) => spec.name === 'CURVED')).toBe(true);
    expect(specs.slice(0, 8).every((spec) => spec.stroke === 1)).toBe(true);
    expect(specs.slice(8, 11).every((spec) => spec.name === 'BLADE-UPPER')).toBe(true);
    expect(specs.slice(11).every((spec) => spec.name === 'BLADE-LOWER')).toBe(true);
    expect(specs.slice(8).every((spec) => spec.stroke === 2)).toBe(true);

    const expectedInnerPieces: KernelCubic[] = [
      { p0: { x: 50, y: 100 }, c1: { x: 50, y: 80 }, c2: { x: 75, y: 70 }, p3: { x: 100, y: 70 } },
      {
        p0: { x: 100, y: 70 },
        c1: { x: 125, y: 70 },
        c2: { x: 150, y: 80 },
        p3: { x: 150, y: 100 },
      },
      {
        p0: { x: 150, y: 100 },
        c1: { x: 150, y: 120 },
        c2: { x: 125, y: 130 },
        p3: { x: 100, y: 130 },
      },
      {
        p0: { x: 100, y: 130 },
        c1: { x: 75, y: 130 },
        c2: { x: 50, y: 120 },
        p3: { x: 50, y: 100 },
      },
    ];
    specs.slice(4, 8).forEach((spec, index) => {
      expect(isCurved(spec)).toBe(true);
      expectCubicNear(specCubic(spec), expectedInnerPieces[index]!);
    });
    expect(endpointCount(specs, 100, 70)).toBe(4);
    expect(endpointCount(specs, 100, 130)).toBe(4);
  });
});

// ── Curved inputs ───────────────────────────────────────────────────────────

describe('outlineOp — two overlapping ellipses', () => {
  it('produces curve-preserving edges split at the crossings (no flattening)', async () => {
    // Two r=50 circles, centres (50,50) and (100,50) → 2 crossings. Each circle
    // is 4 kappa arcs; the crossings land on 2 arcs each → 4 + 2 = 6 per circle.
    const a = ellipseShape('EA', 0, 0, 100, 100, 0);
    const b = ellipseShape('EB', 50, 0, 100, 100, 2);
    const { specs } = await outlineOp([a, b], engine);

    expect(specs).toHaveLength(12);
    for (const spec of specs) expectValidEdge(spec);
    expect(specs.filter((s) => s.stroke === 0)).toHaveLength(6);
    expect(specs.filter((s) => s.stroke === 2)).toHaveLength(6);
    // A flattened polyline would produce all-straight, handle-less edges.
    expect(specs.filter(isCurved).length).toBeGreaterThanOrEqual(8);
  });
});

// ── Stroke-colour fallbacks ─────────────────────────────────────────────────

describe('outlineOp — edge stroke colour', () => {
  it('falls back to the source STROKE when it has no fill', async () => {
    const outlineOnly = rectPath('S', 0, 0, 100, 100, null, { stroke: 2, strokeWidth: 0.3 });
    const { specs } = await outlineOp([outlineOnly], engine);
    expect(specs).toHaveLength(4);
    for (const spec of specs) expect(spec.stroke).toBe(2);
  });

  it('falls back to the material colour when it has neither fill nor stroke', async () => {
    const bare = rectPath('B', 0, 0, 100, 100, null, { role: 'silkscreen' });
    const { specs } = await outlineOp([bare], engine);
    expect(specs).toHaveLength(4);
    for (const spec of specs) expect(spec.stroke).toBe(2); // silkscreen = white
  });

  it('keeps palette index 0 (black) rather than treating it as absent', async () => {
    const { specs } = await outlineOp([rectPath('Z', 0, 0, 100, 100, 0)], engine);
    for (const spec of specs) expect(spec.stroke).toBe(0);
  });
});

// ── No-op signalling ────────────────────────────────────────────────────────

describe('outlineOp — empty result', () => {
  it('no eligible input → empty specs', async () => {
    const result = await outlineOp([], engine);
    expect(result.specs).toEqual([]);
    expect(result.target).toBeNull();
  });

  it('a degenerate sub-2-anchor path → empty specs', async () => {
    const dot = pathLeaf('DOT', [{ x: 5, y: 5 }], false, 1);
    const result = await outlineOp([dot], engine);
    expect(result.specs).toHaveLength(0);
    expect(result.target).toBeNull();
  });

  it('a perfectly straight open path still outlines (it is not a degenerate FILL)', async () => {
    const straight = pathLeaf(
      'LINE',
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
      1,
    );
    const { specs } = await outlineOp([straight], engine);
    expect(specs).toHaveLength(2);
  });
});
