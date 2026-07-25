// Boolean engine adapter over path-bool. Adapted from pgen's
// test/pathfinder-engine.test.ts, retargeted to the kernel's names and to
// DOCUMENT MILLIMETRES — the rect coordinates below are mm, so the areas are
// mm^2 and the tolerance tests below are physically meaningful.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, DEFAULT_MM_EPSILONS } from './engine';
import { KAPPA, ringSignedArea, sampleCubicAt } from './geometry';
import type { BooleanEngine, KernelCubic, KernelInput, KernelRing } from './types';

// ── Ring builders (document mm) ──────────────────────────────────────────────

function line(p0: { x: number; y: number }, p3: { x: number; y: number }): KernelCubic {
  return { p0, c1: p0, c2: p3, p3 };
}
function rectRing(x: number, y: number, w: number, h: number): KernelRing {
  const tl = { x, y };
  const tr = { x: x + w, y };
  const br = { x: x + w, y: y + h };
  const bl = { x, y: y + h };
  return [line(tl, tr), line(tr, br), line(br, bl), line(bl, tl)];
}

// A circle as four kappa cubics, clockwise in y-down space.
function circleRing(cx: number, cy: number, r: number): KernelRing {
  const k = KAPPA * r;
  const e = { x: cx + r, y: cy };
  const s = { x: cx, y: cy + r };
  const w = { x: cx - r, y: cy };
  const n = { x: cx, y: cy - r };
  return [
    { p0: e, c1: { x: e.x, y: e.y + k }, c2: { x: s.x + k, y: s.y }, p3: s },
    { p0: s, c1: { x: s.x - k, y: s.y }, c2: { x: w.x, y: w.y + k }, p3: w },
    { p0: w, c1: { x: w.x, y: w.y - k }, c2: { x: n.x - k, y: n.y }, p3: n },
    { p0: n, c1: { x: n.x + k, y: n.y }, c2: { x: e.x, y: e.y - k }, p3: e },
  ];
}

function input(contours: KernelRing[], fillRule: KernelInput['fillRule'] = 'nonzero'): KernelInput {
  return { contours, fillRule };
}

const single = (ring: KernelRing): KernelInput => input([ring]);

const absArea = (r: KernelRing) => Math.abs(ringSignedArea(r));
const netArea = (rings: KernelRing[]) => Math.abs(rings.reduce((a, r) => a + ringSignedArea(r), 0));

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

// Two axis-aligned 100mm squares overlapping in a 50mm corner.
const A = () => rectRing(0, 0, 100, 100); // 10000 mm^2
const B = () => rectRing(50, 50, 100, 100); // 10000 mm^2, overlap 2500 mm^2

describe('BooleanEngine — shape-mode booleans', () => {
  it('unite → one ring, area = A + B − overlap', () => {
    const rings = engine.arrange([single(A()), single(B())]).unite();
    expect(rings.length).toBe(1);
    expect(netArea(rings)).toBeCloseTo(17500, 1);
  });

  it('subtract (containment) → donut: 2 rings, opposite winding, correct areas', () => {
    const big = rectRing(0, 0, 200, 200); // 40000
    const small = rectRing(50, 50, 100, 100); // 10000, fully inside
    const rings = engine.arrange([single(big), single(small)]).subtract();
    expect(rings.length).toBe(2);
    const areas = rings.map(ringSignedArea).sort((a, b) => Math.abs(b) - Math.abs(a));
    expect(Math.abs(areas[0]!)).toBeCloseTo(40000, 1); // outer
    expect(Math.abs(areas[1]!)).toBeCloseTo(10000, 1); // hole
    // Hole winds opposite to the outer boundary.
    expect(Math.sign(areas[0]!)).toBe(-Math.sign(areas[1]!));
    expect(netArea(rings)).toBeCloseTo(30000, 1); // covered area = 40000 − 10000
  });

  it('subtract treats input[0] as the minuend (order matters)', () => {
    const backKept = engine.arrange([single(A()), single(B())]).subtract();
    const frontKept = engine.arrange([single(B()), single(A())]).subtract();
    // Each keeps its first input minus the 2500 overlap → 7500, but the two
    // results are different regions (different position), same net area.
    expect(netArea(backKept)).toBeCloseTo(7500, 1);
    expect(netArea(frontKept)).toBeCloseTo(7500, 1);
  });

  it('intersect → the 50mm × 50mm overlap', () => {
    const rings = engine.arrange([single(A()), single(B())]).intersect();
    expect(rings.length).toBe(1);
    expect(netArea(rings)).toBeCloseTo(2500, 1);
  });

  it('exclude → symmetric difference area', () => {
    const rings = engine.arrange([single(A()), single(B())]).exclude();
    const total = rings.reduce((a, r) => a + absArea(r), 0);
    // |A| + |B| − 2·overlap = 10000 + 10000 − 5000.
    expect(total).toBeCloseTo(15000, 1);
  });
});

