import { describe, expect, it } from 'vitest';
import {
  createPcbLayerStack,
  getPcbLayer,
  isGroupNode,
  type GroupNode,
  type LayerNode,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import {
  executeDrop,
  invalidDropReason,
  resolveDropSlot,
  resolveTailDropSlot,
} from './layer-list-dnd';

function shape(id: string): ShapeLayer {
  return {
    id,
    name: id.toUpperCase(),
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: 1,
  };
}

function group(id: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name: id, children };
}

const NONE = new Set<string>();

// Bottom -> top: a, G(b, c), d. Panel renders [d, G, c, b, a] top-first.
function fixture(): PcbLayerStack {
  return createPcbLayerStack({
    copper: [shape('a'), group('G', [shape('b'), shape('c')]), shape('d')],
  });
}

// A chain of nested groups g1..gN (g1 top-level) with a leaf in the deepest.
function chain(depth: number): LayerNode[] {
  let node: LayerNode = shape('leaf');
  for (let i = depth; i >= 1; i -= 1) node = group(`g${i}`, [node]);
  return [node];
}

function topIds(stack: PcbLayerStack): string[] {
  return getPcbLayer(stack, 'copper').children.map((n) => n.id);
}

function childIds(stack: PcbLayerStack, groupId: string): string[] {
  const walk = (nodes: LayerNode[]): string[] | null => {
    for (const n of nodes) {
      if (!isGroupNode(n)) continue;
      if (n.id === groupId) return n.children.map((c) => c.id);
      const found = walk(n.children);
      if (found) return found;
    }
    return null;
  };
  return walk(getPcbLayer(stack, 'copper').children) ?? [];
}

describe('resolveDropSlot', () => {
  it("'into' a group anchors at its array-index-0 child (the issue's moveNodeToParent(child, group, 0) slot)", () => {
    expect(resolveDropSlot(fixture(), 'G', 'into', ['a'], NONE)).toEqual({
      role: 'copper',
      parentId: 'G',
      anchorId: 'b',
    });
  });

  it("'into' an empty group appends (anchor null)", () => {
    expect(
      resolveDropSlot(createPcbLayerStack({ copper: [group('G', [])] }), 'G', 'into', ['x'], NONE),
    ).toEqual({ role: 'copper', parentId: 'G', anchorId: null });
  });

  it("'into' a leaf row is not a slot", () => {
    expect(resolveDropSlot(fixture(), 'a', 'into', ['d'], NONE)).toBeNull();
  });

  it("'before' a top row appends at the top level (visual top = array end)", () => {
    expect(resolveDropSlot(fixture(), 'd', 'before', ['a'], NONE)).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: null,
    });
  });

  it("'after' a leaf targets the slot before it in array order", () => {
    expect(resolveDropSlot(fixture(), 'a', 'after', ['d'], NONE)).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: 'a',
    });
  });

  it("'before' a nested leaf stays inside its group", () => {
    expect(resolveDropSlot(fixture(), 'b', 'before', ['a'], NONE)).toEqual({
      role: 'copper',
      parentId: 'G',
      anchorId: 'c',
    });
  });

  it("'after' an EXPANDED group header goes inside the group at its visual top", () => {
    expect(resolveDropSlot(fixture(), 'G', 'after', ['a'], NONE)).toEqual({
      role: 'copper',
      parentId: 'G',
      anchorId: null,
    });
  });

  it("'after' a COLLAPSED group header stays a sibling slot in the group's parent", () => {
    expect(resolveDropSlot(fixture(), 'G', 'after', ['a'], new Set(['G']))).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: 'G',
    });
  });

  it('anchors skip dragged siblings (they leave the array in the same drop)', () => {
    // 'after' a: slot before a — but a itself is dragged, so anchor falls to G.
    expect(resolveDropSlot(fixture(), 'a', 'after', ['a', 'd'], NONE)).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: 'G',
    });
    // 'into' G with b dragged: anchor falls past b to c.
    expect(resolveDropSlot(fixture(), 'G', 'into', ['b'], NONE)).toEqual({
      role: 'copper',
      parentId: 'G',
      anchorId: 'c',
    });
  });

  it('unknown row id resolves to null', () => {
    expect(resolveDropSlot(fixture(), 'nope', 'before', ['a'], NONE)).toBeNull();
  });
});

