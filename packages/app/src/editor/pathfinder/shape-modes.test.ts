// Shape Modes: Unite · Minus Front · Intersect · Exclude · Minus Back.
// Adapted from pgen's test/pathfinder-shape-modes.test.ts. These ops are thin
// policy over the kernel + `ringsToSpecs`, so the assertions are about the
// POLICY they own — input ordering, style inheritance, the empty no-op, and
// multi-component / island-in-hole decomposition — plus curve-native inputs,
// where a young curve-boolean backend is most likely to break. Geometry is
// measured in world mm, which IS the storage space (no transform to undo).
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, ringSignedArea, type BooleanEngine } from '../geometry-kernel';
import { bakeShapeLeaf, leafToKernelInput, specHoleRings, specOuterRing } from './convert';
import {
  applyShapeMode,
  exclude,
  intersect,
  minusBack,
  minusFront,
  unite,
  type ShapeModeOp,
} from './shape-modes';
import {
  absArea,
  blobPath,
  compoundRectPath,
  ellipseShape,
  expectAreaClose,
  holeCount,
  rectPoints,
  rectShape,
  resultNetArea,
  shapeLayerOf,
  totalHoleCount,
} from './test-fixtures';
import type { EligibleLeaf } from './types';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

const inputArea = (leaf: EligibleLeaf): number =>
  leafToKernelInput(leaf).contours.reduce((sum, ring) => sum + absArea(ring), 0);

// ── 1. Unite ────────────────────────────────────────────────────────────────

describe('Unite', () => {
  it('two overlapping rects → exactly 1 spec, style = topmost input', async () => {
    const back = rectShape('back', 0, 0, 100, 100, 0);
    const front = rectShape('front', 50, 50, 100, 100, 2);
    const result = await unite([back, front], engine);

    expect(result.specs).toHaveLength(1);
    // |A| + |B| − overlap = 10000 + 10000 − 2500.
    expectAreaClose(resultNetArea(result), 17500);
    expect(result.specs[0]!.fill).toBe(2);
    expect(result.specs[0]!.stroke).toBeNull();
    expect(result.specs[0]!.name).toBe('Unite');
    expect(result.target).toEqual({ role: 'copper', frontmostLeafId: 'front' });
  });
});

// ── 2. Minus Front ──────────────────────────────────────────────────────────

describe('Minus Front', () => {
  it('front rect inside a big back rect → donut, style = backmost (the kept shape)', async () => {
    const big = rectShape('big', 0, 0, 200, 200, 0); // backmost, kept
    const small = rectShape('small', 50, 50, 100, 100, 2); // frontmost, removed
    const result = await minusFront([big, small], engine);

    expect(result.specs).toHaveLength(1);
    const spec = result.specs[0]!;
    expect(holeCount(spec)).toBe(1);
    expectAreaClose(absArea(specOuterRing(spec)), 40000);
    expectAreaClose(absArea(specHoleRings(spec)[0]!), 10000);
    // Reversed winding: the hole's signed-area sign opposes the outer's.
    expect(Math.sign(ringSignedArea(specHoleRings(spec)[0]!))).toBe(
      -Math.sign(ringSignedArea(specOuterRing(spec))),
    );
    expect(spec.fill).toBe(0);
    expect(spec.name).toBe('Minus Front');
  });

  it('a 1mm border frame comes back as a real layer, not an empty no-op', async () => {
    // Regression: `ringInteriorPoint`'s inward step clears a thin wall and lands
    // in the hole, which made the frame's two rings each other's container and
    // dropped the whole result. See the containment note in convert.ts.
    const result = await minusFront(
      [rectShape('outer', 0, 0, 100, 100, 0), rectShape('inner', 1, 1, 98, 98, 2)],
      engine,
    );
    expect(result.specs).toHaveLength(1);
    expect(holeCount(result.specs[0]!)).toBe(1);
    expectAreaClose(resultNetArea(result), 100 * 100 - 98 * 98);
    expect(result.target).toEqual({ role: 'copper', frontmostLeafId: 'inner' });
  });
});

// ── 3. Intersect ────────────────────────────────────────────────────────────

