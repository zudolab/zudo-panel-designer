import { describe, expect, it } from 'vitest';
import {
  addLayer,
  duplicateLayer,
  removeLayer,
  renameLayer,
  reorderLayer,
  toggleLayerHidden,
  type LayerListItem,
} from './layer-ops';

const a: LayerListItem = { id: 'a', name: 'A' };
const b: LayerListItem = { id: 'b', name: 'B' };
const c: LayerListItem = { id: 'c', name: 'C' };

describe('addLayer', () => {
  it('appends to the top (end) by default', () => {
    const result = addLayer([a, b], c);
    expect(result).toEqual([a, b, c]);
    expect(result).not.toBe([a, b]); // new array
  });

  it('inserts at a given index', () => {
    expect(addLayer([a, c], b, 1)).toEqual([a, b, c]);
  });

  it('clamps an out-of-range index', () => {
    expect(addLayer([a], b, 100)).toEqual([a, b]);
    expect(addLayer([a], b, -5)).toEqual([b, a]);
  });

  it('does not mutate the input array', () => {
    const original = [a, b];
    addLayer(original, c);
    expect(original).toEqual([a, b]);
  });
});

describe('removeLayer', () => {
  it('removes the matching layer and returns a new array', () => {
    expect(removeLayer([a, b, c], 'b')).toEqual([a, c]);
  });

  it('is a no-op (new array, same contents) when the id is absent', () => {
    expect(removeLayer([a, b], 'nope')).toEqual([a, b]);
  });
});

describe('duplicateLayer', () => {
  it('places the duplicate immediately after the source (bottom -> top order), with a suffixed name', () => {
    const result = duplicateLayer([a, b], 'a', 'a2');
    expect(result).toEqual([a, { id: 'a2', name: 'A copy' }, b]);
  });

  it('supports a custom name suffix', () => {
    const result = duplicateLayer([a], 'a', 'a2', ' dup');
    expect(result[1].name).toBe('A dup');
  });

  it('is a no-op when the source id is absent', () => {
    expect(duplicateLayer([a, b], 'nope', 'x')).toEqual([a, b]);
  });
});

describe('reorderLayer', () => {
  it('moves a layer from one index to another', () => {
    expect(reorderLayer([a, b, c], 0, 2)).toEqual([b, c, a]);
    expect(reorderLayer([a, b, c], 2, 0)).toEqual([c, a, b]);
  });

  it('is a no-op for equal indices', () => {
    expect(reorderLayer([a, b, c], 1, 1)).toEqual([a, b, c]);
  });

  it('is a no-op for out-of-range indices', () => {
    expect(reorderLayer([a, b, c], -1, 1)).toEqual([a, b, c]);
    expect(reorderLayer([a, b, c], 0, 5)).toEqual([a, b, c]);
  });

  it('handles moving the last element to the front and vice versa', () => {
    expect(reorderLayer([a, b, c], 2, 0)).toEqual([c, a, b]);
    expect(reorderLayer([a, b, c], 0, 2)).toEqual([b, c, a]);
  });
});

describe('toggleLayerHidden', () => {
  it('flips hidden from unset -> true -> false', () => {
    const once = toggleLayerHidden([a], 'a');
    expect(once[0].hidden).toBe(true);
    const twice = toggleLayerHidden(once, 'a');
    expect(twice[0].hidden).toBe(false);
  });

  it('leaves other layers untouched', () => {
    const result = toggleLayerHidden([a, b], 'a');
    expect(result[1]).toBe(b);
  });
});

describe('renameLayer', () => {
  it('renames the matching layer only', () => {
    const result = renameLayer([a, b], 'a', 'Renamed');
    expect(result).toEqual([{ id: 'a', name: 'Renamed' }, b]);
  });
});
