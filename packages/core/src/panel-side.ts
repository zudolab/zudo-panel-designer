// The side-selection seam (material-holes epic #226, sub #230): the ONE pair
// of accessors between "which face am I editing" and DocState's positional
// side encoding (`layers` = front, `backLayers` = back — see types.ts). Every
// stack op (group-ops.ts, layer-ops.ts) and projection (layer-nodes.ts)
// already takes an explicit PcbLayerStack, so side-aware callers compose as
//   withStackForSide(doc, side, someStackOp(stackForSide(doc, side), ...))
// instead of reaching for doc.layers / doc.backLayers by name. Front stays
// the default/legacy side: existing front-only consumers read doc.layers
// unchanged.
import type { DocState, PanelSide, PcbLayerStack } from './types';

export function stackForSide(doc: DocState, side: PanelSide): PcbLayerStack {
  return side === 'back' ? doc.backLayers : doc.layers;
}

// Convention (matches layer-ops.ts / group-ops.ts): returns the SAME doc
// reference when `stack` is already the current one, so a no-op stack op
// composes into a no-op doc op — callers keep cheap history/React equality.
export function withStackForSide(
  doc: DocState,
  side: PanelSide,
  stack: PcbLayerStack,
): DocState {
  if (stackForSide(doc, side) === stack) return doc;
  return side === 'back' ? { ...doc, backLayers: stack } : { ...doc, layers: stack };
}