describe('Intersect', () => {
  it('disjoint inputs → empty no-op result', async () => {
    const a = rectShape('a', 0, 0, 50, 50, 0);
    const b = rectShape('b', 200, 200, 50, 50, 2);
    const result = await intersect([a, b], engine);
    expect(result.specs).toEqual([]);
    expect(result.target).toBeNull();
  });

  it('overlapping inputs → the overlap region, topmost style', async () => {
    const back = rectShape('back', 0, 0, 100, 100, 0);
    const front = rectShape('front', 50, 50, 100, 100, 2);
    const result = await intersect([back, front], engine);
    expect(result.specs).toHaveLength(1);
    expectAreaClose(resultNetArea(result), 2500);
    expect(result.specs[0]!.fill).toBe(2);
  });
});

// ── 4. Exclude — even coverage becomes holes ────────────────────────────────

describe('Exclude', () => {
  it('a big rect with two disjoint inner rects → 1 spec with 2 holes', async () => {
    // Coverage: A-only = 1 (odd → filled); A∩B and A∩C = 2 (even → holes).
    const a = rectShape('a', 0, 0, 300, 100, 0);
    const b = rectShape('b', 40, 25, 50, 50, 1);
    const c = rectShape('c', 210, 25, 50, 50, 2);
    const result = await exclude([a, b, c], engine);

    expect(result.specs).toHaveLength(1);
    expect(holeCount(result.specs[0]!)).toBe(2);
    expectAreaClose(resultNetArea(result), 30000 - 2500 - 2500);
    expect(result.specs[0]!.fill).toBe(2); // topmost
  });

  it('3 concentric shapes → donut spec + separate island spec (no 3-level nesting)', async () => {
    // Coverage from the centre out: C∩B∩A = 3 (odd → filled island),
    // B∩A minus C = 2 (even → hole), A minus B = 1 (odd → filled annulus).
    const a = rectShape('a', 0, 0, 300, 300, 0);
    const b = rectShape('b', 50, 50, 200, 200, 1);
    const c = rectShape('c', 100, 100, 100, 100, 2);
    const result = await exclude([a, b, c], engine);

    // The 2-level points + extraSubpaths model cannot hold island-in-hole in
    // ONE spec, so the island splits off as its own top-level spec.
    expect(result.specs).toHaveLength(2);
    const donut = result.specs.find((spec) => holeCount(spec) === 1);
    const island = result.specs.find((spec) => holeCount(spec) === 0);
    expect(donut).toBeDefined();
    expect(island).toBeDefined();

    expectAreaClose(absArea(specOuterRing(donut!)), 90000);
    expectAreaClose(absArea(specHoleRings(donut!)[0]!), 40000);
    expectAreaClose(absArea(specOuterRing(island!)), 10000);
    // (90000 − 40000) + 10000 == |A| − |B| + |C|.
    expectAreaClose(resultNetArea(result), 60000);
  });
});

// ── 5. Minus Back mirrors Minus Front under inverted z-roles ───────────────

describe('Minus Back', () => {
  it('keeps the FRONTMOST minus the rest', async () => {
    const big = rectShape('big', 0, 0, 200, 200, 0);
    const small = rectShape('small', 50, 50, 100, 100, 2);

    // Minus Front keeps backmost: [big(back), small(front)] → big − small.
    const front = await minusFront([big, small], engine);
    // Minus Back keeps frontmost: invert z so big is front → big − small again.
    const back = await minusBack([small, big], engine);

    for (const result of [front, back]) {
      expect(result.specs).toHaveLength(1);
      expect(holeCount(result.specs[0]!)).toBe(1);
      expectAreaClose(resultNetArea(result), 30000);
    }
    // Both keep `big` (fill 0): Minus Front via backmost, Minus Back via frontmost.
    expect(front.specs[0]!.fill).toBe(0);
    expect(back.specs[0]!.fill).toBe(0);
    expect(back.specs[0]!.name).toBe('Minus Back');
  });
});

// ── 6. Style-inheritance table ──────────────────────────────────────────────