describe('invalidDropReason', () => {
  it('rejects dropping a group into itself', () => {
    expect(
      invalidDropReason(fixture(), { role: 'copper', parentId: 'G', anchorId: null }, ['G']),
    ).toBe('cycle');
  });

  it('rejects dropping a group into its own descendant', () => {
    const tree = createPcbLayerStack({ copper: [group('outer', [group('inner', [shape('x')])])] });
    expect(
      invalidDropReason(tree, { role: 'copper', parentId: 'inner', anchorId: null }, ['outer']),
    ).toBe('cycle');
  });

  it('rejects when ANY dragged root would cycle (multi-drag)', () => {
    expect(
      invalidDropReason(fixture(), { role: 'copper', parentId: 'G', anchorId: null }, ['d', 'G']),
    ).toBe('cycle');
  });

  it('accepts a leaf into the deepest legal group (leaves are never depth-capped — parser ground truth)', () => {
    // g9 sits at ancestor-group-count 8 == MAX_GROUP_DEPTH: legal, and a leaf
    // inside it adds no group nesting.
    const tree = createPcbLayerStack({ copper: [...chain(9), shape('solo')] });
    expect(
      invalidDropReason(tree, { role: 'copper', parentId: 'g9', anchorId: null }, ['solo']),
    ).toBeNull();
  });

  it('accepts a group whose deepest nested group lands exactly AT the cap', () => {
    // Into g8 (chainDepth 8): a flat group (maxSubtreeDepth 1) lands its only
    // group at depth 8 — the boundary the parser still accepts.
    const tree = createPcbLayerStack({ copper: [...chain(9), group('H', [shape('x')])] });
    expect(
      invalidDropReason(tree, { role: 'copper', parentId: 'g8', anchorId: null }, ['H']),
    ).toBeNull();
  });

  it('rejects a group one past the cap', () => {
    // Into g9 (chainDepth 9): the dragged group itself would sit at depth 9.
    const tree = createPcbLayerStack({ copper: [...chain(9), group('H', [shape('x')])] });
    expect(invalidDropReason(tree, { role: 'copper', parentId: 'g9', anchorId: null }, ['H'])).toBe(
      'depth-cap',
    );
  });

  it('counts the dragged subtree height, not just the dragged root', () => {
    // H(H2(x)) has maxSubtreeDepth 2: into g8 its deepest group lands at 9.
    const tree = createPcbLayerStack({
      copper: [...chain(9), group('H', [group('H2', [shape('x')])])],
    });
    expect(invalidDropReason(tree, { role: 'copper', parentId: 'g8', anchorId: null }, ['H'])).toBe(
      'depth-cap',
    );
    expect(
      invalidDropReason(tree, { role: 'copper', parentId: 'g7', anchorId: null }, ['H']),
    ).toBeNull();
  });

  it('top-level drops are never depth-capped for any legal subtree', () => {
    const tree = createPcbLayerStack({ copper: chain(9) });
    expect(
      invalidDropReason(tree, { role: 'copper', parentId: null, anchorId: null }, ['g1']),
    ).toBeNull();
  });
});

