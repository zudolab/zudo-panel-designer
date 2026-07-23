// Pure tree-transformation operations over the recursive LayerNode tree
// (layer-nodes.ts). Every op is a plain function: read the tree, return a
// tree. No history/undo wiring lives here — the app wave (#150/#155/#156)
// wires these into its own state container the same way layer-ops.ts's flat
// ops are wired today.
//
// Convention (matches layer-ops.ts / clone.ts): every op returns the SAME
// input array reference when it is a no-op (id not found, empty selection,
// cycle rejected, etc.) so callers get cheap React memo/dep equality for
// free. Changed paths get fresh arrays/objects; untouched siblings keep
// their references.
//
// Reference shape: pgen's packages/core/src/layer-group-ops.ts, minus its
// opacity/positionOffset/locked/colorTweak concerns — zpd groups are
// structure + `hidden` only (see GroupNode in types.ts).
import { isGroupNode, MAX_GROUP_DEPTH, normalizeLayerNodeMaterial } from './layer-nodes';
import { cloneLayer } from './layer-ops';
import type {
  GroupNode,
  Layer,
  LayerNode,
  PcbLayerContainer,
  PcbLayerRole,
  PcbLayerStack,
} from './types';
import { mintId } from './types';

// ─── Read helpers ───────────────────────────────────────────────────────────

export interface FoundNode {
  node: LayerNode;
  // Root-to-target GROUP ids; the target's own id is never included, and
  // leaf ids never appear here (only groups can be an ancestor).
  pathIds: string[];
}

export function findNodeById(
  tree: LayerNode[],
  id: string,
  pathIds: string[] = [],
): FoundNode | null {
  for (const node of tree) {
    if (node.id === id) return { node, pathIds };
    if (isGroupNode(node)) {
      const found = findNodeById(node.children, id, [...pathIds, node.id]);
      if (found) return found;
    }
  }
  return null;
}

// DFS; a leaf returns its own id, a group returns every leaf id beneath it
// (never its own). Used to translate a group selection into "all descendant
// leaves" for ops that only make sense on leaves (move-on-canvas, align).
export function collectLeafIds(node: LayerNode): string[] {
  if (!isGroupNode(node)) return [node.id];
  const out: string[] = [];
  for (const child of node.children) out.push(...collectLeafIds(child));
  return out;
}

// The top-level ancestor id enclosing `leafId` — the id itself when it is
// already top-level. Returns null when the id is not found.
export function topmostAncestorId(tree: LayerNode[], leafId: string): string | null {
  const found = findNodeById(tree, leafId);
  if (!found) return null;
  return found.pathIds[0] ?? leafId;
}

// A leaf is depth 0; a group with only leaves is depth 1; and so on. Used to
// enforce MAX_GROUP_DEPTH at the call sites that own that policy (parse
// boundary, drag boundary, ⌘G gate) — this op itself does not enforce it.
export function maxSubtreeDepth(node: LayerNode): number {
  if (!isGroupNode(node)) return 0;
  let deepest = 0;
  for (const child of node.children) {
    const d = maxSubtreeDepth(child);
    if (d > deepest) deepest = d;
  }
  return 1 + deepest;
}

// Root nodes are depth 0. Returns -1 when the id is not found.
export function depthOfNodeById(tree: LayerNode[], id: string): number {
  const found = findNodeById(tree, id);
  return found ? found.pathIds.length : -1;
}

// Canonical pre-pass for group/copy/duplicate/drag: drops any id in `ids`
// that is a descendant of another selected id, so a selection containing
// both a group and one of its own children collapses to just the group.
// Returns ids in tree DFS order (not `ids` order), and only ids that were
// actually found in the tree.
export function maximalSelectedRoots(tree: LayerNode[], ids: readonly string[]): string[] {
  const selected = new Set(ids);
  if (selected.size === 0) return [];
  const result: string[] = [];
  const walk = (nodes: LayerNode[], hasSelectedAncestor: boolean): void => {
    for (const node of nodes) {
      const selectedHere = selected.has(node.id);
      if (selectedHere && !hasSelectedAncestor) result.push(node.id);
      if (isGroupNode(node)) walk(node.children, hasSelectedAncestor || selectedHere);
    }
  };
  walk(tree, false);
  return result;
}