describe('BooleanEngine — compound contour inputs', () => {
  it('keeps an empty compound input as an empty/no-op result', () => {
    expect(engine.arrange([input([])]).unite()).toEqual([]);
  });

  it('applies evenodd to one same-winding inner contour', () => {
    const outer = rectRing(0, 0, 200, 200);
    const hole = rectRing(50, 50, 100, 100);

    const rings = engine.arrange([input([outer, hole], 'evenodd')]).unite();

    expect(rings).toHaveLength(2);
    expect(netArea(rings)).toBeCloseTo(30_000, 1);
    expect(Math.sign(ringSignedArea(rings[0]!))).toBe(-Math.sign(ringSignedArea(rings[1]!)));
  });

  it('retains multiple contour discontinuities under one fill rule', () => {
    const outer = rectRing(0, 0, 300, 200);
    const firstHole = rectRing(25, 25, 50, 50);
    const secondHole = rectRing(200, 80, 40, 60);

    const rings = engine.arrange([input([outer, firstHole, secondHole], 'evenodd')]).unite();

    expect(rings).toHaveLength(3);
    expect(netArea(rings)).toBeCloseTo(55_100, 1);
    expect(rings.map(absArea).sort((a, b) => a - b)).toEqual([2_400, 2_500, 60_000]);
  });

  it('treats a probe entirely inside a hole as empty filled space', () => {
    const donut = input([rectRing(0, 0, 200, 200), rectRing(50, 50, 100, 100)], 'evenodd');
    const probe = single(rectRing(80, 80, 20, 20));

    expect(engine.arrange([donut, probe]).intersect()).toEqual([]);
    expect(netArea(engine.arrange([donut, probe]).subtract())).toBeCloseTo(30_000, 1);
  });
});

