// Whole-document replacement (#69): the shared entry point for New-panel and
// import-replace, both of which swap the ENTIRE document rather than adding
// or editing a layer. Unlike commit()/replace(), this discards the previous
// document's undo/redo history (core's history.reset — it isn't meaningful
// for the next document), clears the selection (stale ids from the old doc
// must not linger), and evicts renderer image-cache entries that no longer
// match — see reconcileImageCache in renderer.ts for why a reused id needs
// eviction, not just skipping.
import { createDefaultDoc, type DocState } from '@zpd/core';
import { confirmDialog } from './components/confirm-dialog-api';
import { projectFlatLayers } from './flat-projection';
import { resetTextGeometryNamespace } from './text-geometry';
import type { ToolContext } from './types';

export function replaceDoc(nextDoc: DocState, ctx: ToolContext): void {
  resetTextGeometryNamespace();
  ctx.reset(nextDoc);
  ctx.selectIds([]);
  // Side-context reset (#230): a fresh document always starts on the front
  // face, and any in-progress tool draft belonged to the OLD document.
  // clearToolDraft first — when already on front, setActiveSide is a strict
  // no-op and would not discard the draft on its own. (Replacing while on
  // the back cycles the tool twice; the deactivate/activate pair is
  // idempotent, so the double cycle is harmless.)
  ctx.clearToolDraft();
  ctx.setActiveSide('front');
  // projectFlatLayers (not ctx.flatLayers): ctx.doc still reads the OLD doc
  // until React re-renders after reset(); the eviction must see the INCOMING
  // doc's leaves. BOTH sides (#233): the image cache holds back-stack rasters
  // too, so reconciling against front-only leaves would evict live back
  // images. Also warms the projection cache for nextDoc's trees.
  ctx.evictImageCache([
    ...projectFlatLayers(nextDoc.layers),
    ...projectFlatLayers(nextDoc.backLayers),
  ]);
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
