import { describe, expect, it } from 'vitest';
import { serializePanelConfig, type DocState, type GroupNode, type LayerNode, type ShapeLayer } from '@zpd/core';
import { projectFlatLayers } from './flat-projection';

function shape(id: string, overrides: Partial<ShapeLayer> = {}): ShapeLayer {
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
    ...overrides,
  };
}

function group(id: string, children: LayerNode[], hidden?: boolean): GroupNode {
  return { kind: 'group', id, name: id, children, ...(hidden ? { hidden } : {}) };
}

describe('projectFlatLayers', () => {
  it('is the identity for a group-free tree', () => {
    const tree: LayerNode[] = [shape('a'), shape('b')];
    expect(projectFlatLayers(tree)).toBe(tree);
  });

  it('returns the SAME array instance for repeated reads of the same tree', () => {
    const tree: LayerNode[] = [shape('a'), group('g', [shape('b'), shape('c')])];
    const first = projectFlatLayers(tree);
    expect(projectFlatLayers(tree)).toBe(first);
    expect(first.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('projects a new incarnation to a new array without evicting older ones', () => {
    const treeA: LayerNode[] = [group('g', [shape('a')])];
    const treeB: LayerNode[] = [group('g', [shape('a'), shape('b')])];
    const flatA = projectFlatLayers(treeA);
    const flatB = projectFlatLayers(treeB);
    expect(flatB).not.toBe(flatA);
    expect(projectFlatLayers(treeA)).toBe(flatA);
    expect(projectFlatLayers(treeB)).toBe(flatB);
  });

  it('folds ancestor hidden down onto leaves like flattenLayerNodes', () => {
    const tree: LayerNode[] = [group('g', [shape('a')], true), shape('b')];
    const flat = projectFlatLayers(tree);
    expect(flat.map((l) => [l.id, !!l.hidden])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  // #150 regression fixture: reading through the projection must not perturb
  // the document — a group-free doc serializes byte-identically after reads.
  it('does not mutate the doc: serialization is byte-identical after projecting', () => {
    const doc: DocState = {
      panelHp: 12,
      guides: [],
      layers: [shape('a'), group('g', [shape('b')])],
    };
    const before = JSON.stringify(serializePanelConfig(doc));
    projectFlatLayers(doc.layers);
    projectFlatLayers(doc.layers);
    expect(JSON.stringify(serializePanelConfig(doc))).toBe(before);
  });
});
