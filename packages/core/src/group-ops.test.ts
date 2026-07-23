import { describe, expect, it } from 'vitest';
import {
  cloneNodeWithFreshIds,
  collectLeafIds,
  deleteNodeById,
  depthOfNodeById,
  findNodeById,
  groupNodes,
  groupPcbNodes,
  deletePcbNodeById,
  findPcbNodeById,
  insertPcbNode,
  mapLeavesById,
  mapPcbLeavesById,
  maxSubtreeDepth,
  maximalSelectedRoots,
  moveNodeToParent,
  movePcbNode,
  renameById,
  replaceNodeWithNodes,
  toggleHiddenById,
  togglePcbLayerHidden,
  topmostAncestorId,
  ungroupGroupById,
  updateLeafById,
} from './group-ops';
import { createPcbLayerStack } from './palette';
import type { GroupNode, LayerNode, ShapeLayer } from './types';

function shape(id: string, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id,
    name: id,
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    color: 0,
    ...extra,
  };
}

function group(id: string, children: LayerNode[], extra: Partial<GroupNode> = {}): GroupNode {
  return { kind: 'group', id, name: id, children, ...extra };
}

describe('findNodeById', () => {
  it('finds a top-level node with an empty pathIds', () => {
    const s1 = shape('s1');
    const found = findNodeById([s1], 's1');
    expect(found).toEqual({ node: s1, pathIds: [] });
  });

  it('finds a nested node with root-to-target group ids (excluding the target itself)', () => {
    const s3 = shape('s3');
    const tree: LayerNode[] = [group('g1', [group('g2', [s3])])];
    const found = findNodeById(tree, 's3');
    expect(found?.pathIds).toEqual(['g1', 'g2']);
    expect(found?.node).toBe(s3);
  });

  it('returns null when the id is not found', () => {
    expect(findNodeById([shape('s1')], 'missing')).toBeNull();
  });
});

describe('collectLeafIds', () => {
  it('returns a single-element array for a leaf', () => {
    expect(collectLeafIds(shape('s1'))).toEqual(['s1']);
  });

  it('collects descendant leaf ids in DFS order, skipping group ids', () => {
    const tree = group('g1', [shape('a'), group('g2', [shape('b'), shape('c')]), shape('d')]);
    expect(collectLeafIds(tree)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns an empty array for an empty group', () => {
    expect(collectLeafIds(group('g1', []))).toEqual([]);
  });
});

describe('topmostAncestorId', () => {
  it('returns the leaf id itself when already top-level', () => {
    expect(topmostAncestorId([shape('s1')], 's1')).toBe('s1');
  });

  it('returns the top-level ancestor group id for a nested leaf', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', [shape('s1')])])];
    expect(topmostAncestorId(tree, 's1')).toBe('g1');
  });

  it('returns null when the id is not found', () => {
    expect(topmostAncestorId([shape('s1')], 'missing')).toBeNull();
  });
});

describe('maxSubtreeDepth', () => {
  it('is 0 for a leaf', () => {
    expect(maxSubtreeDepth(shape('s1'))).toBe(0);
  });

  it('is 1 for a group containing only leaves', () => {
    expect(maxSubtreeDepth(group('g1', [shape('a')]))).toBe(1);
  });

  it('is the deepest nested-group chain length', () => {
    const tree = group('g1', [group('g2', [group('g3', [shape('a')])])]);
    expect(maxSubtreeDepth(tree)).toBe(3);
  });

  it('takes the deepest branch among siblings', () => {
    const tree = group('g1', [shape('a'), group('g2', [group('g3', [shape('b')])])]);
    expect(maxSubtreeDepth(tree)).toBe(3);
  });
});