describe('executeDrop', () => {
  it('moves a node directly before the anchor', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['d'], { role: 'copper', parentId: null, anchorId: 'a' });
    expect(topIds(next)).toEqual(['d', 'a', 'G']);
  });

  it('interprets the index post-removal for a same-parent downward move', () => {
    // a moved to "before d" — its own removal shifts d left; the anchor-based
    // executor must still land a directly before d.
    const tree = fixture();
    const next = executeDrop(tree, ['a'], { role: 'copper', parentId: null, anchorId: 'd' });
    expect(topIds(next)).toEqual(['G', 'a', 'd']);
  });

  it('appends on a null anchor', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['a'], { role: 'copper', parentId: null, anchorId: null });
    expect(topIds(next)).toEqual(['G', 'd', 'a']);
  });

  it('moves a multi-root batch as one contiguous run preserving DFS order', () => {
    const tree = fixture();
    const next = executeDrop(tree, ['a', 'd'], { role: 'copper', parentId: 'G', anchorId: 'b' });
    expect(topIds(next)).toEqual(['G']);
    expect(childIds(next, 'G')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns the SAME reference when the drop is a pure no-op', () => {
    const tree = fixture();
    // a is already directly before G.
    expect(executeDrop(tree, ['a'], { role: 'copper', parentId: null, anchorId: 'G' })).toBe(tree);
  });

  it('returns the SAME reference when a multi-root batch lands back in its own positions', () => {
    // [a, G] dropped right back before d: each individual move rebuilds the
    // array, but the batch as a whole changes nothing — must not look like a
    // change to the caller (no phantom history entry).
    const tree = fixture();
    expect(executeDrop(tree, ['a', 'G'], { role: 'copper', parentId: null, anchorId: 'd' })).toBe(
      tree,
    );
  });

  it('a structurally identical no-op inside a group also keeps the reference', () => {
    const tree = fixture();
    expect(executeDrop(tree, ['b', 'c'], { role: 'copper', parentId: 'G', anchorId: null })).toBe(
      tree,
    );
  });

  it('moves an ordinary subtree across materials and normalizes every descendant paint', () => {
    const tree = createPcbLayerStack({
      copper: [group('G', [shape('a'), group('H', [shape('b')])])],
    });
    const next = executeDrop(tree, ['G'], {
      role: 'silkscreen',
      parentId: null,
      anchorId: null,
    });
    expect(getPcbLayer(next, 'copper').children).toEqual([]);
    const moved = getPcbLayer(next, 'silkscreen').children[0];
    expect(moved.id).toBe('G');
    const colors: number[] = [];
    const collect = (nodes: LayerNode[]): void => {
      for (const node of nodes) {
        if (isGroupNode(node)) collect(node.children);
        else if ('color' in node) colors.push(node.color);
      }
    };
    collect(getPcbLayer(next, 'silkscreen').children);
    expect(colors).toEqual([2, 2]);
  });

  it('rejects fixed roots as drag members before executing a move', () => {
    const tree = fixture();
    expect(
      invalidDropReason(tree, { role: 'silkscreen', parentId: null, anchorId: null }, [
        'pcb-layer-copper',
      ]),
    ).toBe('cycle');
  });
});

describe('resolveTailDropSlot', () => {
  it('targets the visual bottom of the top level (array index 0 anchor)', () => {
    expect(resolveTailDropSlot(fixture(), 'copper', null, ['d'])).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: 'a',
    });
  });

  it("targets the visual bottom of a group's children", () => {
    expect(resolveTailDropSlot(fixture(), 'copper', 'G', ['a'])).toEqual({
      role: 'copper',
      parentId: 'G',
      anchorId: 'b',
    });
  });

  it('skips dragged siblings when anchoring', () => {
    expect(resolveTailDropSlot(fixture(), 'copper', null, ['a'])).toEqual({
      role: 'copper',
      parentId: null,
      anchorId: 'G',
    });
  });

  it('makes the below-an-expanded-group outdent slot reachable', () => {
    // [G([a])]: no row zone can produce the top-level slot below G — the
    // tail slot is that target.
    const tree = createPcbLayerStack({ copper: [group('G', [shape('a')])] });
    const slot = resolveTailDropSlot(tree, 'copper', null, ['a']);
    expect(slot).toEqual({ role: 'copper', parentId: null, anchorId: 'G' });
    expect(topIds(executeDrop(tree, ['a'], slot!))).toEqual(['a', 'G']);
    expect(childIds(executeDrop(tree, ['a'], slot!), 'G')).toEqual([]);
  });

  it('resolves null for a vanished parent', () => {
    expect(resolveTailDropSlot(fixture(), 'copper', 'nope', ['a'])).toBeNull();
  });
});
