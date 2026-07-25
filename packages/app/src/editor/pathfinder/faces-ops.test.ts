// Pathfinders-row faces ops: Divide / Trim / Merge / Crop. Adapted from pgen's
// test/pathfinder-faces-ops.test.ts — exact expected face/spec counts (not
// tolerant ranges), plus direct tests of the containment-checked interior point
// and its scanline fallback, which is the attribution correctness risk.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBooleanEngine,
  flattenRing,
  pointInPolygon,
  type BooleanEngine,
  type KernelPoint,
  type KernelRing,
} from '../geometry-kernel';
import { specOuterRing } from './convert';
import { shouldGroupResult } from './dispatch';
import {
  crop,
  divide,
  faceRepresentativePoint,
  merge,
  pointInFilledContours,
  pointInFilledRing,
  scanlineInteriorPoint,
  trim,
  windingNumber,
} from './faces-ops';
import {
  bowtiePath,
  compoundRectPath,
  ellipseShape,
  expectAreaClose,
  fillCounts,
  rectPath,
  rectPoints,
  specArea,
  specContainsPoint,
  specNetArea,
} from './test-fixtures';
import type { PathfinderOpResult } from './types';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

/** Stroked rect path, so "strokes are dropped" is an observable assertion. */
const strokedRect = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: 0 | 1 | 2 | null,
) => rectPath(id, x, y, w, h, fill, { stroke: 1, strokeWidth: 0.4 });

function expectStrokesDropped(result: PathfinderOpResult): void {
  for (const spec of result.specs) expect(spec.stroke).toBeNull();
}

// ── Divide ──────────────────────────────────────────────────────────────────

describe('divide — two overlapping rects', () => {
  it('splits into exactly 3 faces with the top fill winning the overlap', async () => {
    const a = strokedRect('A', 0, 0, 100, 100, 0); // back
    const b = strokedRect('B', 50, 50, 100, 100, 2); // front
    const result = await divide([a, b], engine);

    expect(result.specs).toHaveLength(3);
    const counts = fillCounts(result.specs);
    expect(counts.get(0)).toBe(1); // A-only
    expect(counts.get(2)).toBe(2); // B-only + the overlap (top wins)
    const overlap = [...result.specs].sort((p, q) => specArea(p) - specArea(q))[0]!;
    expectAreaClose(specArea(overlap), 2500);
    expect(overlap.fill).toBe(2);
    expectStrokesDropped(result);
    expect(shouldGroupResult(result)).toBe(true);
    expect(result.specs.map((s) => s.name)).toEqual(['Divide 1', 'Divide 2', 'Divide 3']);
  });
});

describe('divide — concave/curved faces (two overlapping ellipses)', () => {
  it('attributes the thin crescents correctly via the interior-point path', async () => {
    // Heavily overlapping equal ellipses → thin left/right crescents + a lens.
    const a = ellipseShape('A', 0, 0, 160, 160, 0); // back, centre (80,80) r80
    const b = ellipseShape('B', 40, 0, 160, 160, 2); // front, centre (120,80) r80
    const result = await divide([a, b], engine);

    expect(result.specs).toHaveLength(3);
    const counts = fillCounts(result.specs);
    expect(counts.get(0)).toBe(1); // A-only crescent
    expect(counts.get(2)).toBe(2); // B-only crescent + lens
    expect(counts.get(null)).toBeUndefined(); // no unpainted face leaked through
  });
});

describe('divide — single self-intersecting path (≥1 gating)', () => {
  it('splits a bowtie into its two triangle faces', async () => {
    const result = await divide([bowtiePath('X', 1)], engine);
    expect(result.specs).toHaveLength(2);
    for (const spec of result.specs) {
      expect(spec.fill).toBe(1);
      expectAreaClose(specArea(spec), 2500);
    }
  });
});

describe('divide — unpainted faces dropped', () => {
  it('two unfilled rects → empty no-op result', async () => {
    const result = await divide(
      [strokedRect('A', 0, 0, 100, 100, null), strokedRect('B', 50, 50, 100, 100, null)],
      engine,
    );
    expect(result.specs).toHaveLength(0);
    expect(result.target).toBeNull();
    expect(shouldGroupResult(result)).toBe(false);
  });

  it('an unfilled TOP input is transparent — the filled input below shows through', async () => {
    const a = strokedRect('A', 0, 0, 100, 100, 0); // filled, back
    const b = strokedRect('B', 50, 50, 100, 100, null); // unfilled, front
    const result = await divide([a, b], engine);
    // A-only (7500) + overlap (2500) both attributed to A; B-only dropped.
    expect(result.specs).toHaveLength(2);
    for (const spec of result.specs) expect(spec.fill).toBe(0);
  });
});

