/**
 * The two things every `LayerGeometrySource` needs to produce an
 * `IrLayerResult` (Decision 0.4).
 *
 * They live in their own module rather than in `extract.ts` because
 * `extract.ts` imports `text-outline.ts` at module scope (to build
 * `BUILTIN_GEOMETRY_SOURCES`). Having `text-outline.ts` import back would make
 * that a cycle whose failure depends on which module the bundler evaluates
 * first — `BUILTIN_GEOMETRY_SOURCES` reads `textGeometrySource` during
 * evaluation, so the wrong entry order is a TDZ ReferenceError, not a
 * lazily-resolved binding.
 */

import type { Layer } from '@zpd/core';
import type { KernelInput } from '../geometry-kernel';
import type { IrExtractContext, IrLayerResult, IrRegion } from './ir';
import { ringsToRegions } from './regions';

export function unsupportedLayer(
  layer: Layer,
  reason: Extract<IrLayerResult, { kind: 'unsupported' }>['reason'],
  detail?: string,
): Extract<IrLayerResult, { kind: 'unsupported' }> {
  return {
    kind: 'unsupported',
    layerId: layer.id,
    layerName: layer.name,
    reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * The `IrLayerResult` form Decision 0.4 pins, derived from cubic groups by
 * resolving them through the kernel and flattening. The orchestrator prefers
 * `extractCubics` (Decision 5 puts flattening last), so this path only runs for
 * a caller that consults a source directly.
 */
export async function groupsToRegions(
  groups: readonly KernelInput[],
  ctx: IrExtractContext,
): Promise<IrRegion[]> {
  if (groups.length === 0) return [];
  const united = ctx.engine.arrange(groups.map((group) => ({ ...group }))).unite();
  return ringsToRegions(united, ctx.tolerance);
}
