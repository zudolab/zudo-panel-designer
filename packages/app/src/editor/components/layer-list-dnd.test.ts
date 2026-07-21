import { describe, expect, it } from 'vitest';
import { isGroupNode, type GroupNode, type LayerNode, type ShapeLayer } from '@zpd/core';
import { executeDrop, invalidDropReason, resolveDropSlot } from './layer-list-dnd';

function shape(id: string): ShapeLayer {
  return { id, name: id.toUpperCase(), type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, color: 1 };
}

function group(id: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name: id, children };
}

const NONE = new Set<string>();

// Bottom -> top: a, G(b, c), d. Panel renders [d, G, c, b, a] top-first.
function fixture(): LayerNode[] {
  return [shape('a'), group('G', [shape('b'), shape('c')]), shape('d')];
}

// A chain of nested groups g1..gN (g1 top-level) with a leaf in the deepest.
function chain(depth: number): LayerNode[] {
  let node: LayerNode = shape('leaf');
  for (let i = depth; i >= 1; i -= 1) node = group(`g${i}`, [node]);
  return [node];
}

function topIds(tree: LayerNode[]): string[] {
  return tree.map((n) => n.id);
}

function childIds(tree: LayerNode[], groupId: string): string[] {
  const walk = (nodes: LayerNode[]): string[] | null => {
    for (const n of nodes) {
      if (!isGroupNode(n)) continue;
      if (n.id === groupId) return n.children.map((c) => c.id);
      const found = walk(n.children);
      if (found) return found;
    }
    return null;
  };
  return walk(tree) ?? [];
}

describe('resolveDropSlot', () => {
  it("'into' a group anchors at its array-index-0 child (the issue's moveNodeToParent(child, group, 0) slot)", () => {
    expect(resolveDropSlot(fixture(), 'G', 'into', ['a'], NONE)).toEqual({ parentId: 'G', anchorId: 'b' });
  });

  it("'into' an empty group appends (anchor null)", () => {
    expect(resolveDropSlot([group('G', [])], 'G', 'into', ['x'], NONE)).toEqual({ parentId: 'G', anchorId: null });
  });

  it("'into' a leaf row is not a slot", () => {
    expect(resolveDropSlot(fixture(), 'a', 'into', ['d'], NONE)).toBeNull();
  });

  it("'before' a top row appends at the top level (visual top = array end)", () => {
    expect(resolveDropSlot(fixture(), 'd', 'before', ['a'], NONE)).toEqual({ parentId: null, anchorId: null });
  });

  it("'after' a leaf targets the slot before it in array order", () => {
    expect(resolveDropSlot(fixture(), 'a', 'after', ['d'], NONE)).toEqual({ parentId: null, anchorId: 'a' });
  });

  it("'before' a nested leaf stays inside its group", () => {
    expect(resolveDropSlot(fixture(), 'b', 'before', ['a'], NONE)).toEqual({ parentId: 'G', anchorId: 'c' });
  });

  it("'after' an EXPANDED group header goes inside the group at its visual top", () => {
    expect(resolveDropSlot(fixture(), 'G', 'after', ['a'], NONE)).toEqual({ parentId: 'G', anchorId: null });
  });

  it("'after' a COLLAPSED group header stays a sibling slot in the group's parent", () => {
    expect(resolveDropSlot(fixture(), 'G', 'after', ['a'], new Set(['G']))).toEqual({
      parentId: null,
      anchorId: 'G',
    });
  });

  it('anchors skip dragged siblings (they leave the array in the same drop)', () => {
    // 'after' a: slot before a — but a itself is dragged, so anchor falls to G.
    expect(resolveDropSlot(fixture(), 'a', 'after', ['a', 'd'], NONE)).toEqual({ parentId: null, anchorId: 'G' });
    // 'into' G with b dragged: anchor falls past b to c.
    expect(resolveDropSlot(fixture(), 'G', 'into', ['b'], NONE)).toEqual({ parentId: 'G', anchorId: 'c' });
  });

  it('unknown row id resolves to null', () => {
    expect(resolveDropSlot(fixture(), 'nope', 'before', ['a'], NONE)).toBeNull();
  });
});

