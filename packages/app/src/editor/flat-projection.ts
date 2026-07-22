// The ONE app-side flat read projection of the layer tree (#150). Text
// geometry treats layer-array identity as document-incarnation state
// (reconcileTextGeometry bumps its incarnation whenever the array identity
// changes — see text-geometry.ts), so re-flattening a grouped doc ad hoc at
// every read site would bump the incarnation once per read and per repaint.
// Memoized on the tree array's identity: every consumer of the flat view —
// paint, hit-test, marquee candidates, selection normalization, exporters —
// gets the SAME Layer[] instance per committed tree. A WeakMap (not a
// single-slot cache) so interleaved readers of different incarnations (undo
// history, a not-yet-committed next tree) never evict each other; entries GC
// with their doc versions.
import { flattenLayerNodes, type Layer, type LayerNode } from '@zpd/core';

const cache = new WeakMap<readonly LayerNode[], Layer[]>();

export function projectFlatLayers(tree: LayerNode[]): Layer[] {
  let flat = cache.get(tree);
  if (!flat) {
    flat = flattenLayerNodes(tree);
    cache.set(tree, flat);
  }
  return flat;
}
