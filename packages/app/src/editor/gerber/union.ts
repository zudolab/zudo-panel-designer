/**
 * Scalable union of many kernel inputs.
 *
 * A pattern layer is the only thing in this pipeline that hands the boolean
 * kernel thousands of operands at once: `asanoha` at default parameters on a
 * full-panel square issues 5,200 `stroke()` calls, each of which the stroker
 * turns into its own `KernelInput` (separate operands are mandatory — path-bool
 * only unions ACROSS inputs). One `arrange()` over that many operands is not
 * merely slow: measured on path-bool 1.0.0, 500 operands take ~0.6 s, 2,000
 * take ~2.6 s, and 5,000 exhaust the default V8 heap outright.
 *
 * Two reductions fix it, in this order, and the first is as much about
 * correctness as about speed:
 *
 *  1. **Connected components by bounding box, with a margin.** Operands whose
 *     boxes do not overlap by more than the snap grid cannot need uniting, so
 *     their results simply concatenate. The margin is what keeps merely
 *     ADJACENT operands — a tile lattice, a checkerboard, a shape and the tab
 *     growing off its edge — out of a shared arrangement, which is where
 *     path-bool mis-resolves exact coincidence (`kernel-limits.test.ts` pins a
 *     nine-operand reproduction). Most generators are disjoint motifs and skip
 *     the boolean engine almost entirely.
 *  2. **Chunked hierarchical union** inside a component too large for one
 *     arrangement: unite in small batches, feed each batch's resolved rings
 *     back as one operand, repeat. Bounded memory, and the arrangement never
 *     sees more than `CHUNK` operands.
 *
 * Feeding a batch result back as ONE compound operand is only sound because it
 * is resolved: its rings bound a planar set, so no two of them share a
 * collinear edge. Unresolved contours must NOT be packed that way — path-bool
 * mis-resolves collinear overlap inside a single compound input (two 10 mm
 * squares offset by 5 mm come back as their 50 mm² intersection instead of
 * their 150 mm² union), which is why `pattern-source.ts` keeps a generator's
 * own contours in separate operands.
 *
 * The result is disjoint but not fully MERGED: two abutting motifs stay two
 * regions. Decision 0.3 asks for disjoint regions, the writer emits them as an
 * ordered painter's stream, and two G36 contours sharing an exact edge are one
 * continuous piece of copper on the board.
 */

import type { BooleanEngine, KernelInput, KernelPoint, KernelRing } from '../geometry-kernel';

/** Operands per arrangement. Measured sweet spot: big enough to collapse the
 *  tree fast, small enough that one arrangement stays cheap. */
const CHUNK = 64;

export interface Bbox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Control-point bounding box. A cubic is contained in the convex hull of its
 * control points, so this bounds the curve — conservatively, which is the
 * direction that keeps the reduction exact.
 */
