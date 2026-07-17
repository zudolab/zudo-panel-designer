import { describe, expect, it } from 'vitest';
import {
  addLayer,
  cloneLayer,
  duplicateLayer,
  duplicateLayersAbove,
  removeLayer,
  renameLayer,
  reorderLayer,
  toggleLayerHidden,
  type LayerListItem,
} from './layer-ops';
import type { Layer, PathLayer, PatternLayer, ShapeLayer } from './types';

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

// --- clone helpers (#49) ----------------------------------------------------

const shapeLayer = (id: string, x = 10): ShapeLayer => ({
  id,
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x,
  y: 5,
  width: 20,
  height: 10,
  color: 1,
});

const pathLayer = (id: string): PathLayer => ({
  id,
  name: 'Path',
  type: 'path',
  points: [
    { x: 0, y: 0, hout: { x: 5, y: 0 } },
    { x: 10, y: 10, hin: { x: 8, y: 10 }, hout: { x: 12, y: 10 } },
  ],
  extraSubpaths: [[{ x: 30, y: 30, hin: { x: 28, y: 30 } }]],
  closed: true,
  fill: 1,
  stroke: null,
  strokeWidth: 0.5,
});

describe('cloneLayer', () => {
  it('returns an equal layer under the new id, source untouched', () => {
    const source = shapeLayer('s1');
    const clone = cloneLayer(source, 'c1');
    expect(clone).toEqual({ ...source, id: 'c1' });
    expect(clone.name).toBe('Rect'); // drag-duplicate keeps the name — no " copy"
    expect(source.id).toBe('s1');
  });

  it('deep-copies path points, bezier handles, and extraSubpaths', () => {
    const source = pathLayer('p1');
    const clone = cloneLayer(source, 'c1') as PathLayer;
    expect(clone).toEqual({ ...source, id: 'c1' });
    // every nested structure must be a NEW object, not a shared reference
    expect(clone.points).not.toBe(source.points);
    expect(clone.points[0]).not.toBe(source.points[0]);
    expect(clone.points[0].hout).not.toBe(source.points[0].hout);
    expect(clone.points[1].hin).not.toBe(source.points[1].hin);
    expect(clone.extraSubpaths).not.toBe(source.extraSubpaths);
    expect(clone.extraSubpaths![0]).not.toBe(source.extraSubpaths![0]);
    expect(clone.extraSubpaths![0][0].hin).not.toBe(source.extraSubpaths![0][0].hin);
    // mutating the clone must not bleed into the source
    clone.points[0].x = 99;
    clone.points[1].hin!.x = 99;
    clone.extraSubpaths![0][0].x = 99;
    expect(source.points[0].x).toBe(0);
    expect(source.points[1].hin!.x).toBe(8);
    expect(source.extraSubpaths![0][0].x).toBe(30);
  });

  it('does not add an extraSubpaths key when the source has none', () => {
    const source: PathLayer = { ...pathLayer('p1') };
    delete source.extraSubpaths;
    const clone = cloneLayer(source, 'c1') as PathLayer;
    expect('extraSubpaths' in clone).toBe(false);
  });

  it('deep-copies a pattern layer params record', () => {
    const source: PatternLayer = {
      id: 'g1',
      name: 'Grid',
      type: 'pattern',
      patternType: 'dot-grid',
      params: { pitch: 2.54 },
      color: 1,
    };
    const clone = cloneLayer(source, 'c1') as PatternLayer;
    expect(clone).toEqual({ ...source, id: 'c1' });
    expect(clone.params).not.toBe(source.params);
  });
});

describe('duplicateLayersAbove', () => {
  it('inserts each clone directly above its source, others untouched', () => {
    const s1 = shapeLayer('s1');
    const mid = shapeLayer('mid', 50);
    const s2 = pathLayer('s2');
    const { layers, idMap } = duplicateLayersAbove([s1, mid, s2], ['s1', 's2'], (l) => `c-${l.id}`);
    expect(layers.map((l) => l.id)).toEqual(['s1', 'c-s1', 'mid', 's2', 'c-s2']);
    expect(idMap).toEqual(
      new Map([
        ['s1', 'c-s1'],
        ['s2', 'c-s2'],
      ]),
    );
    expect(layers[0]).toBe(s1); // originals stay put, by reference
    expect(layers[2]).toBe(mid);
    expect(layers[1]).toEqual({ ...s1, id: 'c-s1' });
  });

  it('mints a fresh id per source via the callback', () => {
    const seen: Layer[] = [];
    let n = 0;
    const { layers } = duplicateLayersAbove([shapeLayer('s1'), shapeLayer('s2', 40)], ['s1', 's2'], (l) => {
      seen.push(l);
      n += 1;
      return `fresh-${n}`;
    });
    expect(seen.map((l) => l.id)).toEqual(['s1', 's2']);
    expect(layers.map((l) => l.id)).toEqual(['s1', 'fresh-1', 's2', 'fresh-2']);
  });

  it('ignores ids not present in the list and does not mutate the input', () => {
    const input = [shapeLayer('s1')];
    const { layers, idMap } = duplicateLayersAbove(input, ['nope'], () => 'c1');
    expect(layers).toEqual(input);
    expect(idMap.size).toBe(0);
    expect(input).toHaveLength(1);
  });
});
