// The selectIds()/selectedIds semantics required by issue #44: every read of
// ToolContext.selectedIds goes through normalizeSelectedIds (see Editor.tsx),
// so these tests pin the contract — de-dupe, stale-id filtering, and
// deterministic DOCUMENT order.
import { describe, expect, it } from 'vitest';
import { createPcbLayerStack, type Layer, type LayerNode, type ShapeLayer } from '@zpd/core';
import { nextListSelection, normalizeSelectedIds } from './selection';

function shape(id: string): ShapeLayer {
  return {
    id,
    name: id,
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: 1,
  };
}

const LAYERS: Layer[] = [shape('a'), shape('b'), shape('c'), shape('d')];
const STACK = createPcbLayerStack({ copper: LAYERS });

describe('normalizeSelectedIds', () => {
  it('de-duplicates repeated ids', () => {
    expect(normalizeSelectedIds(['b', 'b', 'b'], STACK)).toEqual(['b']);
    expect(normalizeSelectedIds(['a', 'b', 'a'], STACK)).toEqual(['a', 'b']);
  });

  it('filters ids not present in the doc (stale after a delete/undo)', () => {
    expect(normalizeSelectedIds(['a', 'ghost', 'c'], STACK)).toEqual(['a', 'c']);
    expect(normalizeSelectedIds(['ghost'], STACK)).toEqual([]);
  });

  it('returns DOCUMENT order, not click order', () => {
    expect(normalizeSelectedIds(['d', 'a', 'c'], STACK)).toEqual(['a', 'c', 'd']);
    expect(normalizeSelectedIds(['c', 'a', 'd'], STACK)).toEqual(['a', 'c', 'd']);
  });

  it('is deterministic for the same set regardless of input permutation', () => {
    const expected = normalizeSelectedIds(['a', 'b', 'd'], STACK);
    expect(normalizeSelectedIds(['d', 'b', 'a'], STACK)).toEqual(expected);
    expect(normalizeSelectedIds(['b', 'd', 'a', 'b'], STACK)).toEqual(expected);
  });

  it('handles the empty selection and the empty doc', () => {
    expect(normalizeSelectedIds([], STACK)).toEqual([]);
    expect(normalizeSelectedIds(['a'], createPcbLayerStack())).toEqual([]);
  });

  // #151: the selection may hold GROUP ids — they survive normalization and
  // sort by tree DFS position (a group id immediately precedes its
  // descendants); stale group ids drop like stale leaf ids.
  it('keeps group ids and orders the mixed selection by tree DFS', () => {
    const tree: LayerNode[] = [
      shape('a'),
      { kind: 'group', id: 'G', name: 'G', children: [shape('b'), shape('c')] },
      shape('d'),
    ];
    const stack = createPcbLayerStack({ copper: tree });
    expect(normalizeSelectedIds(['d', 'c', 'G', 'a'], stack)).toEqual(['a', 'G', 'c', 'd']);
    expect(normalizeSelectedIds(['G'], stack)).toEqual(['G']);
    expect(normalizeSelectedIds(['staleGroup', 'b'], stack)).toEqual(['b']);
  });

  it('passes a single valid id through unchanged (the 0/1 status quo)', () => {
    expect(normalizeSelectedIds(['b'], STACK)).toEqual(['b']);
  });
});

describe('nextListSelection', () => {
  const ORDER = ['a', 'b', 'c', 'd'] as const;
  const plain = { shift: false, meta: false };
  const meta = { shift: false, meta: true };
  const shift = { shift: true, meta: false };

  it('plain click selects exactly one and sets the anchor', () => {
    expect(
      nextListSelection({ selectedIds: ['a', 'b'], anchorId: 'a' }, ORDER, 'c', plain),
    ).toEqual({
      selectedIds: ['c'],
      anchorId: 'c',
    });
  });

  it('meta-click adds an unselected id and moves the anchor to it', () => {
    expect(nextListSelection({ selectedIds: ['a'], anchorId: 'a' }, ORDER, 'c', meta)).toEqual({
      selectedIds: ['a', 'c'],
      anchorId: 'c',
    });
  });

  it('meta-click on a selected id toggles it off', () => {
    expect(nextListSelection({ selectedIds: ['a', 'c'], anchorId: 'c' }, ORDER, 'a', meta)).toEqual(
      {
        selectedIds: ['c'],
        anchorId: 'a',
      },
    );
  });

  it('shift-click selects the document-order range from the anchor, inclusive', () => {
    expect(nextListSelection({ selectedIds: ['b'], anchorId: 'b' }, ORDER, 'd', shift)).toEqual({
      selectedIds: ['b', 'c', 'd'],
      anchorId: 'b',
    });
  });

  it('shift-range is direction-agnostic (clicking above the anchor)', () => {
    expect(nextListSelection({ selectedIds: ['c'], anchorId: 'c' }, ORDER, 'a', shift)).toEqual({
      selectedIds: ['a', 'b', 'c'],
      anchorId: 'c',
    });
  });

  it('shift-click PRESERVES the anchor so the range can be re-dragged', () => {
    const afterFirst = nextListSelection({ selectedIds: ['b'], anchorId: 'b' }, ORDER, 'd', shift);
    expect(afterFirst.anchorId).toBe('b');
    // A second shift-click from the SAME anchor shrinks the range.
    expect(nextListSelection(afterFirst, ORDER, 'c', shift)).toEqual({
      selectedIds: ['b', 'c'],
      anchorId: 'b',
    });
  });

  it('shift-click with no usable anchor falls back to a plain single select', () => {
    expect(nextListSelection({ selectedIds: [], anchorId: null }, ORDER, 'c', shift)).toEqual({
      selectedIds: ['c'],
      anchorId: 'c',
    });
    // stale anchor (deleted layer) is treated the same way
    expect(nextListSelection({ selectedIds: [], anchorId: 'gone' }, ORDER, 'c', shift)).toEqual({
      selectedIds: ['c'],
      anchorId: 'c',
    });
  });

  it('shift wins over meta when both modifiers are held', () => {
    expect(
      nextListSelection({ selectedIds: ['a'], anchorId: 'a' }, ORDER, 'c', {
        shift: true,
        meta: true,
      }),
    ).toEqual({ selectedIds: ['a', 'b', 'c'], anchorId: 'a' });
  });
});
