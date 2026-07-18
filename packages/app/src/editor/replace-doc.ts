// Whole-document replacement (#69): the shared entry point for New-panel and
// import-replace, both of which swap the ENTIRE document rather than adding
// or editing a layer. Unlike commit()/replace(), this discards the previous
// document's undo/redo history (core's history.reset — it isn't meaningful
// for the next document), clears the selection (stale ids from the old doc
// must not linger), and evicts renderer image-cache entries that no longer
// match — see reconcileImageCache in renderer.ts for why a reused id needs
// eviction, not just skipping.
import { createDefaultDoc, type DocState } from '@zpd/core';
import { confirmDialog } from './components/confirm-dialog';
import type { ToolContext } from './types';

export function replaceDoc(nextDoc: DocState, ctx: ToolContext): void {
  ctx.reset(nextDoc);
  ctx.selectIds([]);
  ctx.evictImageCache(nextDoc.layers);
}

// New Panel (issue #76): confirm-then-replace with the default starter doc.
// Lives here (not components/header.tsx) so the header button AND the
// command registry's palette-facing "New panel" command call the exact same
// function — one owner, not two copies kept in sync by hand.
export async function newPanelAction(ctx: ToolContext): Promise<void> {
  const confirmed = await confirmDialog({
    title: 'Start a new panel?',
    // createDefaultDoc() ships one starter pattern layer (dot grid), not an
    // empty document — the copy must not claim "blank" (codex review).
    message:
      'This replaces the current panel with the default starter panel. This cannot be undone.',
    confirmLabel: 'New panel',
    danger: true,
  });
  if (!confirmed) return;
  replaceDoc(createDefaultDoc(), ctx);
}
