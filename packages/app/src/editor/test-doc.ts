// Test-only fixture adapter for the v5 fixed PCB stack. Older focused tests
// describe ordinary roots compactly; normalize them at the harness boundary
// rather than weakening the production DocState contract.
import { createPcbLayerStack, type DocState, type LayerNode, type PcbLayerStack } from '@zpd/core';

export type DocFixture = Omit<DocState, 'layers'> & {
  layers: PcbLayerStack | LayerNode[];
};

function isPcbLayerStack(layers: PcbLayerStack | LayerNode[]): layers is PcbLayerStack {
  return layers.length === 3 && layers.every((node) => 'kind' in node && node.kind === 'pcb-layer');
}

export function canonicalDoc(fixture: DocFixture): DocState {
  if (isPcbLayerStack(fixture.layers)) return { ...fixture, layers: fixture.layers };
  return { ...fixture, layers: createPcbLayerStack({ copper: fixture.layers }) };
}