describe('invalidDropReason', () => {
  it('rejects dropping a group into itself', () => {
    expect(invalidDropReason(fixture(), { parentId: 'G', anchorId: null }, ['G'])).toBe('cycle');
  });

  it('rejects dropping a group into its own descendant', () => {
    const tree = [group('outer', [group('inner', [shape('x')])])];
    expect(invalidDropReason(tree, { parentId: 'inner', anchorId: null }, ['outer'])).toBe('cycle');
  });

  it('rejects when ANY dragged root would cycle (multi-drag)', () => {
    expect(invalidDropReason(fixture(), { parentId: 'G', anchorId: null }, ['d', 'G'])).toBe('cycle');
  });

  it('accepts a leaf into the deepest legal group (leaves are never depth-capped — parser ground truth)', () => {
    // g9 sits at ancestor-group-count 8 == MAX_GROUP_DEPTH: legal, and a leaf
    // inside it adds no group nesting.
    const tree = [...chain(9), shape('solo')];
    expect(invalidDropReason(tree, { parentId: 'g9', anchorId: null }, ['solo'])).toBeNull();
  });

  it('accepts a group whose deepest nested group lands exactly AT the cap', () => {
    // Into g8 (chainDepth 8): a flat group (maxSubtreeDepth 1) lands its only
    // group at depth 8 — the boundary the parser still accepts.
    const tree = [...chain(9), group('H', [shape('x')])];
    expect(invalidDropReason(tree, { parentId: 'g8', anchorId: null }, ['H'])).toBeNull();
  });

  it('rejects a group one past the cap', () => {
    // Into g9 (chainDepth 9): the dragged group itself would sit at depth 9.
    const tree = [...chain(9), group('H', [shape('x')])];
    expect(invalidDropReason(tree, { parentId: 'g9', anchorId: null }, ['H'])).toBe('depth-cap');
  });

  it('counts the dragged subtree height, not just the dragged root', () => {
    // H(H2(x)) has maxSubtreeDepth 2: into g8 its deepest group lands at 9.
    const tree = [...chain(9), group('H', [group('H2', [shape('x')])])];
    expect(invalidDropReason(tree, { parentId: 'g8', anchorId: null }, ['H'])).toBe('depth-cap');
    expect(invalidDropReason(tree, { parentId: 'g7', anchorId: null }, ['H'])).toBeNull();
  });

  it('top-level drops are never depth-capped for any legal subtree', () => {
    const tree = chain(9);
    expect(invalidDropReason(tree, { parentId: null, anchorId: null }, ['g1'])).toBeNull();
  });
});

describe('executeDrop', () => {
  it('moves a node directly before the anchor', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['d'], { parentId: null, anchorId: 'a' });
    expect(topIds(next)).toEqual(['d', 'a', 'G']);
  });

  it('interprets the index post-removal for a same-parent downward move', () => {
    // a moved to "before d" — its own removal shifts d left; the anchor-based
    // executor must still land a directly before d.
    const tree = fixture();
    const next = executeDrop(tree, ['a'], { parentId: null, anchorId: 'd' });
    expect(topIds(next)).toEqual(['G', 'a', 'd']);
  });

  it('appends on a null anchor', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['a'], { parentId: null, anchorId: null });
    expect(topIds(next)).toEqual(['G', 'd', 'a']);
  });

  it('moves a multi-root batch as one contiguous run preserving DFS order', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['a', 'd'], { parentId: 'G', anchorId: 'b' });
    expect(topIds(next)).toEqual(['G']);
    expect(childIds(next, 'G')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the SAME reference when the drop is a pure no-op', () => {
    const tree = fixture();
    // a is already directly before G.
    expect(executeDrop(tree, ['a'], { parentId: null, anchorId: 'G' })).toBe(tree);
  });
});