describe('BooleanEngine — faces() / buildShape()', () => {
  it('faces() enumerates the 3 atomic regions', () => {
    const faces = engine.arrange([single(A()), single(B())]).faces();
    expect(faces.length).toBe(3);
    const areas = faces.map((f) => absArea(f[0]!)).sort((a, b) => a - b);
    expect(areas[0]!).toBeCloseTo(2500, 1); // overlap
    expect(areas[1]!).toBeCloseTo(7500, 1);
    expect(areas[2]!).toBeCloseTo(7500, 1);
  });

  it('buildShape() over all faces reconstructs the union', () => {
    const arr = engine.arrange([single(A()), single(B())]);
    const merged = arr.buildShape([0, 1, 2]);
    expect(netArea(merged)).toBeCloseTo(17500, 1);
  });

  it('buildShape() over one face returns just that region', () => {
    const arr = engine.arrange([single(A()), single(B())]);
    const faces = arr.faces();
    // The overlap face has the smallest area; find its index and rebuild it.
    const overlapIdx = faces.findIndex((f) => Math.abs(absArea(f[0]!) - 2500) < 1);
    const shape = arr.buildShape([overlapIdx]);
    expect(netArea(shape)).toBeCloseTo(2500, 1);
  });

  it('keeps faces() indices valid for buildShape() when faces are sliver-dropped', async () => {
    // path-bool indexes its OWN face list, so dropping a sliver renumbers ours
    // and buildShape() must translate back. Three overlapping strips give
    // path-bool the face order [500, 500, 8000, 1500, 4500]: a 600 threshold
    // drops the two leading ones, shifting every surviving index by 2. The
    // three survivors have distinct areas, so an untranslated index cannot
    // coincidentally match.
    const eng = await createBooleanEngine({ sliverArea: 600 });
    const arr = eng.arrange([
      single(rectRing(0, 0, 100, 10)),
      single(rectRing(0, 5, 100, 100)),
      single(rectRing(0, 90, 100, 60)),
    ]);
    const faces = arr.faces();
    expect(faces.map((f) => Math.round(netArea(f)))).toEqual([8000, 1500, 4500]);
    faces.forEach((face, i) => {
      expect(netArea(arr.buildShape([i]))).toBeCloseTo(netArea(face), 1);
    });
  });

  it('rejects a face index that is out of range instead of rebuilding the wrong shape', () => {
    const arr = engine.arrange([single(A()), single(B())]);
    expect(() => arr.buildShape([99])).toThrow(RangeError);
  });
});

describe('BooleanEngine — curve-native inputs', () => {
  // Every other fixture here is an axis-aligned rectangle, which exercises none
  // of path-bool's curve arithmetic. This is the area invariant named as swap
  // trigger T1 in engine.ts: if curve booleans go wrong, it fails here first.
  it('preserves area(A∪B) + area(A∩B) = area(A) + area(B) for two circles', () => {
    const left = circleRing(0, 0, 20);
    const right = circleRing(25, 0, 20);
    const solo = Math.abs(ringSignedArea(left)) + Math.abs(ringSignedArea(right));

    const union = netArea(engine.arrange([single(left), single(right)]).unite());
    const overlap = netArea(engine.arrange([single(left), single(right)]).intersect());

    expect(overlap).toBeGreaterThan(0); // the circles really do overlap
    expect((union + overlap) / solo).toBeCloseTo(1, 3); // well inside the 0.1% T1 bar
  });

  it('returns curved segments, not a polygonal approximation', () => {
    const rings = engine
      .arrange([single(circleRing(0, 0, 20)), single(circleRing(25, 0, 20))])
      .unite();
    expect(rings).toHaveLength(1);
    const curved = rings[0]!.filter((c) => c.c1.x !== c.p0.x || c.c1.y !== c.p0.y);
    expect(curved.length).toBeGreaterThan(0);
  });
});

describe('BooleanEngine — known limits', () => {
  it('returns corner-touching lobes as ONE multi-lobe ring, areas adding', () => {
    // Two squares meeting at exactly one point produce no positional break, so
    // pathToRings cannot separate them (documented on pathToRings). Pinning the
    // real behaviour: the lobes share a winding, so nothing cancels to zero and
    // nothing is lost to the sliver filter — but the ring is not simple.
    const rings = engine
      .arrange([single(rectRing(0, 0, 10, 10)), single(rectRing(10, 10, 10, 10))])
      .unite();
    expect(rings).toHaveLength(1);
    expect(rings[0]!.length).toBe(8);
    expect(netArea(rings)).toBeCloseTo(200, 6);
  });
});

// ── The millimetre tolerance regime ─────────────────────────────────────────
//
// These are the tests that make the mm retune real rather than a comment. If
// someone re-copies pgen's pixel-space numbers, or bumps path-bool and its
// internal EPS.point moves, this block fails.