describe('style inheritance per op', () => {
  const back = () => rectShape('back', 0, 0, 100, 100, 0);
  const front = () => rectShape('front', 50, 50, 100, 100, 2);

  const table: { op: ShapeModeOp; expected: 0 | 2 }[] = [
    { op: 'unite', expected: 2 }, // topmost
    { op: 'intersect', expected: 2 }, // topmost
    { op: 'exclude', expected: 2 }, // topmost
    { op: 'minusFront', expected: 0 }, // backmost (kept)
    { op: 'minusBack', expected: 2 }, // frontmost (kept)
  ];

  for (const { op, expected } of table) {
    it(`${op} → result adopts fill ${expected}`, async () => {
      const result = await applyShapeMode(op, [back(), front()], engine);
      expect(result.specs.length).toBeGreaterThan(0);
      for (const spec of result.specs) expect(spec.fill).toBe(expected);
    });
  }

  it('a path input carries its own stroke colour and width into the result', async () => {
    const styled = rectShape('back', 0, 0, 100, 100, 0);
    const front = compoundRectPath('front', 50, 50, 100, 100, 2, [], {});
    front.layer = { ...front.layer, stroke: 1, strokeWidth: 0.4 } as typeof front.layer;
    const result = await unite([styled, front], engine);
    expect(result.specs[0]!.stroke).toBe(1);
    expect(result.specs[0]!.strokeWidth).toBe(0.4);
  });

  it('a shape input resolves to fill-only (its colour never becomes a stroke)', async () => {
    const result = await unite(
      [rectShape('back', 0, 0, 100, 100, 0), rectShape('front', 50, 50, 100, 100, 2)],
      engine,
    );
    expect(result.specs[0]!.stroke).toBeNull();
    expect(result.specs[0]!.strokeWidth).toBe(0);
  });
});

// ── 7. Curve-native inputs ──────────────────────────────────────────────────

