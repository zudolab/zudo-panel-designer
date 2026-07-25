/**
 * Path Finder — input style resolution.
 *
 * Reads one eligible leaf's paint into the canonical {@link ResolvedInputStyle}
 * the result specs carry. WHICH input's style a given op adopts (topmost /
 * backmost / per-face) is op policy and lives with each op.
 *
 * Deliberately absent, and not an oversight: pgen's gradient preflight. Its
 * `style.ts` threw on a non-solid fill and the panel rendered a blocked-reason
 * banner for it. zpd's fill is a `ColorIndex | null` — there is no gradient to
 * reject, so porting that branch would have added a permanently-dead code path
 * plus the UI affordance that reports it.
 */

import type { EligibleLeaf, ResolvedInputStyle } from './types';

export function resolveInputStyle(leaf: EligibleLeaf): ResolvedInputStyle {
  const layer = leaf.layer;
  if (layer.type === 'path') {
    return { fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth };
  }
  // A shape leaf has a single `color` and the renderer always fills with it
  // and never strokes it (renderer.ts's 'shape' case), so it resolves to a
  // fill-only style — not to a stroke of the same colour.
  return { fill: layer.color, stroke: null, strokeWidth: 0 };
}
