// Group-aware selection resolution (#151) — the ONE shared resolver between
// the selection state (which may hold GROUP ids and leaf ids mixed) and every
// consumer that needs concrete leaves: move/scale/nudge targets, align,
// clipboard, chrome, marquee promotion. Selection semantics:
//
//   - `selectedIds` holds LayerNode ids — leaf OR group — straight from the
//     click/marquee promotion. A plain canvas click on a grouped leaf promotes
//     to its TOPMOST ancestor group id; Meta/Ctrl-click is the escape hatch
//     that targets the raw leaf. No double-click-descend in v1 (matches the
//     reference implementation, pgen §13.2).
//   - INVARIANT: a [group, descendant-of-that-group] overlap must never exist
//     in `selectedIds`. The toggle helpers below maintain it on every add
//     (Meta strips selected ancestors; Shift-add strips selected descendants;
//     marquee unions collapse via maximalSelectedRoots).
//   - Consumers asking "which leaves does this selection affect" go through
//     resolveSelectionLeaves / expandSelectionToLeafIds rather than assuming
//     `flatLayers.find(id)` resolves — a group id matches no flat leaf.
import {
  findNodeById,
  isGroupNode,
  maximalSelectedRoots,
  mergeBboxes,
  normalizeRect,
  rotatableLayer,
  rotatedRectAABB,
  topmostAncestorId,
  walkLayerNodes,
  type Layer,
  type LayerNode,
  type Rect,
} from '@zpd/core';
import { layerBbox, layerRotation } from './renderer';
import { reconcileTextGeometry } from './text-geometry';

// The id a plain canvas click/marquee-sweep on `leafId` selects: its TOPMOST
// ancestor group id when it lives inside a group, else the leaf's own id
// (also the fallback for an id not found in the tree — callers pass ids they
// just hit-tested, so that branch is pure defense).
export function topmostAncestorIdForLeaf(tree: LayerNode[], leafId: string): string {
  return topmostAncestorId(tree, leafId) ?? leafId;
}