describe('BooleanEngine — millimetre tolerance regime', () => {
  it('pins the documented default tolerance set (mm / mm²)', () => {
    expect(DEFAULT_MM_EPSILONS).toEqual({
      snap: 1e-4, // 0.1 µm
      sliverArea: 1e-6, // 1 µm²
      point: 1e-6, // 1 nm — mirrors path-bool's unit-blind EPS.point
    });
    // The snap grid must stay well ABOVE path-bool's own point epsilon, or
    // snapped-apart vertices land inside the tolerance it adjudicates with.
    expect(DEFAULT_MM_EPSILONS.snap / DEFAULT_MM_EPSILONS.point).toBeGreaterThanOrEqual(100);
    // ...and a quad degenerate at the snap grid (area snap²) must not survive
    // the sliver filter, or the grid's own quantization becomes a face.
    expect(DEFAULT_MM_EPSILONS.snap ** 2).toBeLessThan(DEFAULT_MM_EPSILONS.sliverArea);
  });

  it('keeps a 10 µm feature — 100× above the sliver threshold', () => {
    // 0.01mm × 0.01mm overlap = 1e-4 mm², already 10× finer than anything a
    // fab can make, and it must still come through.
    const rings = engine
      .arrange([single(rectRing(0, 0, 1, 1)), single(rectRing(0.99, 0.99, 1, 1))])
      .intersect();
    expect(rings).toHaveLength(1);
    expect(netArea(rings)).toBeCloseTo(1e-4, 8);
  });

  it('drops a 0.1 µm sliver — 100× below the sliver threshold', () => {
    // 1e-4mm × 1e-4mm overlap = 1e-8 mm². Physically nonexistent; both corners
    // sit exactly on the snap grid, so this measures the sliver filter and not
    // a snapping side effect.
    const rings = engine
      .arrange([single(rectRing(0, 0, 1, 1)), single(rectRing(0.9999, 0.9999, 1, 1))])
      .intersect();
    expect(rings).toEqual([]);
  });

  it('snaps sub-grid coordinate noise away before the op', () => {
    // Two rects a third of the snap grid apart: after snapping they are the
    // same rect, so uniting them yields one ring of exactly one rect's area
    // (not a hairline seam ring).
    const noise = DEFAULT_MM_EPSILONS.snap / 3;
    const rings = engine
      .arrange([single(rectRing(0, 0, 10, 10)), single(rectRing(noise, noise, 10, 10))])
      .unite();
    expect(rings).toHaveLength(1);
    expect(netArea(rings)).toBeCloseTo(100, 6);
  });

  // A degenerate tolerance or coordinate does not throw anywhere inside
  // path-bool — it just yields nothing, which in this pipeline is
  // indistinguishable from "the boolean legitimately found nothing". For a
  // fabrication tool that is the worst failure mode there is, so both are
  // rejected at the boundary.
  it.each([
    ['sliverArea', NaN],
    ['point', NaN],
    ['snap', NaN],
    ['snap', Infinity],
    ['sliverArea', -1],
  ] as const)('rejects a degenerate %s of %p', async (key, value) => {
    await expect(createBooleanEngine({ [key]: value })).rejects.toThrow(RangeError);
  });

  it('rejects a non-finite input coordinate rather than returning nothing', () => {
    const broken = rectRing(0, 0, 10, 10);
    broken[0]!.p0 = { x: Number.NaN, y: 0 };
    expect(() => engine.arrange([single(broken)]).unite()).toThrow(/non-finite coordinate/);
  });

  it('accepts snap: 0 as an explicit "do not snap" request', async () => {
    const eng = await createBooleanEngine({ snap: 0 });
    expect(eng.epsilons.snap).toBe(0);
    // Well-separated inputs need no snapping, so this still works normally.
    const rings = eng
      .arrange([single(rectRing(0, 0, 10, 10)), single(rectRing(5, 5, 10, 10))])
      .unite();
    expect(netArea(rings)).toBeCloseTo(175, 6);
  });

  it('is what makes near-coincident vertices survivable at all', async () => {
    // The case for a nonzero snap grid, demonstrated rather than asserted. Two
    // rects offset by 1e-5 mm — far below anything fabricable, the kind of gap
    // float error leaves behind — unite cleanly under the default grid. Hand
    // path-bool the same input unsnapped and it fails outright inside its own
    // arrangement code. (That throw is path-bool 1.0.0 behaviour; if a bump
    // makes it robust here this test flips, which is itself worth knowing.)
    const near = () => [single(rectRing(0, 0, 10, 10)), single(rectRing(1e-5, 1e-5, 10, 10))];
    expect(netArea(engine.arrange(near()).unite())).toBeCloseTo(100, 6);

    const unsnapped = await createBooleanEngine({ snap: 0 });
    expect(() => unsnapped.arrange(near()).unite()).toThrow();
  });

  it('honours a caller-supplied sliverArea override', async () => {
    // Raise the threshold above the 2500 mm² overlap face; faces() keeps only
    // the two 7500 mm² wings, proving the one-knob sliver filter is wired
    // through rather than hardcoded.
    const eng = await createBooleanEngine({ sliverArea: 5000 });
    const faces = eng.arrange([single(A()), single(B())]).faces();
    expect(faces.length).toBe(2);
    for (const f of faces) expect(absArea(f[0]!)).toBeGreaterThanOrEqual(5000);
  });
});

