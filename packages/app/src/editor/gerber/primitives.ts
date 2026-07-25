/**
 * Small cubic-ring constructors shared by the extractor, the stroker and the
 * panel/profile geometry. There is no line primitive in the kernel — a
 * straight edge is a degenerate cubic (`c1 === p0`, `c2 === p3`) — so every
 * polygon built here is a ring of those.
 */

import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';
import { DEFAULT_MM_EPSILONS } from '../geometry-kernel';

export function degenerateCubic(p0: KernelPoint, p3: KernelPoint): KernelCubic {
  return { p0, c1: p0, c2: p3, p3 };
}

/** A closed cubic ring through the given polygon vertices (implicitly closed). */
export function polygonToRing(points: readonly KernelPoint[]): KernelRing {
  if (points.length < 3) return [];
  const ring: KernelRing = [];
  for (let i = 0; i < points.length; i++) {
    ring.push(degenerateCubic(points[i], points[(i + 1) % points.length]));
  }
  return ring;
}

/**
 * An axis-aligned rectangle as a ring. Traversed top-left → top-right →
 * bottom-right → bottom-left, which is a POSITIVE shoelace signed area in
 * y-down document space — Decision 0.2's outer-ring sign.
 */
export function rectToRing(x: number, y: number, width: number, height: number): KernelRing {
  return polygonToRing([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

function vertexKey(p: KernelPoint): string {
  const grid = DEFAULT_MM_EPSILONS.point;
  return `${Math.round(p.x / grid)},${Math.round(p.y / grid)}`;
}

/**
 * Split a ring that touches itself at a point into its separate lobes.
 *
 * Two same-material shapes meeting at exactly one corner come back from the
 * kernel as ONE run tracing both lobes with the shared vertex repeated — the
 * geometry-kernel README pins that as a KNOWN LIMIT ("path-bool leaves no
 * positional break to split on … a consumer that must treat each lobe
 * separately has to split on repeated vertices itself"). Left joined, such a
 * ring is not simple, which breaks three things at once: Decision 0's `IrRing`
 * contract, `ringInteriorPoint`'s convex-topmost-vertex argument (so hole
 * containment can be misread), and the writer's G36 contour, which the Gerber
 * spec requires to be non-self-intersecting.
 *
 * Repeat-vertex splitting is exact rather than heuristic: the walk closes a
 * lobe the moment it returns to a vertex it has already stood on.
 */
export function splitPointTouchingLobes(ring: KernelRing): KernelRing[] {
  if (ring.length < 2) return ring.length > 0 ? [ring] : [];

  const lobes: KernelRing[] = [];
  const walk: KernelCubic[] = [];
  // vertex key → the walk length at which that vertex was the current end
  const visited = new Map<string, number>([[vertexKey(ring[0].p0), 0]]);

  for (const cubic of ring) {
    walk.push(cubic);
    const key = vertexKey(cubic.p3);
    const at = visited.get(key);
    if (at === undefined) {
      visited.set(key, walk.length);
      continue;
    }
    const lobe = walk.splice(at);
    if (lobe.length >= 2) lobes.push(lobe);
    for (const [seen, index] of [...visited]) {
      if (index > at) visited.delete(seen);
    }
  }
  if (walk.length >= 2) lobes.push(walk);

  // Never lose geometry: a ring whose every lobe is degenerate stays whole.
  return lobes.length > 0 ? lobes : [ring];
}