describe('depthOfNodeById', () => {
  it('is 0 for a root node', () => {
    expect(depthOfNodeById([shape('s1')], 's1')).toBe(0);
  });

  it('is depth-3 for a leaf nested three groups deep', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', [group('g3', [shape('s1')])])])];
    expect(depthOfNodeById(tree, 's1')).toBe(3);
  });

  it('is -1 when not found', () => {
    expect(depthOfNodeById([shape('s1')], 'missing')).toBe(-1);
  });
});

describe('maximalSelectedRoots', () => {
  it('drops ids that are descendants of another selected id', () => {
    const tree: LayerNode[] = [group('g1', [shape('a'), shape('b')]), shape('c')];
    expect(maximalSelectedRoots(tree, ['g1', 'a', 'c'])).toEqual(['g1', 'c']);
  });

  it('returns ids in tree DFS order regardless of input order', () => {
    const tree: LayerNode[] = [shape('a'), shape('b'), shape('c')];
    expect(maximalSelectedRoots(tree, ['c', 'a'])).toEqual(['a', 'c']);
  });

  it('ignores ids not present in the tree', () => {
    expect(maximalSelectedRoots([shape('a')], ['a', 'ghost'])).toEqual(['a']);
  });

  it('returns an empty array for an empty selection', () => {
    expect(maximalSelectedRoots([shape('a')], [])).toEqual([]);
  });
});

describe('groupNodes', () => {
  it('inserts the new group at the top-level slot of the first selected root in DFS order', () => {
    const a = shape('a');
    const b = shape('b');
    const c = shape('c');
    const tree: LayerNode[] = [a, b, c];
    const { tree: next, group: newGroup } = groupNodes(tree, ['b', 'c'], 'My Group');
    expect(newGroup).not.toBeNull();
    expect(next.map((n) => n.id)).toEqual(['a', newGroup?.id]);
    const inserted = next[1] as GroupNode;
    expect(inserted.children.map((n) => n.id)).toEqual(['b', 'c']);
    expect(inserted.name).toBe('My Group');
  });

  it('members keep world positions untouched (no offset baked in)', () => {
    const a = shape('a', { x: 10, y: 20 });
    const { group: newGroup } = groupNodes([a], ['a'], 'g');
    expect((newGroup?.children[0] as ShapeLayer).x).toBe(10);
    expect((newGroup?.children[0] as ShapeLayer).y).toBe(20);
  });

  it('returns the tree unchanged and group: null for an empty selection', () => {
    const tree: LayerNode[] = [shape('a')];
    const result = groupNodes(tree, [], 'g');
    expect(result.tree).toBe(tree);
    expect(result.group).toBeNull();
  });

  it('selecting the fabricated/expected id pattern would NOT resolve — callers must use the returned group.id', () => {
    // Regression guard for the phantom-id bug class: a caller must not mint
    // its own id and assume it matches what groupNodes inserted.
    const tree: LayerNode[] = [shape('a')];
    const { tree: next, group: newGroup } = groupNodes(tree, ['a'], 'g');
    const fabricatedId = 'group-fabricated-id-that-was-never-inserted';
    expect(newGroup?.id).not.toBe(fabricatedId);
    expect(findNodeById(next, fabricatedId)).toBeNull();
    expect(findNodeById(next, newGroup!.id)).not.toBeNull();
  });

  it('groups a nested selected root into a new top-level group, preserving the source group', () => {
    const inner = group('g1', [shape('a'), shape('b')]);
    const tree: LayerNode[] = [inner, shape('c')];
    const { tree: next, group: newGroup } = groupNodes(tree, ['b', 'c'], 'g');
    // 'b' is nested inside g1; its top-level slot is g1's position (index 0),
    // so the new group lands there and g1 (now missing 'b') stays alongside it.
    expect(next.map((n) => n.id)).toEqual([newGroup?.id, 'g1']);
    const g1After = findNodeById(next, 'g1')?.node as GroupNode;
    expect(g1After.children.map((n) => n.id)).toEqual(['a']);
  });
});

