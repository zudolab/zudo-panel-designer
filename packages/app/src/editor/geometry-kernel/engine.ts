/**
 * Geometry kernel — boolean engine adapter over `path-bool` (PathBool.js
 * v1.0.0, MIT, Adam Platkevič). The standalone port of Graphite's boolean
 * kernel: planar arrangement + major/minor dual-graph decomposition — NOT
 * clipper-lib, NOT paper.js.
 *
 * The adapter surface ({@link BooleanEngine} in `types.ts`) is deliberately
 * engine-agnostic so paper.js can substitute. path-bool is loaded LAZILY via
 * `import('path-bool')` so Vite carves it into its own chunk instead of
 * growing the eager first-paint bundle. Its dist is a self-contained 104KB ESM
 * bundle with ZERO runtime imports (gl-matrix is bundled/tree-shaken away), so
 * there is no CJS/UMD or gl-matrix interop hazard.
 *
 * ── Graphite-port robustness (single tolerance regime) ──────────────────────
 * We apply the same two guards Graphite learned it needs, driven by ONE
 * {@link KernelEpsilons} config (never a second regime layered on path-bool's):
 *   1. INPUT snapping — round every input coordinate to `epsilons.snap` before
 *      constructing paths, so near-coincident vertices from independently
 *      authored shapes collapse to exact equality.
 *   2. SLIVER filtering — drop result faces/rings with `|area| < sliverArea`.
 *
 * ── paper.js fallback: NAMED trigger criteria ───────────────────────────────
 * Swap path-bool → paper.js if ANY of these is observed in practice:
 *   (T1) the area invariant `area(A∪B) + area(A∩B) == area(A) + area(B)` fails
 *        beyond ~0.1% relative for curve-native inputs (ellipses, handled
 *        blobs) after snapping — i.e. curve booleans are wrong, not just noisy;
 *   (T2) a boolean throws / hangs / returns empty for a NON-empty true result
 *        on realistic inputs (self-intersecting pen paths, near-tangent shapes)
 *        that paper.js handles;
 *   (T3) holes come back with inconsistent winding such that the
 *        reversed-winding invariant cannot be restored by area-sign
 *        normalization.
 */

import type { Path as PBPath } from 'path-bool';
import { cubicSignedArea } from './geometry';
import type {
  BooleanArrangement,
  BooleanEngine,
  KernelCubic,
  KernelEpsilons,
  KernelInput,
  KernelPoint,
  KernelRing,
  SegmentIntersection,
} from './types';

type PBModule = typeof import('path-bool');
type PBVec = [number, number];
type PBSeg = PBPath[number];
// path-bool exports `Path` but not the per-variant segment types, and
// `pathCubicSegmentSelfIntersection` takes the cubic variant specifically —
// recover it from the union rather than casting the mismatch away.
type PBCubicSeg = Extract<PBSeg, { 0: 'C' }>;

/**
 * path-bool's internal `EPS` (its `config.ts`) — NOT exported by the package,
 * so it is mirrored here for the segment-intersection helpers. This duplication
 * is deliberate: it is a copy of a dependency's private constant, not a stray
 * second definition of ours, and it CANNOT be replaced by an import. Verified
 * against path-bool@1.0.0's dist bundle; re-check on every dependency bump.
 */
const PB_EPSILONS = {
  point: 1e-6,
  linear: 1e-4,
  param: 1e-8,
  collinear: Number.MIN_VALUE * 64,
};

/** path-bool's private `NEARLY_LINEAR_EPS`; mirrored for the same reason. */
const PB_NEARLY_LINEAR_EPS = 1e-10;