export function ringBbox(ring: KernelRing): Bbox | null {
  if (ring.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = (p: KernelPoint): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const c of ring) {
    eat(c.p0);
    eat(c.c1);
    eat(c.c2);
    eat(c.p3);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function inputBbox(input: KernelInput): Bbox | null {
  let box: Bbox | null = null;
  for (const ring of input.contours) {
    const b = ringBbox(ring);
    if (!b) continue;
    box = box === null ? b : mergeBbox(box, b);
  }
  return box;
}

export function mergeBbox(a: Bbox, b: Bbox): Bbox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Inclusive: boxes that merely touch count as overlapping. */
export function bboxesOverlap(a: Bbox, b: Bbox, slack = 0): boolean {
  return (
    a.minX - slack <= b.maxX &&
    b.minX - slack <= a.maxX &&
    a.minY - slack <= b.maxY &&
    b.minY - slack <= a.maxY
  );
}

/**
 * Strict: boxes that only touch do NOT count. Used for "can this operand
 * contribute area to the square", where the answer for a touching box is no —
 * and where it matters, because path-bool THROWS
 * (`Cannot read properties of undefined (reading 'winding')`) when asked to
 * intersect two rectangles that share an edge and nothing else. A tile lattice
 * lands on the square's edge constantly, so this is the common case, not a
 * corner one.
 */
export function bboxesOverlapStrictly(a: Bbox, b: Bbox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

class DisjointSet {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    let walk = i;
    while (this.parent[walk] !== root) {
      const next = this.parent[walk];
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Group indices whose boxes overlap by MORE than `margin`, by an x-sweep: sort
 * by `minX`, keep the still-open boxes active, and only compare against those.
 * Degrades to O(n²) when everything spans the full width (a full-panel stripe
 * pattern), which is the case where a single component was the answer anyway.
 *
 * The margin is what makes merely-ADJACENT operands separate components, and
 * that is the point rather than a tuning knob. path-bool resolves genuinely
 * overlapping geometry correctly, but exact coincidence defeats it: a
 * checkerboard of corner-touching tiles with triangular tabs whose edges lie
 * exactly along the tiles' edges — `houndstooth-tooth-grid`, verified down to a
 * nine-operand reproduction — unions to 388.8 mm² where the true answer is
 * 334.08 mm², filling holes that should be open. Adjacent operands do not need
 * uniting at all: neither contains the other, so `ringsToRegions` classifies
 * both as their own region and the artwork is identical. Keeping them apart is
 * therefore free correctness, not a compromise.
 */
export function connectedComponents(boxes: readonly Bbox[], margin: number): number[][] {
  const groups = new DisjointSet(boxes.length);
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].minX - boxes[b].minX);
  const active: number[] = [];
  const overlapsBeyondMargin = (a: Bbox, b: Bbox): boolean =>
    a.minX + margin < b.maxX &&
    b.minX + margin < a.maxX &&
    a.minY + margin < b.maxY &&
    b.minY + margin < a.maxY;
  for (const id of order) {
    const box = boxes[id];
    let write = 0;
    for (let read = 0; read < active.length; read++) {
      const other = active[read];
      if (boxes[other].maxX <= box.minX + margin) continue;
      active[write++] = other;
      if (overlapsBeyondMargin(box, boxes[other])) groups.union(other, id);
    }
    active.length = write;
    active.push(id);
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const root = groups.find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(i);
    else byRoot.set(root, [i]);
  }
  return [...byRoot.values()];
}

/**
 * Every operand goes through the arrangement AT LEAST ONCE, including a batch
 * of one. Handing an operand back untouched would be a silent correctness bug,
 * not an optimisation: a `KernelInput` is a contour list plus a FILL RULE, and
 * its rings only become the region it denotes once that rule has been applied.
 * `via-grid-array`'s annulus is the case that makes it obvious — one even-odd
 * contour tracing the outer circle, a radial connector and the inner circle,
 * whose raw rings are not a shape at all.
 */
function resolveBatch(engine: BooleanEngine, batch: readonly KernelInput[]): KernelRing[] {
  return engine.arrange(batch.map((b) => ({ ...b }))).unite();
}

function unionComponent(engine: BooleanEngine, inputs: readonly KernelInput[]): KernelRing[] {
  let level: KernelInput[] = [...inputs];
  for (;;) {
    const next: KernelInput[] = [];
    for (let i = 0; i < level.length; i += CHUNK) {
      const rings = resolveBatch(engine, level.slice(i, i + CHUNK));
      if (rings.length > 0) next.push({ contours: rings, fillRule: 'nonzero' });
    }
    if (next.length <= 1) return next[0]?.contours ?? [];
    level = next;
  }
}

/**
 * Union every operand into a resolved, PAIRWISE-DISJOINT ring set (outer rings
 * and their holes, with the kernel's own winding).
 *
 * Each component is resolved in its OWN arrangement and the results are simply
 * concatenated. Components never overlap, so concatenation is the union — and
 * mixing components into a shared arrangement is precisely what has to be
 * avoided, because they are separate exactly when their geometry is adjacent
 * rather than overlapping, which is the coincidence path-bool mis-resolves.
 *
 * The output is not fully MERGED — two abutting motifs stay two regions rather
 * than becoming one — and that is fine at every point downstream: Decision 0.3
 * asks for disjoint regions, the writer emits them as an ordered painter's
 * stream, and two G36 contours sharing an exact edge are one continuous piece
 * of copper on the board.
 */
export function unionInputs(engine: BooleanEngine, inputs: readonly KernelInput[]): KernelRing[] {
  return unionComponents(engine, inputs).flat();
}

/**
 * The same union, kept SPLIT by component instead of flattened.
 *
 * Downstream this is the difference between handing the orchestrator one
 * compound operand holding every ring the layer produced and handing it one
 * operand per disjoint piece. The former is exactly the shape path-bool
 * mis-resolves (`kernel-limits.test.ts`), so the split is not cosmetic: it
 * carries the separation this module worked to establish through
 * `buildGerberIr`'s own `arrange()` rather than throwing it away at the
 * boundary.
 */
export function unionComponents(
  engine: BooleanEngine,
  inputs: readonly KernelInput[],
): KernelRing[][] {
  const kept: KernelInput[] = [];
  const boxes: Bbox[] = [];
  for (const input of inputs) {
    if (input.contours.length === 0) continue;
    const box = inputBbox(input);
    if (!box) continue;
    kept.push(input);
    boxes.push(box);
  }
  if (kept.length === 0) return [];

  const out: KernelRing[][] = [];
  for (const component of connectedComponents(boxes, engine.epsilons.snap)) {
    const operands = component.map((i) => kept[i]);
    const rings =
      operands.length > CHUNK ? unionComponent(engine, operands) : resolveBatch(engine, operands);
    if (rings.length > 0) out.push(rings);
  }
  return out;
}