describe('divide — compound filled regions', () => {
  it('preserves one and many holes as holes, not as independent operands', async () => {
    const oneHole = compoundRectPath('ONE', 0, 0, 200, 200, 0, [rectPoints(60, 60, 80, 80)]);
    const one = await divide([oneHole], engine);
    expect(one.specs).toHaveLength(1);
    expect(one.specs[0]!.extraSubpaths).toHaveLength(1);
    expectAreaClose(specNetArea(one.specs[0]!), 33_600);

    const manyHoles = compoundRectPath('MANY', 0, 0, 240, 160, 1, [
      rectPoints(30, 40, 40, 60),
      rectPoints(100, 40, 40, 60),
      rectPoints(170, 40, 40, 60),
    ]);
    const many = await divide([manyHoles], engine);
    expect(many.specs).toHaveLength(1);
    expect(many.specs[0]!.extraSubpaths).toHaveLength(3);
    expectAreaClose(specNetArea(many.specs[0]!), 31_200);
  });

  it('skips empty and degenerate holes without creating phantom faces', async () => {
    const invalid = compoundRectPath('INVALID', 0, 0, 200, 200, 0, [
      [],
      [{ x: 40, y: 40 }],
      [
        { x: 80, y: 80 },
        { x: 120, y: 80 },
        { x: 160, y: 80 },
      ],
    ]);
    const result = await divide([invalid], engine);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]!.extraSubpaths).toBeUndefined();
    expectAreaClose(specNetArea(result.specs[0]!), 40_000);
  });

  it('attributes the face inside an upper hole to the filled lower layer', async () => {
    const lower = strokedRect('LOWER', 0, 0, 200, 200, 0);
    const upper = compoundRectPath('UPPER', 20, 20, 160, 160, 2, [rectPoints(70, 70, 60, 60)]);
    const result = await divide([lower, upper], engine);

    expect(result.specs).toHaveLength(3);
    const centre = result.specs.filter((spec) => specContainsPoint(spec, { x: 100, y: 100 }));
    expect(centre).toHaveLength(1);
    expect(centre[0]!.fill).toBe(0);
    expect(result.specs.some((spec) => spec.fill === 2)).toBe(true);
  });
});

// ── Trim ────────────────────────────────────────────────────────────────────

describe('trim', () => {
  it('keeps each input trimmed to its visible region, strokes dropped', async () => {
    const a = strokedRect('A', 0, 0, 100, 100, 0);
    const b = strokedRect('B', 50, 50, 100, 100, 2);
    const result = await trim([a, b], engine);

    expect(result.specs).toHaveLength(2);
    const byArea = [...result.specs].sort((p, q) => specArea(p) - specArea(q));
    expectAreaClose(specArea(byArea[0]!), 7500); // A trimmed of the overlap
    expectAreaClose(specArea(byArea[1]!), 10000); // B fully on top
    expect(byArea[0]!.fill).toBe(0);
    expect(byArea[1]!.fill).toBe(2);
    expectStrokesDropped(result);
  });

  it('same-colour neighbours are NOT merged', async () => {
    const result = await trim(
      [strokedRect('A', 0, 0, 100, 100, 0), strokedRect('B', 50, 50, 100, 100, 0)],
      engine,
    );
    expect(result.specs).toHaveLength(2);
    for (const spec of result.specs) expect(spec.fill).toBe(0);
  });

  it('keeps the lower layer visible through an upper compound hole', async () => {
    const lower = strokedRect('LOWER', 0, 0, 200, 200, 0);
    const upper = compoundRectPath('UPPER', 20, 20, 160, 160, 2, [rectPoints(70, 70, 60, 60)]);
    const result = await trim([lower, upper], engine);

    expect(result.specs).toHaveLength(3);
    expect(result.specs.map((spec) => spec.fill)).toEqual([0, 0, 2]);
    const centre = result.specs.filter((spec) => specContainsPoint(spec, { x: 100, y: 100 }));
    expect(centre).toHaveLength(1);
    expect(centre[0]!.fill).toBe(0);
    expectStrokesDropped(result);
  });
});

// ── Merge ───────────────────────────────────────────────────────────────────