describe('ungroupGroupById', () => {
  it('splices children in at the group position, preserving z-order', () => {
    const tree: LayerNode[] = [shape('a'), group('g1', [shape('b'), shape('c')]), shape('d')];
    const next = ungroupGroupById(tree, 'g1');
    expect(next.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(ungroupGroupById(tree, 'missing')).toBe(tree);
  });

  it('returns the same reference when the id resolves to a leaf', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(ungroupGroupById(tree, 'a')).toBe(tree);
  });

  it('preserves untouched sibling references', () => {
    const a = shape('a');
    const d = shape('d');
    const tree: LayerNode[] = [a, group('g1', [shape('b')]), d];
    const next = ungroupGroupById(tree, 'g1');
    expect(next[0]).toBe(a);
    expect(next[2]).toBe(d);
  });
});

describe('moveNodeToParent', () => {
  it('two-pass insert index correctness: moving downward within the same parent', () => {
    // Moving 'a' to index 2 (post-removal) should land AFTER 'c', not before it.
    const tree: LayerNode[] = [shape('a'), shape('b'), shape('c')];
    const next = moveNodeToParent(tree, 'a', null, 2);
    expect(next.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a node into a group', () => {
    const tree: LayerNode[] = [shape('a'), group('g1', [shape('b')])];
    const next = moveNodeToParent(tree, 'a', 'g1', 0);
    expect(next.map((n) => n.id)).toEqual(['g1']);
    const g1 = next[0] as GroupNode;
    expect(g1.children.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('moves a node out of a group to top level', () => {
    const tree: LayerNode[] = [group('g1', [shape('a'), shape('b')])];
    const next = moveNodeToParent(tree, 'a', null, 0);
    expect(next.map((n) => n.id)).toEqual(['a', 'g1']);
    const g1 = next[1] as GroupNode;
    expect(g1.children.map((n) => n.id)).toEqual(['b']);
  });

  it('cycle guard: moving a group into itself no-ops by reference', () => {
    const tree: LayerNode[] = [group('g1', [shape('a')])];
    expect(moveNodeToParent(tree, 'g1', 'g1', 0)).toBe(tree);
  });

  it('cycle guard: moving a group into its own descendant no-ops by reference', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', [shape('a')])])];
    expect(moveNodeToParent(tree, 'g1', 'g2', 0)).toBe(tree);
  });

  it('returns the same reference when nodeId is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(moveNodeToParent(tree, 'missing', null, 0)).toBe(tree);
  });

  it('returns the same reference when targetParentId does not resolve to a group', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    expect(moveNodeToParent(tree, 'a', 'b', 0)).toBe(tree);
  });

  it('returns the same reference when targetParentId is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(moveNodeToParent(tree, 'a', 'ghost-parent', 0)).toBe(tree);
  });

  it('same-slot no-op: dropping a top-level node at its own post-removal index returns the same reference', () => {
    const tree: LayerNode[] = [shape('a'), shape('b'), shape('c')];
    // 'b' is already at post-removal index 1 (removing it from ['a','b','c']
    // leaves ['a','c'], and index 1 there is exactly where it started).
    expect(moveNodeToParent(tree, 'b', null, 1)).toBe(tree);
  });

  it('same-slot no-op: dropping a node at index 0 when it is already first returns the same reference', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    expect(moveNodeToParent(tree, 'a', null, 0)).toBe(tree);
  });

  it('same-slot no-op: an out-of-range index that clamps to the current slot also no-ops', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    // Removing 'b' leaves ['a'], so any index >= 1 clamps to 1 — right back
    // where 'b' already is.
    expect(moveNodeToParent(tree, 'b', null, 99)).toBe(tree);
  });

  it('same-slot no-op applies within a group parent too', () => {
    const tree: LayerNode[] = [group('g1', [shape('a'), shape('b')])];
    expect(moveNodeToParent(tree, 'b', 'g1', 1)).toBe(tree);
  });

  it('a genuine same-parent reorder is NOT treated as a no-op', () => {
    const tree: LayerNode[] = [shape('a'), shape('b'), shape('c')];
    const next = moveNodeToParent(tree, 'a', null, 1);
    expect(next).not.toBe(tree);
    expect(next.map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('deleteNodeById', () => {
  it('deletes a leaf', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    expect(deleteNodeById(tree, 'a').map((n) => n.id)).toEqual(['b']);
  });

  it('cascades: deleting a group removes all of its descendants', () => {
    const tree: LayerNode[] = [group('g1', [shape('a'), group('g2', [shape('b')])]), shape('c')];
    const next = deleteNodeById(tree, 'g1');
    expect(next.map((n) => n.id)).toEqual(['c']);
    expect(findNodeById(next, 'a')).toBeNull();
    expect(findNodeById(next, 'b')).toBeNull();
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(deleteNodeById(tree, 'missing')).toBe(tree);
  });

  it('preserves untouched sibling references', () => {
    const b = shape('b');
    const tree: LayerNode[] = [shape('a'), b];
    const next = deleteNodeById(tree, 'a');
    expect(next[0]).toBe(b);
  });
});

describe('cloneNodeWithFreshIds', () => {
  it('clones a leaf with a fresh, different id', () => {
    const original = shape('a');
    const clone = cloneNodeWithFreshIds(original) as ShapeLayer;
    expect(clone.id).not.toBe(original.id);
    expect(clone.name).toBe(original.name);
  });

  it('assigns fresh, unique ids root-to-leaf for a nested group', () => {
    const original = group('g1', [shape('a'), group('g2', [shape('b'), shape('c')])]);
    const clone = cloneNodeWithFreshIds(original) as GroupNode;

    const originalIds = new Set<string>();
    const collectIds = (node: LayerNode) => {
      originalIds.add(node.id);
      if ('children' in node) node.children.forEach(collectIds);
    };
    collectIds(original);

    const cloneIds: string[] = [];
    const collectCloneIds = (node: LayerNode) => {
      cloneIds.push(node.id);
      if ('children' in node) node.children.forEach(collectCloneIds);
    };
    collectCloneIds(clone);

    // Every cloned id is unique...
    expect(new Set(cloneIds).size).toBe(cloneIds.length);
    // ...and disjoint from every original id.
    for (const id of cloneIds) expect(originalIds.has(id)).toBe(false);
    expect(clone.id).not.toBe(original.id);
  });

  it('deep-clones leaf structure so mutating the clone does not affect the source', () => {
    const original = { ...shape('a'), width: 5 };
    const clone = cloneNodeWithFreshIds(original) as ShapeLayer;
    clone.width = 999;
    expect(original.width).toBe(5);
  });
});

describe('toggleHiddenById', () => {
  it('toggles hidden on a leaf from undefined to true', () => {
    const tree: LayerNode[] = [shape('a')];
    const next = toggleHiddenById(tree, 'a');
    expect((next[0] as ShapeLayer).hidden).toBe(true);
  });

  it('toggles hidden back to false', () => {
    const tree: LayerNode[] = [shape('a', { hidden: true })];
    const next = toggleHiddenById(tree, 'a');
    expect((next[0] as ShapeLayer).hidden).toBe(false);
  });

  it('toggles hidden on a group node', () => {
    const tree: LayerNode[] = [group('g1', [shape('a')])];
    const next = toggleHiddenById(tree, 'g1');
    expect((next[0] as GroupNode).hidden).toBe(true);
  });

  it('reaches a deeply nested node', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', [shape('a')])])];
    const next = toggleHiddenById(tree, 'a');
    const g1 = next[0] as GroupNode;
    const g2 = g1.children[0] as GroupNode;
    expect((g2.children[0] as ShapeLayer).hidden).toBe(true);
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(toggleHiddenById(tree, 'missing')).toBe(tree);
  });
});

describe('renameById', () => {
  it('renames a leaf', () => {
    const tree: LayerNode[] = [shape('a')];
    const next = renameById(tree, 'a', 'New Name');
    expect((next[0] as ShapeLayer).name).toBe('New Name');
  });

  it('renames a group', () => {
    const tree: LayerNode[] = [group('g1', [shape('a')])];
    const next = renameById(tree, 'g1', 'New Group Name');
    expect((next[0] as GroupNode).name).toBe('New Group Name');
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(renameById(tree, 'missing', 'x')).toBe(tree);
  });
});

describe('updateLeafById', () => {
  it('reaches a leaf nested three groups deep (depth-3)', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', [group('g3', [shape('a', { x: 1 })])])])];
    const next = updateLeafById(tree, 'a', (leaf) => ({ ...leaf, x: 42 }) as ShapeLayer);
    const g1 = next[0] as GroupNode;
    const g2 = g1.children[0] as GroupNode;
    const g3 = g2.children[0] as GroupNode;
    expect((g3.children[0] as ShapeLayer).x).toBe(42);
  });

  it('leaves the tree unchanged when the id resolves to a group', () => {
    const tree: LayerNode[] = [group('g1', [shape('a')])];
    expect(updateLeafById(tree, 'g1', (leaf) => leaf)).toBe(tree);
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(updateLeafById(tree, 'missing', (leaf) => leaf)).toBe(tree);
  });
});

