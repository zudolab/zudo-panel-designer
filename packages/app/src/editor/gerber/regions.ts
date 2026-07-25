/**
 * Kernel rings → `IrRegion[]` (Decision 0.2 / 0.3).
 *
 * The kernel hands back a flat list of boundary rings with no outer/hole
 * grouping — "grouping rings into outer+hole regions is the consumer's job"
 * (`types.ts`). This module does that grouping, pins the winding by shoelace
 * SIGN in document space (never by the words clockwise/counter-clockwise,
 * which invert under +y-down), promotes islands to their own regions, and
 * produces the deterministic order #210's byte-exact fixtures need.
 */

import type { KernelPoint, KernelRing } from '../geometry-kernel';
import { flattenRing, pointInPolygon, ringInteriorPoint } from '../geometry-kernel';
import { flattenRingAdaptive, polygonSignedArea } from './flatten';
import { splitPointTouchingLobes } from './primitives';
import type { IrPoint, IrRegion, IrRing } from './ir';
import type { IrTolerance } from './tolerance';

interface ClassifiedRing {
  readonly index: number;
  readonly poly: KernelPoint[];
  readonly interior: KernelPoint;
  depth: number;
}

function orient(ring: IrPoint[], wantPositive: boolean): IrRing {
  const positive = polygonSignedArea(ring) > 0;
  return positive === wantPositive ? ring : [...ring].reverse();
}

function ringMin(ring: IrRing): { x: number; y: number } {
  let x = Infinity;
  let y = Infinity;
  for (const p of ring) {
    if (p.x < x) x = p.x;
    if (p.y < y) y = p.y;
  }
  return { x, y };
}

/**
 * Group a disjoint set of boundary rings into regions.
 *
 * Containment depth decides everything: an even depth is an `IrRegion.outer`,
 * an odd depth is one of its holes, and an island inside a hole comes back at
 * depth 2 as its own later region — there is no hole-of-a-hole (Decision 0.3).
 *
 * Classification runs on the CUBIC rings via the kernel's own
 * `ringInteriorPoint`/`pointInPolygon`; only the emitted geometry is adaptively
 * flattened, so the flattener is never in the containment decision.
 */
export function ringsToRegions(rings: readonly KernelRing[], tolerance: IrTolerance): IrRegion[] {
  // Two shapes meeting at exactly one corner arrive as a single non-simple run
  // (see `splitPointTouchingLobes`). Split before anything reads a ring's
  // interior, because the containment test is only valid on simple rings.
  const simple = rings.flatMap((ring) => (ring.length > 0 ? splitPointTouchingLobes(ring) : []));

  const classified: ClassifiedRing[] = [];
  for (let i = 0; i < simple.length; i++) {
    classified.push({
      index: i,
      poly: flattenRing(simple[i]),
      interior: ringInteriorPoint(simple[i]),
      depth: 0,
    });
  }

  for (const a of classified) {
    for (const b of classified) {
      if (a === b) continue;
      if (pointInPolygon(a.interior, b.poly)) a.depth++;
    }
  }

  // depth 0, 2, 4 … are regions; 1, 3, 5 … are holes of the deepest ring one
  // level up that contains them (unique, since same-depth rings are disjoint).
  const regionByRingIndex = new Map<number, { outer: IrRing; holes: IrRing[]; depth: number }>();
  for (const c of classified) {
    if (c.depth % 2 !== 0) continue;
    const outer = flattenRingAdaptive(simple[c.index], tolerance.flattenMm, tolerance.minSegmentMm);
    if (outer.length < 3) continue;
    regionByRingIndex.set(c.index, {
      outer: orient(outer, true),
      holes: [],
      depth: c.depth,
    });
  }

  for (const c of classified) {
    if (c.depth % 2 === 0) continue;
    const parent = classified.find(
      (p) => p.depth === c.depth - 1 && p !== c && pointInPolygon(c.interior, p.poly),
    );
    const region = parent ? regionByRingIndex.get(parent.index) : undefined;
    if (!region) continue;
    const hole = flattenRingAdaptive(simple[c.index], tolerance.flattenMm, tolerance.minSegmentMm);
    if (hole.length < 3) continue;
    region.holes.push(orient(hole, false));
  }

  // Deterministic order (Decision 0.3): nesting depth ascending, then the
  // outer ring's min(y), then min(x), then its first vertex. A region inside
  // another's hole therefore always lands later, which is what keeps Gerber's
  // ordered image stream from erasing an island.
  return [...regionByRingIndex.values()]
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      const ma = ringMin(a.outer);
      const mb = ringMin(b.outer);
      if (ma.y !== mb.y) return ma.y - mb.y;
      if (ma.x !== mb.x) return ma.x - mb.x;
      if (a.outer[0].x !== b.outer[0].x) return a.outer[0].x - b.outer[0].x;
      return a.outer[0].y - b.outer[0].y;
    })
    .map((r) => ({ outer: r.outer, holes: r.holes }));
}

/** Total emitted vertices, for the Decision 8 complexity ceiling. */
export function countRegionVertices(regions: readonly IrRegion[]): number {
  let total = 0;
  for (const region of regions) {
    total += region.outer.length;
    for (const hole of region.holes) total += hole.length;
  }
  return total;
}