describe('merge', () => {
  it('fuses two same-colour overlapping rects into ONE spec (area = union)', async () => {
    const result = await merge(
      [strokedRect('A', 0, 0, 100, 100, 0), strokedRect('B', 50, 50, 100, 100, 0)],
      engine,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]!.fill).toBe(0);
    expectAreaClose(specArea(result.specs[0]!), 17500);
    expectStrokesDropped(result);
  });

  it('different-colour inputs stay separate', async () => {
    const result = await merge(
      [strokedRect('A', 0, 0, 100, 100, 0), strokedRect('B', 50, 50, 100, 100, 2)],
      engine,
    );
    expect(result.specs).toHaveLength(2);
    expect(fillCounts(result.specs).get(0)).toBe(1);
    expect(fillCounts(result.specs).get(2)).toBe(1);
  });

  it('preserves lower-layer ownership through an upper hole when fills differ', async () => {
    const lower = strokedRect('LOWER', 0, 0, 200, 200, 0);
    const upper = compoundRectPath('UPPER', 20, 20, 160, 160, 2, [rectPoints(70, 70, 60, 60)]);
    const result = await merge([lower, upper], engine);

    expect(result.specs).toHaveLength(3);
    expect(result.specs.map((spec) => spec.fill)).toEqual([0, 0, 2]);
    const centre = result.specs.filter((spec) => specContainsPoint(spec, { x: 100, y: 100 }));
    expect(centre).toHaveLength(1);
    expect(centre[0]!.fill).toBe(0);
  });
});

// ── Crop ────────────────────────────────────────────────────────────────────

describe('crop', () => {
  it('keeps only the region under the crop shape, filled by the input below', async () => {
    const a = strokedRect('A', 0, 0, 100, 100, 0);
    const top = strokedRect('TOP', 50, 50, 100, 100, 2); // crop boundary
    const result = await crop([a, top], engine);

    expect(result.specs).toHaveLength(1);
    expectAreaClose(specArea(result.specs[0]!), 2500);
    // Fill comes from A (below), never the boundary's own.
    expect(result.specs[0]!.fill).toBe(0);
    expectStrokesDropped(result);
  });

  it('clips a larger lower shape to the crop boundary', async () => {
    const result = await crop(
      [strokedRect('A', 0, 0, 200, 200, 0), strokedRect('TOP', 50, 50, 100, 100, 2)],
      engine,
    );
    expect(result.specs).toHaveLength(1);
    expectAreaClose(specArea(result.specs[0]!), 10000);
    expect(result.specs[0]!.fill).toBe(0);
  });

  it('attributes an upper compound hole to the lower layer inside the boundary', async () => {
    const lower = strokedRect('LOWER', 0, 0, 200, 200, 0);
    const upper = compoundRectPath('UPPER', 20, 20, 160, 160, 2, [rectPoints(70, 70, 60, 60)]);
    const boundary = strokedRect('CROP', 30, 30, 140, 140, 1);
    const result = await crop([lower, upper, boundary], engine);

    expect(result.specs).toHaveLength(2);
    expect(result.specs.map((spec) => spec.fill)).toEqual([0, 2]);
    const centre = result.specs.filter((spec) => specContainsPoint(spec, { x: 100, y: 100 }));
    expect(centre).toHaveLength(1);
    expect(centre[0]!.fill).toBe(0);
    // The boundary's own fill never reaches the result.
    expect(result.specs.every((spec) => spec.fill !== 1)).toBe(true);
  });
});

// ── Thresholds ──────────────────────────────────────────────────────────────

describe('eligibility thresholds', () => {
  it('trim / merge / crop need ≥2 inputs', async () => {
    const one = [strokedRect('A', 0, 0, 100, 100, 0)];
    expect((await trim(one, engine)).specs).toHaveLength(0);
    expect((await merge(one, engine)).specs).toHaveLength(0);
    expect((await crop(one, engine)).specs).toHaveLength(0);
  });

  it('divide needs ≥1 input', async () => {
    expect((await divide([], engine)).specs).toHaveLength(0);
    expect((await divide([strokedRect('A', 0, 0, 100, 100, 0)], engine)).specs).toHaveLength(1);
  });
});

// ── Cross-material destination ──────────────────────────────────────────────

describe('faces ops land in the frontmost input’s container', () => {
  it('reports the attributed colours faithfully even when they span materials', async () => {
    const copper = rectPath('copper', 0, 0, 100, 100, 1, { role: 'copper' });
    const silk = rectPath('silk', 50, 50, 100, 100, 2, { role: 'silkscreen' });
    const result = await divide([copper, silk], engine);

    expect(result.target).toEqual({ role: 'silkscreen', frontmostLeafId: 'silk' });
    // Both source colours survive into the specs; collapsing them onto the
    // destination material is the document mutation's doing, not this layer's.
    expect(fillCounts(result.specs).get(1)).toBe(1);
    expect(fillCounts(result.specs).get(2)).toBe(2);
  });
});

// ── Attribution internals ───────────────────────────────────────────────────

/** Closed ring from a point loop (straight edges = degenerate cubics). */
function polyRing(points: KernelPoint[]): KernelRing {
  const ring: KernelRing = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    ring.push({ p0: a, c1: a, c2: b, p3: b });
  }
  return ring;
}

/** A strongly concave "C" band (radius 100–120, ~300° arc): its centroid is
 *  OUTSIDE the band, so a naive centroid attribution would misattribute it. */
