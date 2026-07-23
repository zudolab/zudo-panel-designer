// Selection normalization (#44, tree-aware since #151). The
// ToolContext.selectedIds contract is: de-duplicated, only ids present in the
// current doc TREE (stale ids after a delete/undo drop out — GROUP ids are
// legal members and survive), and tree DFS order — NOT the order the ids were
// clicked/passed in — so chrome and inspectors are stable. DFS order equals
// the flat document order for group-free docs, and puts a group id
// immediately before its descendants otherwise.
//
// The Editor applies this lazily at READ time (in the ctx getters), not inside
// selectIds(): tools select a node they just committed within the same event
// handler, before the Editor's live doc ref has synced, so eager filtering
// would wrongly drop the fresh id (same staleness rule the existing live-ref
// getters already follow — see Editor.tsx).
import { walkPcbLayerNodes, type PcbLayerStack } from '@zpd/core';

export function normalizeSelectedIds(
  ids: readonly string[],
  stack: PcbLayerStack,
): readonly string[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const result: string[] = [];
  walkPcbLayerNodes(stack, (node) => {
    if (wanted.has(node.id)) result.push(node.id);
  });
  return result;
}

// --- layer-list multi-select interaction (#45) ---------------------------
//
// The layer list drives selection with three click modes. `anchorId` is the
// EXPLICIT shift-range anchor: the last id the user singly interacted with — a
// plain click or a meta/ctrl-click sets it, a shift-click preserves it so the
// user can grow/shrink the same range. Range membership is computed by index
// in document order; the list only REVERSES that order for display, and a
// contiguous run of visual rows maps to the exact same id set as the matching
// run of document indices, so document order is the right basis.

export interface ListSelectionState {
  selectedIds: readonly string[];
  anchorId: string | null;
}

export interface ListClickModifiers {
  shift: boolean;
  meta: boolean; // metaKey OR ctrlKey — the platform-agnostic "toggle one" chord
}

export function nextListSelection(
  state: ListSelectionState,
  orderedIds: readonly string[],
  clickedId: string,
  mods: ListClickModifiers,
): ListSelectionState {
  // Shift wins over meta when both are held: a range replaces the selection.
  if (mods.shift) {
    const anchor = state.anchorId;
    const anchorIndex = anchor === null ? -1 : orderedIds.indexOf(anchor);
    const clickedIndex = orderedIds.indexOf(clickedId);
    // No usable anchor (first click, or the anchor was deleted) → behave like a
    // plain single select and adopt the clicked row as the new anchor.
    if (anchorIndex === -1 || clickedIndex === -1) {
      return { selectedIds: [clickedId], anchorId: clickedId };
    }
    const lo = Math.min(anchorIndex, clickedIndex);
    const hi = Math.max(anchorIndex, clickedIndex);
    // Anchor is PRESERVED across a shift-click so the range can be re-dragged.
    return { selectedIds: orderedIds.slice(lo, hi + 1), anchorId: anchor };
  }

  if (mods.meta) {
    const has = state.selectedIds.includes(clickedId);
    const selectedIds = has
      ? state.selectedIds.filter((id) => id !== clickedId)
      : [...state.selectedIds, clickedId];
    // The just-clicked row becomes the anchor either way (add or remove) — it
    // is the last row the user pointed at.
    return { selectedIds, anchorId: clickedId };
  }

  return { selectedIds: [clickedId], anchorId: clickedId };
}