describe('curved inputs', () => {
  it('two overlapping ellipses: area(Unite) + area(Intersect) ≈ area(A) + area(B)', async () => {
    const a = ellipseShape('a', 0, 0, 200, 120, 0);
    const b = ellipseShape('b', 80, 40, 200, 120, 2);
    const areaA = absArea(bakeShapeLeaf(shapeLayerOf(a)));
    const areaB = absArea(bakeShapeLeaf(shapeLayerOf(b)));

    const union = await unite([a, b], engine);
    const overlap = await intersect([a, b], engine);
    expect(union.specs).toHaveLength(1);
    expect(overlap.specs).toHaveLength(1);
    expectAreaClose(resultNetArea(union) + resultNetArea(overlap), areaA + areaB, 3e-3);
  });

  it('Minus Front of a big rect minus a contained ellipse → donut with a curved hole', async () => {
    const big = rectShape('big', 0, 0, 300, 300, 0);
    const disc = ellipseShape('disc', 100, 100, 100, 100, 2);
    const result = await minusFront([big, disc], engine);

    expect(result.specs).toHaveLength(1);
    expect(holeCount(result.specs[0]!)).toBe(1);
    expectAreaClose(absArea(specHoleRings(result.specs[0]!)[0]!), Math.PI * 50 * 50);
    expectAreaClose(resultNetArea(result), 90000 - Math.PI * 50 * 50);
    expect(result.specs[0]!.fill).toBe(0); // backmost
  });

  it('bezier blobs: Unite of two overlapping blobs covers more than either alone', async () => {
    const a = blobPath('a', 100, 100, 60, 0);
    const b = blobPath('b', 150, 100, 60, 2);
    const result = await unite([a, b], engine);
    expect(result.specs.length).toBeGreaterThanOrEqual(1);
    expect(resultNetArea(result)).toBeGreaterThan(inputArea(a));

    const excluded = await exclude([a, b], engine);
    expect(excluded.specs.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 8. Compound (points + extraSubpaths) inputs ────────────────────────────

describe('compound single-hole input across every Shape Mode', () => {
  const donut = () => compoundRectPath('donut', 0, 0, 200, 200, 0, [rectPoints(50, 50, 100, 100)]);
  const strip = () => compoundRectPath('strip', 80, -20, 40, 240, 2, []);

  const cases: {
    op: ShapeModeOp;
    inputs: () => EligibleLeaf[];
    area: number;
    specs: number;
    holes: number;
    fill: 0 | 2;
  }[] = [
    { op: 'unite', inputs: () => [donut(), strip()], area: 35_600, specs: 1, holes: 2, fill: 2 },
    { op: 'intersect', inputs: () => [donut(), strip()], area: 4_000, specs: 2, holes: 0, fill: 2 },
    { op: 'exclude', inputs: () => [donut(), strip()], area: 31_600, specs: 4, holes: 0, fill: 2 },
    {
      op: 'minusFront',
      inputs: () => [donut(), strip()],
      area: 26_000,
      specs: 2,
      holes: 0,
      fill: 0,
    },
    // Minus Back keeps the frontmost, so the donut goes in front.
    {
      op: 'minusBack',
      inputs: () => [strip(), donut()],
      area: 26_000,
      specs: 2,
      holes: 0,
      fill: 0,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.op} treats the hole as part of ONE compound operand`, async () => {
      const result = await applyShapeMode(testCase.op, testCase.inputs(), engine);
      expect(result.specs).toHaveLength(testCase.specs);
      expectAreaClose(resultNetArea(result), testCase.area);
      expect(totalHoleCount(result)).toBe(testCase.holes);
      expect(result.specs.every((spec) => spec.fill === testCase.fill)).toBe(true);
    });
  }

  it('Unite keeps an existing hole when the other operand does not cover it', async () => {
    const outside = compoundRectPath('outside', 240, 0, 20, 20, 2, []);
    const result = await unite([donut(), outside], engine);
    expect(result.specs).toHaveLength(2);
    expect(result.specs.some((spec) => holeCount(spec) === 1)).toBe(true);
    expectAreaClose(resultNetArea(result), 30_400);
  });

  it('Unite fills the hole only where another operand covers it', async () => {
    const cover = compoundRectPath('cover', 50, 50, 100, 100, 2, []);
    const result = await unite([donut(), cover], engine);
    expect(result.specs).toHaveLength(1);
    expect(holeCount(result.specs[0]!)).toBe(0);
    expectAreaClose(resultNetArea(result), 40_000);
  });

  it('Intersect with geometry wholly inside the hole is empty', async () => {
    const insideHole = compoundRectPath('inside-hole', 70, 70, 20, 20, 2, []);
    const result = await intersect([donut(), insideHole], engine);
    expect(result.specs).toEqual([]);
  });
});

describe('compound multiple-hole input across every Shape Mode', () => {
  const twoHole = () =>
    compoundRectPath('two-hole', 0, 0, 300, 100, 0, [
      rectPoints(40, 25, 50, 50),
      rectPoints(210, 25, 50, 50),
    ]);
  const solidCover = () => compoundRectPath('solid-cover', 0, 0, 300, 100, 2, []);
  const outside = () => compoundRectPath('outside', 320, 0, 20, 20, 2, []);

  const cases: {
    op: ShapeModeOp;
    inputs: () => EligibleLeaf[];
    area: number;
    specs: number;
    holes: number;
  }[] = [
    { op: 'unite', inputs: () => [twoHole(), outside()], area: 25_400, specs: 2, holes: 2 },
    { op: 'intersect', inputs: () => [twoHole(), solidCover()], area: 25_000, specs: 1, holes: 2 },
    { op: 'exclude', inputs: () => [twoHole(), outside()], area: 25_400, specs: 2, holes: 2 },
    { op: 'minusFront', inputs: () => [twoHole(), outside()], area: 25_000, specs: 1, holes: 2 },
    { op: 'minusBack', inputs: () => [outside(), twoHole()], area: 25_000, specs: 1, holes: 2 },
  ];

  for (const testCase of cases) {
    it(`${testCase.op} preserves the two-hole region`, async () => {
      const result = await applyShapeMode(testCase.op, testCase.inputs(), engine);
      expect(result.specs).toHaveLength(testCase.specs);
      expectAreaClose(resultNetArea(result), testCase.area);
      expect(totalHoleCount(result)).toBe(testCase.holes);
    });
  }
});

describe('one-ring parity', () => {
  const ops: ShapeModeOp[] = ['unite', 'intersect', 'exclude', 'minusFront', 'minusBack'];

  for (const op of ops) {
    it(`${op} is unchanged by an explicitly EMPTY extraSubpaths array`, async () => {
      const control = [
        compoundRectPath('back', 0, 0, 100, 100, 0, []),
        compoundRectPath('front', 50, 25, 100, 100, 2, []),
      ];
      control[0]!.layer = { ...control[0]!.layer, extraSubpaths: undefined } as never;
      control[1]!.layer = { ...control[1]!.layer, extraSubpaths: undefined } as never;
      const explicitEmpty = [
        compoundRectPath('back', 0, 0, 100, 100, 0, []),
        compoundRectPath('front', 50, 25, 100, 100, 2, []),
      ];

      const expected = await applyShapeMode(op, control, engine);
      const actual = await applyShapeMode(op, explicitEmpty, engine);
      expect(actual.specs).toEqual(expected.specs);
    });
  }
});

// ── 9. Eligibility gate ─────────────────────────────────────────────────────

describe('eligibility gate', () => {
  it('a single input is a no-op for every Shape Mode (min is 2)', async () => {
    const only = [rectShape('only', 0, 0, 100, 100, 0)];
    for (const op of [
      'unite',
      'minusFront',
      'intersect',
      'exclude',
      'minusBack',
    ] as ShapeModeOp[]) {
      const result = await applyShapeMode(op, only, engine);
      expect(result.specs).toEqual([]);
      expect(result.target).toBeNull();
    }
  });

  it('an empty selection is a no-op', async () => {
    expect((await unite([], engine)).specs).toEqual([]);
  });
});

// ── 10. Cross-material destination ─────────────────────────────────────────

describe('cross-material selection → container of the FRONTMOST input', () => {
  it('lands in the frontmost input’s material, matching its inherited style', async () => {
    const copper = rectShape('copper', 0, 0, 100, 100, 1, { role: 'copper' });
    const silk = rectShape('silk', 50, 50, 100, 100, 2, { role: 'silkscreen' });
    const result = await unite([copper, silk], engine);

    expect(result.target).toEqual({ role: 'silkscreen', frontmostLeafId: 'silk' });
    // Unite inherits the topmost style, so geometry and material agree.
    expect(result.specs[0]!.fill).toBe(2);
  });

  it('the rule is uniform: Minus Front also lands frontmost, though its STYLE is backmost', async () => {
    const copper = rectShape('copper', 0, 0, 200, 200, 1, { role: 'copper' });
    const silk = rectShape('silk', 50, 50, 100, 100, 2, { role: 'silkscreen' });
    const result = await minusFront([copper, silk], engine);

    expect(result.target).toEqual({ role: 'silkscreen', frontmostLeafId: 'silk' });
    // The op reports the inherited (backmost) colour faithfully; committing it
    // into the silkscreen container is what re-normalizes it. See selection.ts.
    expect(result.specs[0]!.fill).toBe(1);
  });
});

// ── 11. Known backend limit ────────────────────────────────────────────────

describe('KNOWN LIMIT — exact edge tangency (path-bool, inherited from the kernel)', () => {
  it('a rect whose edge is exactly tangent to a circle intersects to nothing', async () => {
    // The rect's bottom edge y=150 touches the circle (centre 75,75 r 75) at
    // exactly one point. path-bool's arrangement drops the intersection region
    // entirely, and the union comes back split in two — so the
    // area(A∪B) + area(A∩B) == area(A) + area(B) invariant does NOT hold here.
    // This is backend behaviour, not op policy: nothing in this module can
    // recover it, and the geometry kernel's documented paper.js fallback
    // criteria (T2) are where it would be addressed. Nudging either shape off
    // the tangency by more than the 1e-4 mm snap grid restores the invariant.
    // If a kernel/backend change makes this pass, delete the test and the note.
    const circle = ellipseShape('circle', 0, 0, 150, 150, 0);
    const tangent = rectShape('tangent', 60, 60, 150, 90, 2);
    expect((await intersect([circle, tangent], engine)).specs).toEqual([]);

    const clear = rectShape('clear', 60, 40, 150, 90, 2);
    const union = await unite([circle, clear], engine);
    const overlap = await intersect([circle, clear], engine);
    expectAreaClose(
      resultNetArea(union) + resultNetArea(overlap),
      inputArea(circle) + inputArea(clear),
      1e-4,
    );
  });
});