/**
 * The default tolerance regime, in DOCUMENT MILLIMETRES.
 *
 * pgen's Pathfinder used `{snap: 1e-4, sliverArea: 1e-3, point: 1e-6}` in
 * composition *pixels*. zpd's document space is millimetres, so those numerals
 * mean physically different tolerances here — and the downstream consumer is a
 * PCB fabricator, where "physically different" means real artwork silently
 * dropped or merged. Every value below was therefore re-derived from a
 * fabrication or backend fact rather than carried over.
 *
 * Be precise about what that changed: `sliverArea` moved (1e-3 px² → 1e-6 mm²),
 * while `snap` and `point` land on the same numerals pgen used. That is a
 * coincidence of two independent derivations, not a copy — `point` is fixed by
 * path-bool and not ours to pick at all, and `snap` follows from `point` by the
 * ratio argument below. Re-deriving them is what makes them defensible in mm.
 *
 * `snap: 1e-4 mm` (0.1 µm)
 *   Lower bound: path-bool's `EPS.point` is a fixed 1e-6, and it is UNIT-BLIND
 *   — in mm space that is 1 nm. The snap grid has to sit comfortably ABOVE it
 *   (here 100×) so that after snapping, any two vertices are either bit-exactly
 *   equal or far enough apart that path-bool never has to adjudicate an
 *   "almost coincident" pair. That ratio, not the numeral, is what carried over
 *   from pgen.
 *   Upper bound: the smallest fabricable feature is ~0.1 mm (trace width /
 *   spacing), and layer-to-layer registration tolerance is ~±0.05 mm. 0.1 µm is
 *   1000× below the former and 500× below the latter, so snapping cannot move
 *   artwork by any amount a fab process could resolve.
 *   Headroom: float64 noise accumulated through document-scale transforms
 *   (panel ≤ ~500 mm, ulp ≈ 6e-14 mm) is ~8 orders of magnitude below the grid,
 *   so genuine "same point, different arithmetic path" vertices always collapse.
 *
 * `sliverArea: 1e-6 mm²` (1 µm²)
 *   A 10 µm × 10 µm feature — already 10× finer than anything fabricable — has
 *   area 1e-4 mm², i.e. 100× this threshold, so it survives. A 0.1 µm × 0.1 µm
 *   numerical sliver has area 1e-8 mm², i.e. 100× below it, so it is dropped.
 *   The threshold also sits 100× above the 1e-8 mm² area of a quad degenerate
 *   at the snap grid itself, so the grid's own quantization can never survive
 *   as a face. Both ends of that window are pinned by tests.
 *
 * `point: 1e-6 mm` (1 nm)
 *   Not a free choice — it MUST mirror path-bool's own `EPS.point`, or our
 *   pre/post steps would disagree with the arithmetic that produced the result.
 *   It happens to be a sane physical tolerance in mm space: 1 nm is exactly the
 *   quantum of the standard Gerber 4.6 mm coordinate format, and 5 orders of
 *   magnitude below the minimum feature size.
 */
export const DEFAULT_MM_EPSILONS: KernelEpsilons = {
  snap: 1e-4,
  sliverArea: 1e-6,
  point: PB_EPSILONS.point,
};

let modPromise: Promise<PBModule> | null = null;
function loadPathBool(): Promise<PBModule> {
  // Static specifier → Vite/Rollup carves this into a lazy chunk.
  return (modPromise ??= import('path-bool'));
}

const v = (p: KernelPoint): PBVec => [p.x, p.y];
const pt = (a: PBVec): KernelPoint => ({ x: a[0], y: a[1] });

function segStart(seg: PBSeg): PBVec {
  return seg[1];
}
function segEnd(seg: PBSeg): PBVec {
  switch (seg[0]) {
    case 'L':
      return seg[2];
    case 'C':
      return seg[4];
    case 'Q':
      return seg[3];
    default: // 'A'
      return seg[7];
  }
}

