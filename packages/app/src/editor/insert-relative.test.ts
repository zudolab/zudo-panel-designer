import { describe, expect, it } from 'vitest';
import {
  createPcbLayerStack,
  findPcbNodeById,
  MAX_GROUP_DEPTH,
  type GroupNode,
  type LayerNode,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import { insertNewNodeRelativeToSelection } from './insert-relative';

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

function childIds(stack: PcbLayerStack, role: 'copper' | 'solder-mask' | 'silkscreen'): string[] {
  return stack.find((c) => c.role === role)!.children.map((n) => n.id);
}

describe('insertNewNodeRelativeToSelection', () => {
  it('falls back to appending at the top of defaultRole when nothing is selected', () => {
    const stack = createPcbLayerStack({ copper: [shape('a')] });
    const next = insertNewNodeRelativeToSelection(stack, [], shape('new'), 'copper');
    expect(childIds(next, 'copper')).toEqual(['a', 'new']);
  });

  it('lands directly above the selected leaf, inside the SAME container as the anchor — not defaultRole', () => {
    const stack = createPcbLayerStack({
      'solder-mask': [shape('sm-a'), shape('sm-b')],
    });
    // defaultRole is 'copper' — but the anchor lives in solder-mask, so the
    // new node must follow the anchor's container, not the tool's default.
    const next = insertNewNodeRelativeToSelection(stack, ['sm-a'], shape('new'), 'copper');
    expect(childIds(next, 'solder-mask')).toEqual(['sm-a', 'new', 'sm-b']);
    expect(childIds(next, 'copper')).toEqual([]);
  });

  it('anchors to the visually topmost maximal root across a multi-container selection', () => {
    const stack = createPcbLayerStack({
      copper: [shape('cu-a')],
      silkscreen: [shape('sk-a')],
    });
    // silkscreen sits above copper in stack/paint order, so a selection
    // spanning both containers anchors to the silkscreen member.
    const next = insertNewNodeRelativeToSelection(
      stack,
      ['cu-a', 'sk-a'],
      shape('new'),
      'copper',
    );
    expect(childIds(next, 'copper')).toEqual(['cu-a']);
    expect(childIds(next, 'silkscreen')).toEqual(['sk-a', 'new']);
  });

  it('inserts inside the same group, directly above a selected nested leaf', () => {
    const stack = createPcbLayerStack({
      copper: [group('g1', [shape('a'), shape('b')])],
    });
    const next = insertNewNodeRelativeToSelection(stack, ['a'], shape('new'), 'copper');
    const found = findPcbNodeById(next, 'g1');
    expect(found?.node).toMatchObject({ kind: 'group', children: [{ id: 'a' }, { id: 'new' }, { id: 'b' }] });
  });

  it('inserts above a selected group as its sibling, not inside it', () => {
    const stack = createPcbLayerStack({
      copper: [shape('a'), group('g1', [shape('b')]), shape('c')],
    });
    const next = insertNewNodeRelativeToSelection(stack, ['g1'], shape('new'), 'copper');
    expect(childIds(next, 'copper')).toEqual(['a', 'g1', 'new', 'c']);
  });

  it('picks the topmost maximal root, collapsing a group+descendant overlap via maximalPcbSelectedRoots', () => {
    const stack = createPcbLayerStack({
      copper: [group('g1', [shape('a'), shape('b')]), shape('c')],
    });
    // 'a' is inside 'g1', which is also directly selected -- the maximal
    // roots collapse to just 'g1', so the new node lands above the group.
    const next = insertNewNodeRelativeToSelection(stack, ['g1', 'a'], shape('new'), 'copper');
    expect(childIds(next, 'copper')).toEqual(['g1', 'new', 'c']);
  });

  it('falls back to defaultRole when the anchored insert violates the group-depth cap', () => {
    const stack = createPcbLayerStack({ 'solder-mask': [group('g0', [shape('leaf')])] });
    // A 9-level-deep group is legal at the TOP level (ancestorGroups=0 ->
    // 0+9-1=8, exactly MAX_GROUP_DEPTH) but not one level inside an existing
    // group (ancestorGroups=1 -> 1+9-1=9, over the cap). The anchor 'leaf'
    // sits inside 'g0', so the anchored insert is refused and the fallback
    // lands the group at the top of defaultRole instead.
    let oversized: LayerNode = shape('inner');
    for (let i = 0; i < MAX_GROUP_DEPTH + 1; i += 1) oversized = group(`og-${i}`, [oversized]);

    const next = insertNewNodeRelativeToSelection(stack, ['leaf'], oversized, 'copper');
    expect(childIds(next, 'copper')).toEqual([oversized.id]);
    expect(childIds(next, 'solder-mask')).toEqual(['g0']); // refused there, unchanged
  });

  it('commits nothing and selects nothing when both the anchored insert and the fallback are refused', () => {
    // 'dup' already exists in copper, so inserting ANOTHER node with the same
    // id anywhere in the stack -- the anchored insert into solder-mask as
    // well as the top-level defaultRole fallback -- is refused by
    // insertPcbNode's id-collision guard (canAdmitPcbNodes).
    const stack = createPcbLayerStack({
      copper: [shape('dup')],
      'solder-mask': [shape('anchor')],
    });
    const next = insertNewNodeRelativeToSelection(stack, ['anchor'], shape('dup'), 'copper');
    expect(next).toBe(stack);
  });
});