describe('mapLeavesById', () => {
  it('applies the mapper to every listed leaf in one pass', () => {
    const tree: LayerNode[] = [
      shape('a', { x: 1 }),
      group('g1', [shape('b', { x: 2 })]),
      shape('c', { x: 3 }),
    ];
    const next = mapLeavesById(
      tree,
      ['a', 'b'],
      (leaf) => ({ ...leaf, x: (leaf as ShapeLayer).x + 100 }) as ShapeLayer,
    );
    expect((next[0] as ShapeLayer).x).toBe(101);
    const g1 = next[1] as GroupNode;
    expect((g1.children[0] as ShapeLayer).x).toBe(102);
    expect((next[2] as ShapeLayer).x).toBe(3);
  });

  it('returns the same reference for an empty id list', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(mapLeavesById(tree, [], (leaf) => leaf)).toBe(tree);
  });

  it('returns the same reference when none of the ids match', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(mapLeavesById(tree, ['missing'], (leaf) => leaf)).toBe(tree);
  });
});

describe('mapPcbLeavesById', () => {
  it('updates matching leaves under their fixed material roots without touching containers', () => {
    const stack = createPcbLayerStack({ copper: [shape('copper')], silkscreen: [shape('silk')] });
    const next = mapPcbLeavesById(stack, ['silk'], (leaf) => ({ ...leaf, name: 'Silk' }));
    expect(next[0]).toBe(stack[0]);
    expect(next[1]).toBe(stack[1]);
    expect(next[2]).not.toBe(stack[2]);
    expect(next[2].children[0]).toMatchObject({ id: 'silk', name: 'Silk' });
  });
});