/** Convert one path-bool segment into one or more KernelCubics. */
function segToCubics(seg: PBSeg, mod: PBModule): KernelCubic[] {
  switch (seg[0]) {
    case 'L': {
      const p0 = pt(seg[1]);
      const p3 = pt(seg[2]);
      return [{ p0, c1: p0, c2: p3, p3 }];
    }
    case 'C':
      return [{ p0: pt(seg[1]), c1: pt(seg[2]), c2: pt(seg[3]), p3: pt(seg[4]) }];
    case 'Q': {
      // Elevate quadratic → cubic.
      const p0 = pt(seg[1]);
      const cp = pt(seg[2]);
      const p3 = pt(seg[3]);
      return [
        {
          p0,
          c1: { x: p0.x + (2 / 3) * (cp.x - p0.x), y: p0.y + (2 / 3) * (cp.y - p0.y) },
          c2: { x: p3.x + (2 / 3) * (cp.x - p3.x), y: p3.y + (2 / 3) * (cp.y - p3.y) },
          p3,
        },
      ];
    }
    default: {
      // 'A' — expand to cubics (or a single line) via path-bool's own helper.
      const cubics: PBSeg[] = mod.arcSegmentToCubics(seg);
      return cubics.flatMap((c) => segToCubics(c, mod));
    }
  }
}

/**
 * Split a path-bool result `Path` (a flat segment list whose rings are
 * separated by positional discontinuities) into connected KernelRings.
 *
 * KNOWN LIMIT — lobes that meet at a point are NOT separated. Two squares
 * touching at exactly one corner unite into a single 8-segment run with no
 * positional break, so this returns one `KernelRing` tracing both lobes.
 * Verified against path-bool 1.0.0: the lobes share a winding, so signed areas
 * add (200 for two 100mm² squares) and nothing is lost to the sliver filter —
 * but such a ring is not *simple*, so `ringInteriorPoint`'s convex-topmost-
 * vertex argument no longer applies to it. Consumers that must treat each lobe
 * separately have to split on repeated vertices themselves.
 */
function pathToRings(path: PBPath, point: number, mod: PBModule): KernelRing[] {
  const rings: KernelRing[] = [];
  let cur: KernelRing | null = null;
  let lastEnd: PBVec | null = null;
  const same = (a: PBVec, b: PBVec) =>
    Math.abs(a[0] - b[0]) <= point && Math.abs(a[1] - b[1]) <= point;

  for (const seg of path) {
    const start = segStart(seg);
    if (!cur || !lastEnd || !same(start, lastEnd)) {
      cur = [];
      rings.push(cur);
    }
    for (const cub of segToCubics(seg, mod)) cur.push(cub);
    lastEnd = segEnd(seg);
  }
  return rings;
}

function snapCoord(value: number, grid: number): number {
  // A NaN/Infinity coordinate does not blow up path-bool — it quietly yields
  // zero rings, which in this pipeline reads as "that artwork wasn't there".
  // Refuse it at the boundary instead, while we can still name the value.
  if (!Number.isFinite(value)) {
    throw new RangeError(`non-finite coordinate ${value} in kernel input`);
  }
  if (grid <= 0) return value; // snap deliberately disabled → pass through
  return Math.round(value / grid) * grid;
}

function ringToPBPath(ring: KernelRing, grid: number): PBPath {
  const s = (p: KernelPoint): PBVec => [snapCoord(p.x, grid), snapCoord(p.y, grid)];
  // Emit every edge as a cubic (degenerate = straight); mirrors the kernel's
  // no-line-primitive model and lets path-bool handle self-intersections.
  return ring.map((c): PBCubicSeg => ['C', s(c.p0), s(c.c1), s(c.c2), s(c.p3)]);
}

/**
 * Flatten one ordered compound input into path-bool's discontinuous `Path`.
 * Each contour is appended intact; its end→next-start positional break is the
 * subpath boundary path-bool understands, while all contours keep one input
 * identity and one fill rule.
 */
function contoursToPBPath(contours: KernelRing[], grid: number): PBPath {
  return contours.flatMap((contour) => ringToPBPath(contour, grid));
}

function pointLineDistance(point: KernelPoint, start: KernelPoint, end: KernelPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= PB_NEARLY_LINEAR_EPS * PB_NEARLY_LINEAR_EPS) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / Math.sqrt(lengthSquared);
}

