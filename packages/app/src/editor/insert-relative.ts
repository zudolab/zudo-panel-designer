// Shared selection-relative insertion policy (#191, depends on #189's core
// primitives). Every creation path — add-rect, add-ellipse, pattern-picker's
// insert branch, pen (open/closed finish), text, image import — funnels
// through this ONE function so "land the new object directly above the
// current selection" cannot drift between callers.
//
// Anchor pick: reuses the exported maximalPcbSelectedRoots (selection-
// resolve.ts) rather than reimplementing selection collapsing. That helper
// concatenates each fixed container's maximal roots in STACK order
// (copper -> solder-mask -> silkscreen) and, within a container, in tree DFS
// (= z) order — both of which run bottom-to-top. So across a multi-selection
// spanning containers, the LAST entry of the concatenated list is exactly the
// visually topmost maximal root.
//
// Slot resolution: the core pcbInsertionSlotAbove (#189, group-ops.ts) —
// the anchor's own container/parent group, one sibling index above it. A
// selected group anchors as "above the group" for free, since
// pcbInsertionSlotAbove never resolves a group anchor to a slot inside it.
//
// Fallback + failure contract: falls back to the pre-#191 default routing
// (append at the top of `defaultRole`) whenever selection is empty OR the
// anchored insert is refused (insertPcbNode's own no-op contract — same
// reference back). If the fallback is ALSO refused, this function returns
// the SAME `stack` reference it was given — callers MUST compare by
// reference and commit/select NOTHING on that path (no phantom selection of
// a node that was never inserted).
import { insertPcbNode, pcbInsertionSlotAbove, type LayerNode, type PcbLayerRole, type PcbLayerStack } from '@zpd/core';
import { maximalPcbSelectedRoots } from './selection-resolve';

export function insertNewNodeRelativeToSelection(
  stack: PcbLayerStack,
  selectedIds: readonly string[],
  node: LayerNode,
  defaultRole: PcbLayerRole,
): PcbLayerStack {
  const roots = maximalPcbSelectedRoots(stack, selectedIds);
  const anchorId = roots.length > 0 ? roots[roots.length - 1] : null;

  if (anchorId !== null) {
    const slot = pcbInsertionSlotAbove(stack, anchorId);
    if (slot) {
      const anchored = insertPcbNode(stack, slot.role, node, slot.parentId, slot.index);
      if (anchored !== stack) return anchored;
    }
  }

  return insertPcbNode(stack, defaultRole, node);
}