// ─── Internal removal/insertion primitives (shared by delete/move/group) ───

// Removes every node (leaf or group, cascading with its subtree) whose id is
// in `ids`, preserving the position/reference of every untouched sibling.
// Returns the SAME `nodes` reference when nothing in `ids` was found.
function removeNodesByIds(nodes: LayerNode[], ids: ReadonlySet<string>): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) {
      touched = true;
      continue;
    }
    if (isGroupNode(node)) {
      const children = removeNodesByIds(node.children, ids);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : nodes;
}

// Inserts `node` at `targetParentId` (null = top level) / `targetIndex`.
// Indices out of range clamp to the destination array's length. Returns the
// SAME `nodes` reference only when `targetParentId` is non-null and was not
// found (top-level insertion always succeeds).
function insertNodeAt(
  nodes: LayerNode[],
  node: LayerNode,
  targetParentId: string | null,
  targetIndex: number,
): LayerNode[] {
  if (targetParentId === null) {
    const next = nodes.slice();
    const at = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(at, 0, node);
    return next;
  }
  let inserted = false;
  const next: LayerNode[] = [];
  for (const child of nodes) {
    if (!inserted && isGroupNode(child) && child.id === targetParentId) {
      const children = child.children.slice();
      const at = Math.max(0, Math.min(targetIndex, children.length));
      children.splice(at, 0, node);
      next.push({ ...child, children });
      inserted = true;
      continue;
    }
    if (!inserted && isGroupNode(child)) {
      const children = insertNodeAt(child.children, node, targetParentId, targetIndex);
      if (children !== child.children) {
        next.push({ ...child, children });
        inserted = true;
        continue;
      }
    }
    next.push(child);
  }
  return inserted ? next : nodes;
}

// The top-level index whose subtree contains `id` (the top-level node itself
// when `id` is already top-level). Falls back to `tree.length` (append) when
// not found — callers only reach that branch after already confirming `id`
// exists, so it is unreachable in practice.
function topLevelIndexContaining(tree: LayerNode[], id: string): number {
  for (let i = 0; i < tree.length; i += 1) {
    const top = tree[i];
    if (top.id === id) return i;
    if (isGroupNode(top) && findNodeById([top], id)) return i;
  }
  return tree.length;
}

// The direct parent id (null = top level) and sibling index of `id`, or null
// when not found. Used by moveNodeToParent's same-slot no-op check.
function locateNode(
  nodes: LayerNode[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === id) return { parentId, index: i };
    if (isGroupNode(node)) {
      const found = locateNode(node.children, id, node.id);
      if (found) return found;
    }
  }
  return null;
}

// ─── Structural ops ─────────────────────────────────────────────────────────

export interface GroupNodesResult {
  tree: LayerNode[];
  // The group actually inserted into `tree`, or null on a no-op (empty/
  // unresolvable selection). CALLERS MUST SELECT `group.id` — fabricating a
  // separate id (e.g. by minting one before calling this op) selects a
  // phantom node that was never inserted into the tree. This exact bug
  // shipped in pgen; returning the real node closes it off at the type level.
  group: GroupNode | null;
}

// Wraps the maximal selected roots (leaves and/or groups) into a new
// top-level group, removing them from wherever they currently live. Members
// keep their world-mm geometry untouched — zpd groups carry no offset to
// fold in, so nothing moves.
//
// The new group is inserted AT THE TOP LEVEL, at the top-level slot of the
// first selected root in DFS order (i.e. bottommost in z of the selection).
// Selected roots keep their relative DFS order as the new group's children.
export function groupNodes(
  tree: LayerNode[],
  ids: readonly string[],
  name: string,
): GroupNodesResult {
  const rootIds = maximalSelectedRoots(tree, ids);
  if (rootIds.length === 0) return { tree, group: null };

  const rootNodes: LayerNode[] = [];
  for (const rootId of rootIds) {
    const found = findNodeById(tree, rootId);
    if (found) rootNodes.push(found.node);
  }
  if (rootNodes.length === 0) return { tree, group: null };

  const insertIndex = topLevelIndexContaining(tree, rootIds[0]);
  const stripped = removeNodesByIds(tree, new Set(rootIds));

  const group: GroupNode = { kind: 'group', id: mintId('group'), name, children: rootNodes };
  const next = stripped.slice();
  const at = Math.max(0, Math.min(insertIndex, next.length));
  next.splice(at, 0, group);
  return { tree: next, group };
}