/** Mirror path-bool's private `isNearlyLinearSegment` classification for cubics. */
function isPathBoolLineLike(cubic: KernelCubic): boolean {
  const dx = cubic.p3.x - cubic.p0.x;
  const dy = cubic.p3.y - cubic.p0.y;
  if (dx * dx + dy * dy <= PB_NEARLY_LINEAR_EPS * PB_NEARLY_LINEAR_EPS) return true;
  return (
    pointLineDistance(cubic.c1, cubic.p0, cubic.p3) <= PB_NEARLY_LINEAR_EPS &&
    pointLineDistance(cubic.c2, cubic.p0, cubic.p3) <= PB_NEARLY_LINEAR_EPS
  );
}

function sampleUnitCubic(c1: number, c2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t;
}

/**
 * Convert path-bool's endpoint-chord fraction for a line-like cubic back to
 * the parameter of the original cubic's own Bernstein parameterization.
 *
 * path-bool deliberately collapses nearly-linear cubics to `L(start, end)` and
 * therefore reports a linear fraction even when the source controls make its
 * cubic parameter non-linear. Handing that fraction straight back to a caller
 * that then evaluates the ORIGINAL cubic at it lands at the wrong physical
 * point — so this is a correctness fix, not a workaround. Projecting the
 * controls onto the endpoint chord gives a scalar cubic from 0→1; bisection
 * finds the parameter at the reported chord fraction. The sign-bracket form
 * stays valid for unusual collinear controls that make the scalar cubic
 * non-monotonic.
 */
function lineFractionToCubicParameter(cubic: KernelCubic, fraction: number): number {
  if (!Number.isFinite(fraction)) return fraction;
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 1;

  const dx = cubic.p3.x - cubic.p0.x;
  const dy = cubic.p3.y - cubic.p0.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= PB_NEARLY_LINEAR_EPS * PB_NEARLY_LINEAR_EPS) return fraction;

  const project = (point: KernelPoint): number =>
    ((point.x - cubic.p0.x) * dx + (point.y - cubic.p0.y) * dy) / lengthSquared;
  const c1 = project(cubic.c1);
  const c2 = project(cubic.c2);

  let lo = 0;
  let hi = 1;
  let fLo = -fraction;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fMid = sampleUnitCubic(c1, c2, mid) - fraction;
    if (fMid === 0) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

class Arrangement implements BooleanArrangement {
  constructor(
    private readonly mod: PBModule,
    private readonly pb: InstanceType<PBModule['PathBoolean']>,
    private readonly eps: KernelEpsilons,
  ) {}

  private notSliver(ring: KernelRing): boolean {
    let a = 0;
    for (const c of ring) a += cubicSignedArea(c);
    return Math.abs(a) >= this.eps.sliverArea;
  }

  private rings(paths: PBPath[]): KernelRing[] {
    return paths
      .flatMap((p) => pathToRings(p, this.eps.point, this.mod))
      .filter((r) => this.notSliver(r));
  }

  unite(): KernelRing[] {
    return this.rings(this.pb.get(this.mod.PathBooleanOperation.Union));
  }
  subtract(): KernelRing[] {
    return this.rings(this.pb.get(this.mod.PathBooleanOperation.Difference));
  }
  intersect(): KernelRing[] {
    return this.rings(this.pb.get(this.mod.PathBooleanOperation.Intersection));
  }
  exclude(): KernelRing[] {
    return this.rings(this.pb.get(this.mod.PathBooleanOperation.Exclusion));
  }

  /**
   * Sliver-filtered faces, each paired with its index in path-bool's OWN face
   * list. Dropping a sliver face renumbers our array, so `buildShape()` has to
   * translate back before calling through — path-bool indexes its raw list,
   * and a caller that passes a `faces()` index straight through would rebuild
   * the wrong region (silently, and more often the more slivers there are).
   * Computed once: `getFaces()` is the expensive part of an arrangement.
   */
  private keptFaces(): { rings: KernelRing[]; pbIndex: number }[] {
    return (this.faceCache ??= this.pb
      .getFaces()
      .map((face, pbIndex) => ({
        rings: pathToRings(face, this.eps.point, this.mod).filter((r) => this.notSliver(r)),
        pbIndex,
      }))
      .filter((face) => face.rings.length > 0));
  }
  private faceCache: { rings: KernelRing[]; pbIndex: number }[] | null = null;

