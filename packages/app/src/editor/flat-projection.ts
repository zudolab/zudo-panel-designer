// The ONE app-side flat read projection of the PCB layer stack (#150, #166). Text
// geometry treats layer-array identity as document-incarnation state
// (reconcileTextGeometry bumps its incarnation whenever the array identity
// changes — see text-geometry.ts), so re-projecting a grouped doc ad hoc at
// every read site would bump the incarnation once per read and per repaint.
// Core memoizes on the stack array's identity: every consumer of the flat view —
// paint, hit-test, marquee candidates, selection normalization, exporters —
// gets the SAME Layer[] instance per committed tree. A WeakMap (not a
// single-slot cache) also preserves the legacy ordinary-tree fallback used by
// focused geometry tests and transitional component inputs.
//
// The PCB projection is more than flattening: fixed-container membership
// supplies effective paint, fixed container order supplies physical z-order,
// and fixed/group hidden state folds down onto leaves. Deliberately stale
// compatibility colors therefore cannot leak into rendering.
import {
  flattenLayerNodes,
  projectPcbLayerStack,
  type Layer,
  type LayerNode,
  type PcbLayerStack,
} from '@zpd/core';

const cache = new WeakMap<readonly LayerNode[], Layer[]>();

export function projectFlatLayers(tree: PcbLayerStack): Layer[];
export function projectFlatLayers(tree: LayerNode[]): Layer[];
export function projectFlatLayers(tree: PcbLayerStack | LayerNode[]): Layer[];
export function projectFlatLayers(tree: PcbLayerStack | LayerNode[]): Layer[] {
  if ((tree[0] as PcbLayerStack[0] | undefined)?.kind === 'pcb-layer') {
    return projectPcbLayerStack(tree as PcbLayerStack);
  }

  const ordinaryTree = tree as LayerNode[];
  let flat = cache.get(ordinaryTree);
  if (!flat) {
    flat = flattenLayerNodes(ordinaryTree);
    cache.set(ordinaryTree, flat);
  }
  return flat;
}
