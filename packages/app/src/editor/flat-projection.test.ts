import { describe, expect, it } from 'vitest';
import {
  createPcbLayerStack,
  serializePanelConfig,
  type DocState,
  type GroupNode,
  type ImageLayer,
  type LayerNode,
  type PathLayer,
  type ShapeLayer,
} from '@zpd/core';
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
  it('projects the fixed physical stack with container-authoritative material and stable identity', () => {
    const path: PathLayer = {
      id: 'mask-path',
      name: 'Mask path',
      type: 'path',
      points: [],
      closed: true,
      fill: 2,
      stroke: null,
      strokeWidth: 1,
    };
    const image: ImageLayer = {
      id: 'reference',
      name: 'Reference',
      type: 'image',
      src: 'data:image/png;base64,fixture',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const stack = createPcbLayerStack({
      copper: [shape('copper', { color: 0 }), image],
      'solder-mask': [path],
      silkscreen: [shape('silk', { color: 1 })],
    });

    const first = projectFlatLayers(stack);
    expect(projectFlatLayers(stack)).toBe(first);
    expect(first.map((layer) => layer.id)).toEqual(['copper', 'reference', 'mask-path', 'silk']);
    expect(first[0]).toMatchObject({ color: 1 });
    expect(first[1]).toBe(image);
    expect(first[2]).toMatchObject({ fill: 0, stroke: null });
    expect(first[3]).toMatchObject({ color: 2 });
  });

  it('folds fixed-container and group hidden state without mutating stored children', () => {
    const copper = shape('copper', { color: 0 });
    const mask = shape('mask', { color: 2 });
    const stack = createPcbLayerStack({
      copper: [copper],
      'solder-mask': [group('mask-group', [mask], true)],
    });
    stack[0] = { ...stack[0], hidden: true };

    expect(
      projectFlatLayers(stack).map((layer) => [
        layer.id,
        layer.hidden,
        layer.type === 'shape' ? layer.color : null,
      ]),
    ).toEqual([
      ['copper', true, 1],
      ['mask', true, 0],
    ]);
    expect(copper).toMatchObject({ color: 0 });
    expect(copper.hidden).toBeUndefined();
    expect(mask).toMatchObject({ color: 2 });
    expect(mask.hidden).toBeUndefined();
  });

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
      layers: createPcbLayerStack({ copper: [shape('a'), group('g', [shape('b')])] }),
    };
    const before = JSON.stringify(serializePanelConfig(doc));
    projectFlatLayers(doc.layers);
    projectFlatLayers(doc.layers);
    expect(JSON.stringify(serializePanelConfig(doc))).toBe(before);
  });
});