  faces(): KernelRing[][] {
    return this.keptFaces().map((f) => f.rings);
  }

  buildShape(faceIndices: Iterable<number>): KernelRing[] {
    const kept = this.keptFaces();
    const pbIndices = [...faceIndices].map((i) => {
      const face = kept[i];
      // A stale or hand-rolled index is a caller bug, and silently returning
      // the wrong shape is the worst outcome for artwork — fail loudly.
      if (!face) throw new RangeError(`face index ${i} out of range (0..${kept.length - 1})`);
      return face.pbIndex;
    });
    return pathToRings(this.pb.buildShape(pbIndices), this.eps.point, this.mod).filter((r) =>
      this.notSliver(r),
    );
  }
}

class Engine implements BooleanEngine {
  constructor(
    private readonly mod: PBModule,
    readonly epsilons: KernelEpsilons,
  ) {}

  arrange(inputs: KernelInput[]): BooleanArrangement {
    const pbInputs = inputs.map((inp) => ({
      path: contoursToPBPath(inp.contours, this.epsilons.snap),
      fillRule: inp.fillRule === 'evenodd' ? this.mod.FillRule.EvenOdd : this.mod.FillRule.NonZero,
    }));
    const pb = new this.mod.PathBoolean(pbInputs);
    return new Arrangement(this.mod, pb, this.epsilons);
  }

  segmentIntersection(a: KernelCubic, b: KernelCubic): SegmentIntersection[] {
    const segA: PBCubicSeg = ['C', v(a.p0), v(a.c1), v(a.c2), v(a.p3)];
    const segB: PBCubicSeg = ['C', v(b.p0), v(b.c1), v(b.c2), v(b.p3)];
    const lineLikeA = isPathBoolLineLike(a);
    const lineLikeB = isPathBoolLineLike(b);
    return this.mod.pathSegmentIntersection(segA, segB, PB_EPSILONS).map(([t0, t1]) => ({
      t0: lineLikeA ? lineFractionToCubicParameter(a, t0) : t0,
      t1: lineLikeB ? lineFractionToCubicParameter(b, t1) : t1,
    }));
  }

  cubicSelfIntersection(c: KernelCubic): [number, number] | null {
    const seg: PBCubicSeg = ['C', v(c.p0), v(c.c1), v(c.c2), v(c.p3)];
    return this.mod.pathCubicSegmentSelfIntersection(seg);
  }
}

/**
 * A degenerate tolerance does not fail loudly downstream — a NaN `sliverArea`
 * makes every comparison false and silently discards the entire result, and a
 * NaN `point` shreds one ring into many. Both look exactly like "the boolean
 * found nothing". Validate here, where the bad value is still attributable.
 */
function validateEpsilons(eps: KernelEpsilons): KernelEpsilons {
  for (const key of ['snap', 'sliverArea', 'point'] as const) {
    const value = eps[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`epsilons.${key} must be a finite number >= 0, got ${value}`);
    }
  }
  return eps;
}

/**
 * Create the boolean engine, lazily importing `path-bool`. Optional tolerance
 * overrides are shallow-merged onto {@link DEFAULT_MM_EPSILONS} — pass them
 * only with a fabrication reason, since the defaults are what the rest of the
 * pipeline is tested against.
 */
export async function createBooleanEngine(
  epsilons?: Partial<KernelEpsilons>,
): Promise<BooleanEngine> {
  const merged = validateEpsilons({ ...DEFAULT_MM_EPSILONS, ...epsilons });
  const mod = await loadPathBool();
  return new Engine(mod, merged);
}