function cBand(): KernelRing {
  const outer: KernelPoint[] = [];
  const inner: KernelPoint[] = [];
  const start = (30 * Math.PI) / 180;
  const end = (330 * Math.PI) / 180;
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    outer.push({ x: 120 * Math.cos(t), y: 120 * Math.sin(t) });
  }
  for (let i = steps; i >= 0; i--) {
    const t = start + ((end - start) * i) / steps;
    inner.push({ x: 100 * Math.cos(t), y: 100 * Math.sin(t) });
  }
  return polyRing([...outer, ...inner]);
}

describe('faceRepresentativePoint', () => {
  it('returns a strictly interior point for a strongly concave band', () => {
    const ring = cBand();
    const poly = flattenRing(ring);
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    expect(pointInPolygon({ x: cx, y: cy }, poly)).toBe(false); // the naive path fails

    expect(pointInPolygon(faceRepresentativePoint([ring]), poly)).toBe(true);
  });

  it('the scanline fallback finds an interior point for the same band', () => {
    const poly = flattenRing(cBand());
    const scan = scanlineInteriorPoint(poly, []);
    expect(scan).not.toBeNull();
    expect(pointInPolygon(scan!, poly)).toBe(true);
  });

  it('excludes holes: inside the outer ring but outside the hole', () => {
    const outer = polyRing([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]);
    const hole = polyRing([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
      { x: 60, y: 140 },
    ]);
    const rep = faceRepresentativePoint([outer, hole]);
    expect(pointInPolygon(rep, flattenRing(outer))).toBe(true);
    expect(pointInPolygon(rep, flattenRing(hole))).toBe(false);
  });

  it('picks the largest ring as the outer boundary regardless of order', () => {
    const big = polyRing([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]);
    const small = polyRing([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
      { x: 60, y: 140 },
    ]);
    expect(faceRepresentativePoint([small, big])).toEqual(faceRepresentativePoint([big, small]));
  });
});

describe('fill-rule-aware hit tests', () => {
  const bowtiePoly = flattenRing(
    polyRing([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]),
  );

  it('nonzero classifies a self-intersecting bowtie lobe as filled', () => {
    const inside = { x: 80, y: 50 };
    expect(pointInFilledRing(inside, bowtiePoly, 'nonzero')).toBe(true);
    expect(Math.abs(windingNumber(inside, bowtiePoly))).toBe(1);
    expect(pointInFilledRing({ x: 200, y: 50 }, bowtiePoly, 'nonzero')).toBe(false);
  });

  const outer = flattenRing(
    polyRing([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]),
  );
  const innerSame = flattenRing(
    polyRing([
      { x: 60, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
      { x: 60, y: 140 },
    ]),
  );
  const innerOpposite = [...innerSame].reverse();

  it('even-odd toggles membership across contours regardless of winding', () => {
    expect(pointInFilledContours({ x: 20, y: 20 }, [outer, innerSame], 'evenodd')).toBe(true);
    expect(pointInFilledContours({ x: 100, y: 100 }, [outer, innerSame], 'evenodd')).toBe(false);
    expect(pointInFilledContours({ x: 100, y: 100 }, [outer, innerOpposite], 'evenodd')).toBe(
      false,
    );
  });

  it('nonzero sums winding so opposite contours cancel and equal ones stay filled', () => {
    expect(pointInFilledContours({ x: 100, y: 100 }, [outer, innerSame], 'nonzero')).toBe(true);
    expect(pointInFilledContours({ x: 100, y: 100 }, [outer, innerOpposite], 'nonzero')).toBe(
      false,
    );
    expect(pointInFilledContours({ x: 300, y: 100 }, [outer, innerSame], 'nonzero')).toBe(false);
  });
});

// ── Ordering contract, observed through an op ──────────────────────────────

describe('back→front input order is load-bearing', () => {
  it('reversing the inputs changes which shape Trim keeps whole', async () => {
    const a = strokedRect('A', 0, 0, 100, 100, 0);
    const b = strokedRect('B', 50, 50, 100, 100, 2);

    const forward = await trim([a, b], engine);
    const reversed = await trim([b, a], engine);

    const wholeOf = (result: PathfinderOpResult) =>
      [...result.specs].sort((p, q) => specArea(q) - specArea(p))[0]!;
    expectAreaClose(specArea(wholeOf(forward)), 10000);
    expect(wholeOf(forward).fill).toBe(2); // B was on top
    expectAreaClose(specArea(wholeOf(reversed)), 10000);
    expect(wholeOf(reversed).fill).toBe(0); // A was on top
    // Same geometry, opposite attribution — nothing throws either way, which is
    // exactly why the ordering has to be pinned at the selection boundary.
    expect(specOuterRing(wholeOf(forward))).not.toEqual(specOuterRing(wholeOf(reversed)));
  });
});
