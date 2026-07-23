import { findPcbNodeById, type PcbLayerRole, type PcbLayerStack } from '@zpd/core';

export function owningMaterialRole(stack: PcbLayerStack, layerId: string): PcbLayerRole | null {
  return findPcbNodeById(stack, layerId)?.role ?? null;
}
