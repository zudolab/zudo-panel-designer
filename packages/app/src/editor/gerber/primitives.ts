/**
 * Small cubic-ring constructors shared by the extractor, the stroker and the
 * panel/profile geometry. There is no line primitive in the kernel — a
 * straight edge is a degenerate cubic (`c1 === p0`, `c2 === p3`) — so every
 * polygon built here is a ring of those.
 */

import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';

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