describe('replaceNodeWithNodes', () => {
  it('splices replacement nodes in place of the target, at the same position', () => {
    const tree: LayerNode[] = [shape('a'), shape('b'), shape('c')];
    const next = replaceNodeWithNodes(tree, 'b', [shape('b1'), shape('b2')]);
    expect(next.map((n) => n.id)).toEqual(['a', 'b1', 'b2', 'c']);
  });

  it('splices in place inside a group', () => {
    const tree: LayerNode[] = [group('g1', [shape('a'), shape('b')])];
    const next = replaceNodeWithNodes(tree, 'b', [shape('b1'), shape('b2')]);
    const g1 = next[0] as GroupNode;
    expect(g1.children.map((n) => n.id)).toEqual(['a', 'b1', 'b2']);
  });

  it('supports replacing with zero nodes (pure removal)', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    expect(replaceNodeWithNodes(tree, 'a', []).map((n) => n.id)).toEqual(['b']);
  });

  it('returns the same reference when the id is not found', () => {
    const tree: LayerNode[] = [shape('a')];
    expect(replaceNodeWithNodes(tree, 'missing', [shape('x')])).toBe(tree);
  });
});

describe('fixed PCB-stack operations', () => {
  it('inserts and locates ordinary nodes inside a material while normalizing compatibility paint', () => {
    const stack = createPcbLayerStack();
    const next = insertPcbNode(stack, 'copper', shape('a', { color: 0 }));
    expect((findPcbNodeById(next, 'a')?.node as ShapeLayer).color).toBe(1);
    expect(findPcbNodeById(next, 'a')?.role).toBe('copper');
    expect(findPcbNodeById(next, 'pcb-layer-copper')).toBeNull();
    expect(insertPcbNode(next, 'silkscreen', shape('a'))).toBe(next);
    expect(insertPcbNode(next, 'silkscreen', shape('pcb-layer-copper'))).toBe(next);
  });

  it('moves a subtree across containers, recursively normalizes material, and preserves no-op identity', () => {
    const subtree = group('g', [shape('a', { color: 1 }), shape('b', { color: 1 })]);
    const stack = createPcbLayerStack({ copper: [subtree] });
    expect(movePcbNode(stack, 'missing', 'silkscreen', null, 0)).toBe(stack);

    const moved = movePcbNode(stack, 'g', 'silkscreen', null, 0);
    expect(moved[0].children).toEqual([]);
    const movedGroup = moved[2].children[0] as GroupNode;
    expect(movedGroup).not.toBe(subtree);
    expect(movedGroup.id).toBe(subtree.id);
    expect((movedGroup.children[0] as ShapeLayer).color).toBe(2);
    expect((movedGroup.children[1] as ShapeLayer).color).toBe(2);
  });

  it('groups only roots from one material and keeps fixed roots unavailable to ordinary operations', () => {
    const stack = createPcbLayerStack({
      copper: [shape('a')],
      silkscreen: [shape('b')],
    });
    expect(groupPcbNodes(stack, ['a', 'b'], 'Mixed')).toEqual({ stack, group: null });
    expect(deletePcbNodeById(stack, 'pcb-layer-copper')).toBe(stack);

    const grouped = groupPcbNodes(stack, ['a'], 'Copper group');
    expect(grouped.group?.name).toBe('Copper group');
    expect(grouped.stack[0].children[0]).toBe(grouped.group);
  });

  it('toggles persisted fixed visibility without touching children and preserves unaffected containers', () => {
    const stack = createPcbLayerStack({ copper: [shape('a')] });
    const next = togglePcbLayerHidden(stack, 'copper');
    expect(next[0].hidden).toBe(true);
    expect(next[0].children).toBe(stack[0].children);
    expect(next[1]).toBe(stack[1]);
    expect(next[2]).toBe(stack[2]);
  });

  it('counts only ordinary groups when enforcing the depth cap', () => {
    let deepest: LayerNode = shape('leaf');
    // Nine groups occupy legal ordinary depths 0..8 at the container root.
    for (let index = 8; index >= 0; index -= 1) {
      deepest = group(`g-${index}`, [deepest]);
    }
    const empty = createPcbLayerStack();
    const inserted = insertPcbNode(empty, 'copper', deepest);
    expect(inserted).not.toBe(empty);
    // Wrapping that root would shift its deepest group to depth 9.
    expect(groupPcbNodes(inserted, ['g-0'], 'too deep')).toEqual({
      stack: inserted,
      group: null,
    });
    // The fixed material wrapper itself consumed no depth level.
    expect(findPcbNodeById(inserted, 'leaf')?.pathIds).toHaveLength(9);
  });
});
