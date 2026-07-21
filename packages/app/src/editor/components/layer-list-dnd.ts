// Layers-panel drag-and-drop resolution (#154) — the pure half of the panel's
// ONE id-based DnD system (the reference implementation's acknowledged-legacy
// split into a flat index reorder + a tree move system is deliberately NOT
// reproduced here). The component owns event wiring and pointer→zone math;
// this module owns everything decidable from data alone: mapping a hovered
// row + zone to a tree slot, the invalid-drop guards, and executing the move
// batch through @zpd/core's moveNodeToParent (#150: writes go through the
// recursive primitives, never index math on the flat projection).
import {
  findNodeById,
  isGroupNode,
  MAX_GROUP_DEPTH,
  maxSubtreeDepth,
  moveNodeToParent,
  type LayerNode,
} from '@zpd/core';

// Zones are relative to the hovered ROW as rendered (top-of-stack first, so
// "before" = visually above = the HIGHER z slot). 'into' only exists for
// group rows (header hover / empty-group placeholder).
export type DropZone = 'before' | 'after' | 'into';

// A drop destination in tree coordinates. `anchorId` names the destination
// sibling the dragged nodes are inserted directly BEFORE (in array order);
// null appends at the end of the destination's children (= visual top of that
// stack). Anchor-based, not index-based: the executor re-derives the numeric
// index per move, so a multi-root batch stays correct while earlier moves
// shift sibling positions.
export interface DropSlot {
  parentId: string | null;
  anchorId: string | null;
}

export type DropRejection = 'cycle' | 'depth-cap';

function childrenOf(tree: LayerNode[], parentId: string | null): readonly LayerNode[] | null {
  if (parentId === null) return tree;
  const found = findNodeById(tree, parentId);
  return found && isGroupNode(found.node) ? found.node.children : null;
}

// The first sibling at index >= `from` that is not itself being dragged —
// dragged siblings are skipped because they leave this array as part of the
// same drop, so anchoring on one would target a vanishing node.
function firstNonDraggedId(
  siblings: readonly LayerNode[],
  from: number,
  dragged: ReadonlySet<string>,
): string | null {
  for (let i = from; i < siblings.length; i += 1) {
    const sibling = siblings[i];
    if (!dragged.has(sibling.id)) return sibling.id;
  }
  return null;
}

// Maps a hovered row + zone to a DropSlot, or null when the row/zone cannot
// host a drop at all (unknown row id, 'into' on a leaf). Zone semantics:
//   - 'into'  → inside the hovered GROUP, anchored at its first (array-index
//               0) child — the exact `moveNodeToParent(child, group, 0)` slot
//               the issue specifies for a header drop.
//   - 'before'→ the hovered row's parent, at the slot visually above the row
//               (array index just past it).
//   - 'after' → visually below the row. Below an EXPANDED group header sits
//               the top of that group's own visual stack, so the slot is
//               inside the group (append = array end); below a collapsed
//               header (its rows are unmounted) or any leaf it is the
//               sibling slot before the row in array order.
export function resolveDropSlot(
  tree: LayerNode[],
  rowId: string,
  zone: DropZone,
  draggedIds: readonly string[],
  collapsedGroupIds: ReadonlySet<string>,
): DropSlot | null {
  const dragged = new Set(draggedIds);
  const found = findNodeById(tree, rowId);
  if (!found) return null;
  const { node } = found;

  if (zone === 'into') {
    if (!isGroupNode(node)) return null;
    return { parentId: node.id, anchorId: firstNonDraggedId(node.children, 0, dragged) };
  }

  const parentId = found.pathIds[found.pathIds.length - 1] ?? null;
  const siblings = childrenOf(tree, parentId);
  if (!siblings) return null;
  const rowIndex = siblings.findIndex((sibling) => sibling.id === rowId);
  if (rowIndex < 0) return null;

  if (zone === 'before') {
    return { parentId, anchorId: firstNonDraggedId(siblings, rowIndex + 1, dragged) };
  }
  if (isGroupNode(node) && !collapsedGroupIds.has(node.id)) {
    return { parentId: node.id, anchorId: null };
  }
  return { parentId, anchorId: firstNonDraggedId(siblings, rowIndex, dragged) };
}

// The silent-reject guards, run during dragover (for the disabled affordance)
// AND re-run at drop time BEFORE any history write — an invalid drop must
// never create an undo entry.
//
//   - 'cycle': the destination parent is a dragged node or sits inside a
//     dragged subtree (a group can never become its own descendant).
//   - 'depth-cap': parser ground truth (serialize.ts's parseLayerNode, per
//     the #155 review): MAX_GROUP_DEPTH caps GROUP nesting only — a group is
//     legal at ancestor-group-count 0..MAX_GROUP_DEPTH and a LEAF is never
//     depth-checked (it may sit inside the deepest legal group). Dropping
//     node X under a parent whose children gain `chainDepth` group ancestors
//     puts X's deepest descendant group at chainDepth + maxSubtreeDepth(X)
//     - 1, which must stay within MAX_GROUP_DEPTH. The issue prose's looser
//     "targetDepth + maxSubtreeDepth > MAX_GROUP_DEPTH" would reject drops
//     the parser accepts (off-by-one, same trap #155 hit).
export function invalidDropReason(
  tree: LayerNode[],
  slot: DropSlot,
  draggedIds: readonly string[],
): DropRejection | null {
  const dragged = new Set(draggedIds);
  let chainDepth = 0;
  if (slot.parentId !== null) {
    if (dragged.has(slot.parentId)) return 'cycle';
    const parent = findNodeById(tree, slot.parentId);
    if (!parent || !isGroupNode(parent.node)) return 'cycle';
    if (parent.pathIds.some((ancestorId) => dragged.has(ancestorId))) return 'cycle';
    chainDepth = parent.pathIds.length + 1;
  }
  for (const id of draggedIds) {
    const found = findNodeById(tree, id);
    if (!found) return 'cycle';
    const depth = maxSubtreeDepth(found.node);
    if (depth >= 1 && chainDepth + depth - 1 > MAX_GROUP_DEPTH) return 'depth-cap';
  }
  return null;
}

// Executes one drop as a batch of moveNodeToParent calls over `draggedIds`
// (which MUST be maximal roots in tree DFS order — maximalSelectedRoots'
// contract — so inserting each root directly before the shared anchor
// preserves their relative z). The numeric index is derived per move against
// the CURRENT tree with the moving node filtered out, because
// moveNodeToParent interprets the index against the post-removal sibling
// array. Returns the SAME `tree` reference when every move is a no-op — the
// caller skips the commit, so a drop onto a node's own slot writes no
// phantom history entry.
export function executeDrop(
  tree: LayerNode[],
  draggedIds: readonly string[],
  slot: DropSlot,
): LayerNode[] {
  let next = tree;
  for (const id of draggedIds) {
    const siblings = childrenOf(next, slot.parentId);
    if (!siblings) return tree;
    const withoutSelf = siblings.filter((sibling) => sibling.id !== id);
    const anchorIndex =
      slot.anchorId === null ? -1 : withoutSelf.findIndex((sibling) => sibling.id === slot.anchorId);
    next = moveNodeToParent(next, id, slot.parentId, anchorIndex < 0 ? withoutSelf.length : anchorIndex);
  }
  return next;
}