describe('BooleanEngine — segment intersection helper', () => {
  it('finds the crossing of a horizontal and a vertical segment', () => {
    const horiz: KernelCubic = line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const vert: KernelCubic = line({ x: 50, y: -50 }, { x: 50, y: 50 });
    const hits = engine.segmentIntersection(horiz, vert);
    expect(hits.length).toBe(1);
    expect(hits[0]!.t0).toBeCloseTo(0.5, 3);
    expect(hits[0]!.t1).toBeCloseTo(0.5, 3);
  });

  it('returns cubic parameters for an asymmetric crossing between straight cubics', () => {
    const horiz: KernelCubic = line({ x: 0, y: 0 }, { x: 100, y: 0 });
    const vert: KernelCubic = line({ x: 25, y: -30 }, { x: 25, y: 70 });

    const hits = engine.segmentIntersection(horiz, vert);
    expect(hits).toHaveLength(1);

    const onHoriz = sampleCubicAt(horiz, hits[0]!.t0);
    const onVert = sampleCubicAt(vert, hits[0]!.t1);
    expect(onHoriz.x).toBeCloseTo(25, 8);
    expect(onHoriz.y).toBeCloseTo(0, 8);
    expect(onVert.x).toBeCloseTo(25, 8);
    expect(onVert.y).toBeCloseTo(0, 8);
  });

  it('inverts the chord fraction for a line-like cubic with nonstandard controls', () => {
    const horiz: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 10, y: 0 },
      c2: { x: 90, y: 0 },
      p3: { x: 100, y: 0 },
    };
    const vert: KernelCubic = line({ x: 25, y: -20 }, { x: 25, y: 80 });

    const hits = engine.segmentIntersection(horiz, vert);
    expect(hits).toHaveLength(1);

    const onHoriz = sampleCubicAt(horiz, hits[0]!.t0);
    const onVert = sampleCubicAt(vert, hits[0]!.t1);
    expect(onHoriz.x).toBeCloseTo(25, 8);
    expect(onHoriz.y).toBeCloseTo(0, 8);
    expect(onVert.x).toBeCloseTo(onHoriz.x, 8);
    expect(onVert.y).toBeCloseTo(onHoriz.y, 8);
  });

  it('normalizes only the line-like side of a true cubic crossing', () => {
    const curve: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 100 },
      c2: { x: 100, y: 100 },
      p3: { x: 100, y: 0 },
    };
    // curve(0.3) = (21.6, 63); the vertical line reaches y=63 at a different
    // cubic parameter than its path-bool linear fraction 0.63.
    const vert: KernelCubic = line({ x: 21.6, y: 0 }, { x: 21.6, y: 100 });

    const hits = engine.segmentIntersection(curve, vert);
    expect(hits).toHaveLength(1);

    const onCurve = sampleCubicAt(curve, hits[0]!.t0);
    const onLine = sampleCubicAt(vert, hits[0]!.t1);
    expect(hits[0]!.t0).toBeCloseTo(0.3, 6);
    expect(onCurve.x).toBeCloseTo(21.6, 6);
    expect(onCurve.y).toBeCloseTo(63, 6);
    expect(onLine.x).toBeCloseTo(onCurve.x, 6);
    expect(onLine.y).toBeCloseTo(onCurve.y, 6);
  });

  it('returns no intersection for disjoint segments', () => {
    const a: KernelCubic = line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b: KernelCubic = line({ x: 0, y: 100 }, { x: 10, y: 100 });
    expect(engine.segmentIntersection(a, b).length).toBe(0);
  });
});