// Expands selection ids (leaf or group) to their descendant LEAF ids —
// deduped, in tree DFS (= z) order, ids not found in the tree dropped. This
// is the canonical "which leaves does the selection cover" translation.
// Hidden state is NOT considered here (that's resolveSelectionLeaves's job) —
// callers that need visibility filtering must not re-implement it off this.
export function expandSelectionToLeafIds(
  tree: LayerNode[],
  selectedIds: readonly string[],
): string[] {
  if (selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const out: string[] = [];
  const walk = (nodes: LayerNode[], underSelected: boolean): void => {
    for (const node of nodes) {
      const covered = underSelected || selected.has(node.id);
      if (isGroupNode(node)) walk(node.children, covered);
      else if (covered) out.push(node.id);
    }
  };
  walk(tree, false);
  return out;
}

// The selected id that "owns" a leaf: the leaf's own id when directly
// selected, else its outermost selected ancestor group id, else null (the
// leaf is not covered by the selection). Under the no-overlap invariant at
// most one selected id can sit on a leaf's ancestor path, so "outermost" is
// just the deterministic tiebreak for an externally violated invariant.
// This is what a plain click on a multi-selection member collapses to.
export function selectionOwnerId(
  tree: LayerNode[],
  selectedIds: readonly string[],
  leafId: string,
): string | null {
  if (selectedIds.includes(leafId)) return leafId;
  const found = findNodeById(tree, leafId);
  if (!found) return null;
  for (const ancestorId of found.pathIds) {
    if (selectedIds.includes(ancestorId)) return ancestorId;
  }
  return null;
}

// Meta/Ctrl-click semantics: toggle the RAW leaf id. Adding the leaf REMOVES
// any selected ancestor of it — Meta is the group escape hatch, and keeping
// the ancestor would create the forbidden [group, descendant] overlap.
export function toggleLeafSelection(
  tree: LayerNode[],
  selectedIds: readonly string[],
  leafId: string,
): string[] {
  if (selectedIds.includes(leafId)) return selectedIds.filter((id) => id !== leafId);
  const ancestors = new Set(findNodeById(tree, leafId)?.pathIds ?? []);
  return [...selectedIds.filter((id) => !ancestors.has(id)), leafId];
}

// Every id in the subtree rooted at `id` INCLUDING the root itself, or just
// {id} when it is a leaf / not found. Used to strip descendants when a group
// id joins the selection.
function subtreeIds(tree: LayerNode[], id: string): Set<string> {
  const out = new Set<string>([id]);
  const found = findNodeById(tree, id);
  if (found) walkLayerNodes([found.node], (node) => out.add(node.id));
  return out;
}

// Shift-click semantics: toggle the PROMOTED (topmost-ancestor) id, preserving
// the rest of the selection. Adding a group id REMOVES any selected descendant
// of it (e.g. a leaf the user Meta-picked earlier) — the overlap invariant
// again, resolved toward the ancestor because Shift acted at group level.
export function togglePromotedSelection(
  tree: LayerNode[],
  selectedIds: readonly string[],
  leafId: string,
): string[] {
  const promoted = topmostAncestorIdForLeaf(tree, leafId);
  if (selectedIds.includes(promoted)) return selectedIds.filter((id) => id !== promoted);
  const covered = subtreeIds(tree, promoted);
  return [...selectedIds.filter((id) => !covered.has(id)), promoted];
}

// Marquee result → selection: every swept leaf contributes its TOPMOST
// ancestor id (same promotion as a click), the base (additive) selection is
// unioned in, and maximalSelectedRoots collapses the union — deduped, tree
// DFS order, overlap-free (a swept group absorbs a previously Meta-selected
// descendant leaf; ancestor wins because the sweep acted at group level).
export function promoteMarqueeSelection(
  tree: LayerNode[],
  hitLeafIds: readonly string[],
  baseIds: readonly string[],
): string[] {
  const union = [...baseIds];
  for (const leafId of hitLeafIds) {
    const promoted = topmostAncestorIdForLeaf(tree, leafId);
    if (!union.includes(promoted)) union.push(promoted);
  }
  return maximalSelectedRoots(tree, union);
}

export type SelectionOverlayMode = 'none' | 'single' | 'combined';

// Overlay/chrome dispatch (#151): 'combined' iff any selected id is a GROUP
// or the resolved leaf count is > 1 — a one-child group is combined (it must
// get the combined-bbox treatment, never the single-layer rotate/resize
// handles), a lone leaf is 'single'. Anything that resolves to NO leaves at
// all — empty selection, stale-only ids, or a selected group left childless —
// is 'none': there is nothing to draw or transform, so classifying a
// bounds-less selection as combined would just push a null-bounds guard into
// every consumer (matches the reference implementation, pgen §13.3).
export function resolveSelectionOverlayMode(
  tree: LayerNode[],
  selectedIds: readonly string[],
): SelectionOverlayMode {
  if (selectedIds.length === 0) return 'none';
  const leafCount = expandSelectionToLeafIds(tree, selectedIds).length;
  if (leafCount === 0) return 'none';
  if (leafCount > 1) return 'combined';
  for (const id of selectedIds) {
    const found = findNodeById(tree, id);
    if (found && isGroupNode(found.node)) return 'combined';
  }
  return 'single';
}

export interface SelectionLeavesResolution {
  // Resolved leaves that draw chrome: not hidden — intrinsically OR via a
  // hidden ancestor group (the flat projection folds ancestor-hidden into
  // leaf.hidden, so one check covers both).
  visibleLeafIds: string[];
  // The leaves gestures may transform. Today identical to visibleLeafIds —
  // zpd has no `locked` (deliberately excluded from GroupNode, see #145) —
  // but consumers MUST read this field, not visibleLeafIds, for write
  // targets so a future editability gate lands in one place.
  editableLeafIds: string[];
  // Editable leaves rotatableLayer (core rotate.ts) accepts — the rotate
  // gesture's target set (#152).
  rotatableLeafIds: string[];
  // Rotation-aware AABB union of the editable leaves via the canonical
  // app-side layerBbox (canvas-measured text metrics — NEVER core's
  // estimate), or null when nothing editable has measurable bounds.
  combinedBounds: Rect | null;
}

// Resolves a selection (leaf/group ids mixed) against the flat projection —
// pass ctx.flatLayers / projectFlatLayers(tree), never an ad-hoc flatten
// (text geometry treats array identity as incarnation state, see #150).
export function resolveSelectionLeaves(
  tree: LayerNode[],
  selectedIds: readonly string[],
  flatLayers: readonly Layer[],
): SelectionLeavesResolution {
  const leafIds = expandSelectionToLeafIds(tree, selectedIds);
  if (leafIds.length === 0) {
    return { visibleLeafIds: [], editableLeafIds: [], rotatableLeafIds: [], combinedBounds: null };
  }
  reconcileTextGeometry(flatLayers);
  const byId = new Map(flatLayers.map((l) => [l.id, l]));
  const visibleLeafIds: string[] = [];
  const editableLeafIds: string[] = [];
  const rotatableLeafIds: string[] = [];
  const bounds: Rect[] = [];
  for (const id of leafIds) {
    const layer = byId.get(id);
    if (!layer || layer.hidden) continue;
    visibleLeafIds.push(id);
    editableLeafIds.push(id);
    if (rotatableLayer(layer)) rotatableLeafIds.push(id);
    const raw = layerBbox(layer);
    if (raw) bounds.push(normalizeRect(rotatedRectAABB(raw, layerRotation(layer))));
  }
  return {
    visibleLeafIds,
    editableLeafIds,
    rotatableLeafIds,
    combinedBounds: bounds.length > 0 ? mergeBboxes(bounds) : null,
  };
}
