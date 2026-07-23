import {
  findNodeById,
  findPcbNodeById,
  getPcbLayer,
  isGroupNode,
  MAX_GROUP_DEPTH,
  maxSubtreeDepth,
  movePcbNode,
  type LayerNode,
  type PcbLayerRole,
  type PcbLayerStack,
} from '@zpd/core';

export type DropZone = 'before' | 'after' | 'into';

// The fixed material role is part of every destination. parentId=null means
// the ordinary root of that material, never the document root.
export interface DropSlot {
  role: PcbLayerRole;
  parentId: string | null;
  anchorId: string | null;
}

export type DropRejection = 'cycle' | 'depth-cap';

function childrenOf(
  stack: PcbLayerStack,
  role: PcbLayerRole,
  parentId: string | null,
): readonly LayerNode[] | null {
  const tree = getPcbLayer(stack, role).children;
  if (parentId === null) return tree;
  const found = findNodeById(tree, parentId);
  return found && isGroupNode(found.node) ? found.node.children : null;
}

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

// The tail is local to one material or ordinary group. There is deliberately
// no document-root tail: fixed containers cannot be reordered or outdented.
export function resolveTailDropSlot(
  stack: PcbLayerStack,
  role: PcbLayerRole,
  parentId: string | null,
  draggedIds: readonly string[],
): DropSlot | null {
  const siblings = childrenOf(stack, role, parentId);
  if (!siblings) return null;
  return {
    role,
    parentId,
    anchorId: firstNonDraggedId(siblings, 0, new Set(draggedIds)),
  };
}

export function resolveDropSlot(
  stack: PcbLayerStack,
  rowId: string,
  zone: DropZone,
  draggedIds: readonly string[],
  collapsedGroupIds: ReadonlySet<string>,
): DropSlot | null {
  const dragged = new Set(draggedIds);
  const found = findPcbNodeById(stack, rowId);
  if (!found) return null;
  const { node, role } = found;

  if (zone === 'into') {
    if (!isGroupNode(node)) return null;
    return {
      role,
      parentId: node.id,
      anchorId: firstNonDraggedId(node.children, 0, dragged),
    };
  }

  const parentId = found.pathIds[found.pathIds.length - 1] ?? null;
  const siblings = childrenOf(stack, role, parentId);
  if (!siblings) return null;
  const rowIndex = siblings.findIndex((sibling) => sibling.id === rowId);
  if (rowIndex < 0) return null;

  if (zone === 'before') {
    return {
      role,
      parentId,
      anchorId: firstNonDraggedId(siblings, rowIndex + 1, dragged),
    };
  }
  if (isGroupNode(node) && !collapsedGroupIds.has(node.id)) {
    return { role, parentId: node.id, anchorId: null };
  }
  return {
    role,
    parentId,
    anchorId: firstNonDraggedId(siblings, rowIndex, dragged),
  };
}

export function invalidDropReason(
  stack: PcbLayerStack,
  slot: DropSlot,
  draggedIds: readonly string[],
): DropRejection | null {
  const dragged = new Set(draggedIds);
  const targetTree = getPcbLayer(stack, slot.role).children;
  let chainDepth = 0;
  if (slot.parentId !== null) {
    if (dragged.has(slot.parentId)) return 'cycle';
    const parent = findNodeById(targetTree, slot.parentId);
    if (!parent || !isGroupNode(parent.node)) return 'cycle';
    if (parent.pathIds.some((ancestorId) => dragged.has(ancestorId))) return 'cycle';
    chainDepth = parent.pathIds.length + 1;
  }
  for (const id of draggedIds) {
    const found = findPcbNodeById(stack, id);
    if (!found) return 'cycle';
    if (isGroupNode(found.node) && findNodeById([found.node], slot.parentId ?? '')) {
      return 'cycle';
    }
    const depth = maxSubtreeDepth(found.node);
    if (depth >= 1 && chainDepth + depth - 1 > MAX_GROUP_DEPTH) return 'depth-cap';
  }
  return null;
}

export function executeDrop(
  stack: PcbLayerStack,
  draggedIds: readonly string[],
  slot: DropSlot,
): PcbLayerStack {
  let next = stack;
  for (const id of draggedIds) {
    const siblings = childrenOf(next, slot.role, slot.parentId);
    if (!siblings) return stack;
    const withoutSelf = siblings.filter((sibling) => sibling.id !== id);
    const anchorIndex =
      slot.anchorId === null
        ? -1
        : withoutSelf.findIndex((sibling) => sibling.id === slot.anchorId);
    next = movePcbNode(
      next,
      id,
      slot.role,
      slot.parentId,
      anchorIndex < 0 ? withoutSelf.length : anchorIndex,
    );
  }
  return sameStackStructure(stack, next) ? stack : next;
}

function sameStackStructure(a: PcbLayerStack, b: PcbLayerStack): boolean {
  if (a === b) return true;
  return a.every(
    (container, index) =>
      container.role === b[index].role &&
      container.hidden === b[index].hidden &&
      sameTreeStructure(container.children, b[index].children),
  );
}

function sameTreeStructure(a: readonly LayerNode[], b: readonly LayerNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const nodeA = a[i];
    const nodeB = b[i];
    if (nodeA === nodeB) continue;
    if (!isGroupNode(nodeA) || !isGroupNode(nodeB) || nodeA.id !== nodeB.id) return false;
    if (!sameTreeStructure(nodeA.children, nodeB.children)) return false;
  }
  return true;
}