describe('BooleanEngine — self-intersection helper', () => {
  it('finds the two parameters of a self-crossing cubic', () => {
    // Control polygon crosses over itself, so the curve loops through
    // (100, 42.857) twice.
    const loop: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 300, y: 100 },
      c2: { x: -100, y: 100 },
      p3: { x: 200, y: 0 },
    };
    const hit = engine.cubicSelfIntersection(loop);
    expect(hit).not.toBeNull();
    const [t0, t1] = hit!;
    expect(t0).not.toBeCloseTo(t1, 3);
    const a = sampleCubicAt(loop, t0);
    const b = sampleCubicAt(loop, t1);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  });

  it('returns null for a simple arc', () => {
    const arc: KernelCubic = {
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 10 },
      c2: { x: 10, y: 10 },
      p3: { x: 10, y: 0 },
    };
    expect(engine.cubicSelfIntersection(arc)).toBeNull();
  });
});

// path-bool must stay OUT of the eager bundle. A build-output assertion would
// need a full production build (out of scope here), so this guards the one
// source-level property that decides it: across EVERY kernel module, the only
// static reference to `path-bool` is type-only (erased at compile time), and
// the value form is a dynamic import().
describe('path-bool is imported lazily', () => {
  // Comments are stripped first — the file headers talk *about* import('path-bool'),
  // and matching prose would make these assertions pass with the real call deleted.
  const sourceOf = (file: string): string =>
    readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  // Matches a whole `import …`/`export … from 'path-bool'` statement, including
  // multi-line forms and re-exports. The inner guard stops it spanning back over
  // an earlier `from`, so each match is one statement.
  const staticSpecifier =
    /(?:^|\n)\s*(?:import|export)\b(?:(?!\bfrom\b)[\s\S])*?\bfrom\s*['"]path-bool['"]/g;
  const nonTypeStatics = (src: string) =>
    (src.match(staticSpecifier) ?? [])
      .map((s) => s.trim())
      .filter((s) => !/^(?:import|export)\s+type\b/.test(s));

  // Negative control: proves the matcher above actually catches what it claims,
  // so a green run means "no static import" and not "regex silently matches nothing".
  it('detects a static value import when one is present', () => {
    expect(nonTypeStatics(`import { PathBoolean } from 'path-bool';`)).toHaveLength(1);
    expect(nonTypeStatics(`import {\n  PathBoolean,\n} from "path-bool";`)).toHaveLength(1);
    expect(nonTypeStatics(`export { PathBoolean } from 'path-bool';`)).toHaveLength(1);
    expect(nonTypeStatics(`import type { Path } from 'path-bool';`)).toEqual([]);
  });

  it.each(['engine.ts', 'types.ts', 'geometry.ts', 'index.ts'])(
    '%s has no static value import or re-export of path-bool',
    (file) => {
      expect(nonTypeStatics(sourceOf(file))).toEqual([]);
    },
  );

  it('loads path-bool through a dynamic import() in real code, not a comment', () => {
    expect(sourceOf('engine.ts')).toMatch(/import\(\s*['"]path-bool['"]\s*\)/);
  });
});
