// Test-only fixture adapter for the fixed PCB stack. Older focused tests
// describe ordinary roots compactly; normalize them at the harness boundary
// rather than weakening the production DocState contract. The v6 doc fields
// (format/material/backLayers) default here so front-only fixtures stay
// compact.
import {
  createPcbLayerStack,
  DEFAULT_PANEL_FORMAT,
  DEFAULT_PCB_MATERIAL,
  type DocState,
  type LayerNode,
  type PcbLayerStack,
} from '@zpd/core';

export type DocFixture = Omit<DocState, 'layers' | 'format' | 'material' | 'backLayers'> & {
  layers: PcbLayerStack | LayerNode[];
  format?: DocState['format'];
  material?: DocState['material'];
  backLayers?: PcbLayerStack;
};

function isPcbLayerStack(layers: PcbLayerStack | LayerNode[]): layers is PcbLayerStack {
  return layers.length === 3 && layers.every((node) => 'kind' in node && node.kind === 'pcb-layer');
}

export function canonicalDoc(fixture: DocFixture): DocState {
  const { format, material, backLayers, layers, ...rest } = fixture;
  return {
    ...rest,
    format: format ?? DEFAULT_PANEL_FORMAT,
    material: material ?? DEFAULT_PCB_MATERIAL,
    layers: isPcbLayerStack(layers) ? layers : createPcbLayerStack({ copper: layers }),
    backLayers: backLayers ?? createPcbLayerStack('back'),
  };
}
