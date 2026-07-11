// Per-layer-type inspector registry. An inspector file registers itself for a
// layer `type`; the InspectorHost looks the selected layer's type up here.
import type { Layer } from '@zpd/core';
import type { InspectorComponent } from '../types';

const inspectors = new Map<Layer['type'], InspectorComponent>();

export function registerInspector<T extends Layer['type']>(
  type: T,
  component: InspectorComponent<Extract<Layer, { type: T }>>,
): void {
  // The per-type generic is erased to the Layer union at the map boundary;
  // the host only ever renders the inspector for a layer of the matching type.
  inspectors.set(type, component as InspectorComponent);
}

export function unregisterInspector(type: Layer['type']): void {
  inspectors.delete(type);
}

export function getInspector(type: Layer['type']): InspectorComponent | undefined {
  return inspectors.get(type);
}
