// Whole-document replacement (#69): the shared entry point for New-panel and
// import-replace, both of which swap the ENTIRE document rather than adding
// or editing a layer. Unlike commit()/replace(), this discards the previous
// document's undo/redo history (core's history.reset — it isn't meaningful
// for the next document), clears the selection (stale ids from the old doc
// must not linger), and evicts renderer image-cache entries that no longer
// match — see reconcileImageCache in renderer.ts for why a reused id needs
// eviction, not just skipping.
import type { DocState } from '@zpd/core';
import type { ToolContext } from './types';

export function replaceDoc(nextDoc: DocState, ctx: ToolContext): void {
  ctx.reset(nextDoc);
  ctx.selectIds([]);
  ctx.evictImageCache(nextDoc.layers);
}