// Splices a group's children in at the group's own position, preserving
// z-order. Selection of the released children afterward is the caller's job.
// Returns the SAME `tree` reference when `id` is not found or resolves to a
// leaf.
export function ungroupGroupById(tree: LayerNode[], id: string): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (isGroupNode(node) && node.id === id) {
      touched = true;
      next.push(...node.children);
      continue;
    }
    if (isGroupNode(node)) {
      const children = ungroupGroupById(node.children, id);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// Moves a node (leaf or group) to a new parent + index. `targetParentId`
// null means top level; `targetIndex` is 0-based among the destination's
// children. No-ops (returns `tree` unchanged, same reference) when:
//   - `nodeId` is not found,
//   - `targetParentId` would move a group into itself or one of its own
//     descendants (cycle guard),
//   - `targetParentId` is non-null and does not resolve to a group.
//
// Strip-source-first, two-pass: the source is removed from the tree BEFORE
// the destination index is applied, so `targetIndex` is interpreted against
// the POST-removal array. This is what makes "move down within the same
// parent" land on the intended slot — inserting against the pre-removal
// array would be off by one whenever the destination index is past the
// source's own position.
export function moveNodeToParent(
  tree: LayerNode[],
  nodeId: string,
  parentId: string | null,
  index: number,
): LayerNode[] {
  const found = findNodeById(tree, nodeId);
  if (!found) return tree;
  const { node } = found;

  let parentGroup: GroupNode | null = null;
  if (parentId !== null) {
    if (isGroupNode(node) && findNodeById([node], parentId)) return tree; // cycle guard
    const parentLookup = findNodeById(tree, parentId);
    if (!parentLookup || !isGroupNode(parentLookup.node)) return tree;
    parentGroup = parentLookup.node;
  }

  // Dropping a node back into its current parent at its own post-removal
  // index is a no-op. Short-circuit BEFORE any removal/reinsertion so the
  // identity-on-no-op contract holds here too (codex review, #148) — without
  // this, a same-slot move still rebuilds fresh arrays/ancestor objects,
  // which would cost a spurious history entry / React re-render downstream.
  const currentLocation = locateNode(tree, nodeId);
  if (currentLocation && currentLocation.parentId === parentId) {
    const siblingCount = parentGroup ? parentGroup.children.length : tree.length;
    const clampedIndex = Math.max(0, Math.min(index, siblingCount - 1));
    if (clampedIndex === currentLocation.index) return tree;
  }

  const stripped = removeNodesByIds(tree, new Set([nodeId]));
  return insertNodeAt(stripped, node, parentId, index);
}

// Deletes a node (leaf or group) by id from anywhere in the tree. Deleting a
// group cascades — every descendant goes with it, with no auto-promote to
// the parent (per the design doc: undo restores the whole subtree because
// history snapshots the full doc, so promotion would just be surprising).
// Returns the SAME `tree` reference when `id` is not found.
export function deleteNodeById(tree: LayerNode[], id: string): LayerNode[] {
  return removeNodesByIds(tree, new Set([id]));
}

// Deep-clones a single node, assigning fresh ids root-to-leaf. Leaves reuse
// cloneLayer (layer-ops.ts) so nested structures — path points/handles,
// pattern params — get real deep copies instead of a shallow spread.
export function cloneNodeWithFreshIds(node: LayerNode): LayerNode {
  if (isGroupNode(node)) {
    return {
      ...node,
      id: mintId('group'),
      children: node.children.map((child) => cloneNodeWithFreshIds(child)),
    };
  }
  return cloneLayer(node, mintId(node.type));
}

// Toggles `hidden` on a single node (leaf or group) identified by id, at any
// depth. Returns the SAME `tree` reference when `id` is not found.
export function toggleHiddenById(tree: LayerNode[], id: string): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (node.id === id) {
      touched = true;
      next.push({ ...node, hidden: !node.hidden });
      continue;
    }
    if (isGroupNode(node)) {
      const children = toggleHiddenById(node.children, id);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// Renames a single node (leaf or group) identified by id, at any depth. Both
// unions carry `name: string`, so this op is uniform across leaves/groups.
// Returns the SAME `tree` reference when `id` is not found.
export function renameById(tree: LayerNode[], id: string, name: string): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (node.id === id) {
      touched = true;
      next.push({ ...node, name });
      continue;
    }
    if (isGroupNode(node)) {
      const children = renameById(node.children, id, name);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// ─── Write primitives (app-side audit) ─────────────────────────────────────

// Applies `updater` to a single leaf identified by id, anywhere in the tree.
// Group structure is preserved; if `id` resolves to a group node the tree is
// returned unchanged (this op is scoped to leaves). Returns the SAME `tree`
// reference when `id` is not found or resolves to a group.
export function updateLeafById(
  tree: LayerNode[],
  id: string,
  updater: (leaf: Layer) => Layer,
): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (!isGroupNode(node) && node.id === id) {
      touched = true;
      next.push(updater(node));
      continue;
    }
    if (isGroupNode(node)) {
      const children = updateLeafById(node.children, id, updater);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// Batch form of updateLeafById: applies `mapper` to every leaf whose id is in
// `ids`, anywhere in the tree, in one pass. Returns the SAME `tree` reference
// when `ids` is empty or none of them match a leaf.
export function mapLeavesById(
  tree: LayerNode[],
  ids: readonly string[],
  mapper: (leaf: Layer) => Layer,
): LayerNode[] {
  if (ids.length === 0) return tree;
  // Built once here, not per recursive call (codex review, #148) — a tree
  // with many groups would otherwise reconstruct the same Set at every
  // nesting level, turning this one-pass batch op quadratic in group count.
  return mapLeavesByIdSet(tree, new Set(ids), mapper);
}

function mapLeavesByIdSet(
  tree: LayerNode[],
  wanted: ReadonlySet<string>,
  mapper: (leaf: Layer) => Layer,
): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (!isGroupNode(node) && wanted.has(node.id)) {
      touched = true;
      next.push(mapper(node));
      continue;
    }
    if (isGroupNode(node)) {
      const children = mapLeavesByIdSet(node.children, wanted, mapper);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// Splices `nodes` in place of the node identified by `id` — zero, one, or
// many replacement nodes at the same position/depth as the original. What
// trace needs to insert generated path layers beside the source image
// inside its parent (group or top level). Returns the SAME `tree` reference
// when `id` is not found.
export function replaceNodeWithNodes(
  tree: LayerNode[],
  id: string,
  nodes: LayerNode[],
): LayerNode[] {
  let touched = false;
  const next: LayerNode[] = [];
  for (const node of tree) {
    if (node.id === id) {
      touched = true;
      next.push(...nodes);
      continue;
    }
    if (isGroupNode(node)) {
      const children = replaceNodeWithNodes(node.children, id, nodes);
      if (children !== node.children) {
        touched = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }
  return touched ? next : tree;
}

// ─── Fixed PCB-stack operations ────────────────────────────────────────────

export interface FoundPcbNode extends FoundNode {
  role: PcbLayerRole;
  container: PcbLayerContainer;
}

export function findPcbNodeById(stack: PcbLayerStack, id: string): FoundPcbNode | null {
  for (const container of stack) {
    const found = findNodeById(container.children, id);
    if (found) return { ...found, role: container.role, container };
  }
  return null;
}

export function getPcbLayer(stack: PcbLayerStack, role: PcbLayerRole): PcbLayerContainer {
  return stack.find((container) => container.role === role)!;
}

function replacePcbChildren(
  stack: PcbLayerStack,
  role: PcbLayerRole,
  children: LayerNode[],
): PcbLayerStack {
  const index = stack.findIndex((container) => container.role === role);
  const current = stack[index];
  if (current.children === children) return stack;
  const next = stack.slice() as PcbLayerStack;
  next[index] = { ...current, children } as PcbLayerStack[typeof index];
  return next;
}

function collectNodeIds(node: LayerNode, ids: string[]): void {
  ids.push(node.id);
  if (isGroupNode(node)) {
    for (const child of node.children) collectNodeIds(child, ids);
  }
}

function canAdmitPcbNodes(
  stack: PcbLayerStack,
  nodes: readonly LayerNode[],
  excludedIds: ReadonlySet<string> = new Set(),
): boolean {
  const used = new Set<string>(stack.map((container) => container.id));
  for (const container of stack) {
    walkExisting(container.children);
  }
  function walkExisting(tree: LayerNode[]): void {
    for (const node of tree) {
      if (!excludedIds.has(node.id)) used.add(node.id);
      if (isGroupNode(node)) walkExisting(node.children);
    }
  }
  for (const node of nodes) {
    const incoming: string[] = [];
    collectNodeIds(node, incoming);
    for (const id of incoming) {
      if (used.has(id)) return false;
      used.add(id);
    }
  }
  return true;
}

function fitsGroupDepth(node: LayerNode, ancestorGroups: number): boolean {
  if (!isGroupNode(node)) return true;
  return ancestorGroups + maxSubtreeDepth(node) - 1 <= MAX_GROUP_DEPTH;
}

export function insertPcbNode(
  stack: PcbLayerStack,
  role: PcbLayerRole,
  node: LayerNode,
  parentId: string | null = null,
  index = Number.MAX_SAFE_INTEGER,
): PcbLayerStack {
  const container = getPcbLayer(stack, role);
  const parent = parentId === null ? null : findNodeById(container.children, parentId);
  if (parentId !== null && (!parent || !isGroupNode(parent.node))) return stack;
  const ancestorGroups = parent ? parent.pathIds.length + 1 : 0;
  if (!fitsGroupDepth(node, ancestorGroups)) return stack;
  if (!canAdmitPcbNodes(stack, [node])) return stack;
  const normalized = normalizeLayerNodeMaterial(node, role);
  const children = insertNodeAt(container.children, normalized, parentId, index);
  return replacePcbChildren(stack, role, children);
}

export function deletePcbNodeById(stack: PcbLayerStack, id: string): PcbLayerStack {
  const found = findPcbNodeById(stack, id);
  if (!found) return stack;
  return replacePcbChildren(stack, found.role, deleteNodeById(found.container.children, id));
}

export function updatePcbNodeById(
  stack: PcbLayerStack,
  id: string,
  updater: (node: LayerNode) => LayerNode,
): PcbLayerStack {
  const found = findPcbNodeById(stack, id);
  if (!found) return stack;
  const replace = (tree: LayerNode[]): LayerNode[] => {
    let changed = false;
    const next = tree.map((node) => {
      if (node.id === id) {
        const updated = normalizeLayerNodeMaterial(updater(node), found.role);
        if (updated === node) return node;
        if (!fitsGroupDepth(updated, found.pathIds.length)) return node;
        const removedIds: string[] = [];
        collectNodeIds(node, removedIds);
        if (!canAdmitPcbNodes(stack, [updated], new Set(removedIds))) return node;
        changed = true;
        return updated;
      }
      if (isGroupNode(node)) {
        const children = replace(node.children);
        if (children !== node.children) {
          changed = true;
          return { ...node, children };
        }
      }
      return node;
    });
    return changed ? next : tree;
  };
  return replacePcbChildren(stack, found.role, replace(found.container.children));
}

export function replacePcbNodeWithNodes(
  stack: PcbLayerStack,
  id: string,
  nodes: LayerNode[],
): PcbLayerStack {
  const found = findPcbNodeById(stack, id);
  if (!found) return stack;
  const normalized = nodes.map((node) => normalizeLayerNodeMaterial(node, found.role));
  if (normalized.length === 1 && normalized[0] === found.node) return stack;
  if (normalized.some((node) => !fitsGroupDepth(node, found.pathIds.length))) return stack;
  const removedIds: string[] = [];
  collectNodeIds(found.node, removedIds);
  if (!canAdmitPcbNodes(stack, normalized, new Set(removedIds))) return stack;
  return replacePcbChildren(
    stack,
    found.role,
    replaceNodeWithNodes(found.container.children, id, normalized),
  );
}

export function movePcbNode(
  stack: PcbLayerStack,
  id: string,
  targetRole: PcbLayerRole,
  parentId: string | null,
  index: number,
): PcbLayerStack {
  const found = findPcbNodeById(stack, id);
  if (!found) return stack;

  const target = getPcbLayer(stack, targetRole);
  if (parentId !== null) {
    const targetParent = findNodeById(target.children, parentId);
    if (!targetParent || !isGroupNode(targetParent.node)) return stack;
    if (isGroupNode(found.node) && findNodeById([found.node], parentId)) return stack;
  }
  const targetParent = parentId === null ? null : findNodeById(target.children, parentId);
  const ancestorGroups = targetParent ? targetParent.pathIds.length + 1 : 0;
  if (!fitsGroupDepth(found.node, ancestorGroups)) return stack;

  if (found.role === targetRole) {
    const moved = moveNodeToParent(found.container.children, id, parentId, index);
    return replacePcbChildren(stack, found.role, moved);
  }

  const sourceChildren = deleteNodeById(found.container.children, id);
  const afterRemoval = replacePcbChildren(stack, found.role, sourceChildren);
  return insertPcbNode(afterRemoval, targetRole, found.node, parentId, index);
}

export interface ClonePcbNodeResult {
  stack: PcbLayerStack;
  node: LayerNode | null;
}

export function clonePcbNode(
  stack: PcbLayerStack,
  id: string,
  parentId?: string | null,
  index?: number,
): ClonePcbNodeResult {
  const found = findPcbNodeById(stack, id);
  if (!found) return { stack, node: null };
  const node = cloneNodeWithFreshIds(found.node);
  const sourceLocation = locateNode(found.container.children, id);
  const destinationParent = parentId === undefined ? (sourceLocation?.parentId ?? null) : parentId;
  const destinationIndex =
    index ?? (sourceLocation ? sourceLocation.index + 1 : Number.MAX_SAFE_INTEGER);
  return {
    stack: insertPcbNode(stack, found.role, node, destinationParent, destinationIndex),
    node,
  };
}

export interface GroupPcbNodesResult {
  stack: PcbLayerStack;
  group: GroupNode | null;
}

export function groupPcbNodes(
  stack: PcbLayerStack,
  ids: readonly string[],
  name: string,
): GroupPcbNodesResult {
  const roots = ids.map((id) => findPcbNodeById(stack, id)).filter((found) => found !== null);
  if (roots.length === 0) return { stack, group: null };
  const role = roots[0].role;
  if (roots.some((found) => found.role !== role)) return { stack, group: null };
  const container = getPcbLayer(stack, role);
  const maximalIds = maximalSelectedRoots(container.children, ids);
  if (
    maximalIds.some((id) => {
      const node = findNodeById(container.children, id)?.node;
      return node ? maxSubtreeDepth(node) > MAX_GROUP_DEPTH : false;
    })
  ) {
    return { stack, group: null };
  }
  const grouped = groupNodes(container.children, ids, name);
  return {
    stack: replacePcbChildren(stack, role, grouped.tree),
    group: grouped.group,
  };
}

export function ungroupPcbNode(stack: PcbLayerStack, id: string): PcbLayerStack {
  const found = findPcbNodeById(stack, id);
  if (!found || !isGroupNode(found.node)) return stack;
  return replacePcbChildren(stack, found.role, ungroupGroupById(found.container.children, id));
}

export function togglePcbLayerHidden(stack: PcbLayerStack, role: PcbLayerRole): PcbLayerStack {
  const index = stack.findIndex((container) => container.role === role);
  if (index < 0) return stack;
  const next = stack.slice() as PcbLayerStack;
  const container = stack[index];
  next[index] = { ...container, hidden: !container.hidden } as PcbLayerStack[typeof index];
  return next;
}
