// The selectIds()/selectedIds semantics required by issue #44: every read of
// ToolContext.selectedIds goes through normalizeSelectedIds (see Editor.tsx),
// so these tests pin the contract — de-dupe, stale-id filtering, and
// deterministic DOCUMENT order.
import { describe, expect, it } from 'vitest';
import type { Layer, ShapeLayer } from '@zpd/core';
import { normalizeSelectedIds } from './selection';

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

describe('normalizeSelectedIds', () => {
  it('de-duplicates repeated ids', () => {
    expect(normalizeSelectedIds(['b', 'b', 'b'], LAYERS)).toEqual(['b']);
    expect(normalizeSelectedIds(['a', 'b', 'a'], LAYERS)).toEqual(['a', 'b']);
  });

  it('filters ids not present in the doc (stale after a delete/undo)', () => {
    expect(normalizeSelectedIds(['a', 'ghost', 'c'], LAYERS)).toEqual(['a', 'c']);
    expect(normalizeSelectedIds(['ghost'], LAYERS)).toEqual([]);
  });

  it('returns DOCUMENT order, not click order', () => {
    expect(normalizeSelectedIds(['d', 'a', 'c'], LAYERS)).toEqual(['a', 'c', 'd']);
    expect(normalizeSelectedIds(['c', 'a', 'd'], LAYERS)).toEqual(['a', 'c', 'd']);
  });

  it('is deterministic for the same set regardless of input permutation', () => {
    const expected = normalizeSelectedIds(['a', 'b', 'd'], LAYERS);
    expect(normalizeSelectedIds(['d', 'b', 'a'], LAYERS)).toEqual(expected);
    expect(normalizeSelectedIds(['b', 'd', 'a', 'b'], LAYERS)).toEqual(expected);
  });

  it('handles the empty selection and the empty doc', () => {
    expect(normalizeSelectedIds([], LAYERS)).toEqual([]);
    expect(normalizeSelectedIds(['a'], [])).toEqual([]);
  });

  it('passes a single valid id through unchanged (the 0/1 status quo)', () => {
    expect(normalizeSelectedIds(['b'], LAYERS)).toEqual(['b']);
  });
});
