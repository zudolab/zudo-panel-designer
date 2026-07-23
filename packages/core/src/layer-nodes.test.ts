import { describe, expect, it } from 'vitest';
import {
  flattenLayerNodes,
  isGroupNode,
  MAX_GROUP_DEPTH,
  projectPcbLayerStack,
  walkLayerNodes,
  walkPcbLayerNodes,
} from './layer-nodes';
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

describe('isGroupNode', () => {
  it('discriminates group nodes from leaves', () => {
    expect(isGroupNode(group('g1', []))).toBe(true);
    expect(isGroupNode(shape('s1'))).toBe(false);
  });
});

describe('walkLayerNodes', () => {
  it('visits every node DFS left-to-right with depth', () => {
    const tree: LayerNode[] = [
      shape('s1'),
      group('g1', [shape('s2'), group('g2', [shape('s3')])]),
      shape('s4'),
    ];
    const visited: Array<{ id: string; depth: number }> = [];
    walkLayerNodes(tree, (node, depth) => visited.push({ id: node.id, depth }));
    expect(visited).toEqual([
      { id: 's1', depth: 0 },
      { id: 'g1', depth: 0 },
      { id: 's2', depth: 1 },
      { id: 'g2', depth: 1 },
      { id: 's3', depth: 2 },
      { id: 's4', depth: 0 },
    ]);
  });
});

describe('flattenLayerNodes', () => {
  it('identity fast path: group-free input returns the SAME array and SAME leaf references', () => {
    const s1 = shape('s1');
    const s2 = shape('s2');
    const tree: LayerNode[] = [s1, s2];
    const flat = flattenLayerNodes(tree);
    expect(flat).toBe(tree);
    expect(flat[0]).toBe(s1);
    expect(flat[1]).toBe(s2);
  });

  it('erases a single group, keeping DFS order (tree order == z-order)', () => {
    const s1 = shape('s1');
    const s2 = shape('s2');
    const s3 = shape('s3');
    const tree: LayerNode[] = [s1, group('g1', [s2]), s3];
    expect(flattenLayerNodes(tree).map((l) => l.id)).toEqual(['s1', 's2', 's3']);
  });

  it('flattens 2, 3, and 4 levels of nesting in DFS order', () => {
    const depth2: LayerNode[] = [group('g1', [shape('a'), shape('b')])];
    expect(flattenLayerNodes(depth2).map((l) => l.id)).toEqual(['a', 'b']);

    const depth3: LayerNode[] = [group('g1', [shape('a'), group('g2', [shape('b'), shape('c')])])];
    expect(flattenLayerNodes(depth3).map((l) => l.id)).toEqual(['a', 'b', 'c']);

    const depth4: LayerNode[] = [
      group('g1', [group('g2', [group('g3', [shape('a'), shape('b')]), shape('c')])]),
    ];
    expect(flattenLayerNodes(depth4).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('an empty group contributes zero output', () => {
    const tree: LayerNode[] = [shape('s1'), group('g1', []), shape('s2')];
    expect(flattenLayerNodes(tree).map((l) => l.id)).toEqual(['s1', 's2']);
  });

  it('a group containing only groups flattens to its leaves', () => {
    const tree: LayerNode[] = [group('g1', [group('g2', []), group('g3', [shape('a')])])];
    expect(flattenLayerNodes(tree).map((l) => l.id)).toEqual(['a']);
  });

  it('folds hidden down as OR from every ancestor group', () => {
    const visible = shape('visible');
    const alreadyHidden = shape('already-hidden', { hidden: true });
    const tree: LayerNode[] = [group('g1', [visible, alreadyHidden], { hidden: true })];
    const flat = flattenLayerNodes(tree);
    expect(flat.find((l) => l.id === 'visible')?.hidden).toBe(true);
    expect(flat.find((l) => l.id === 'already-hidden')?.hidden).toBe(true);
  });

  it('never writes hidden: false onto a leaf (no-clobber) when nothing folds in', () => {
    const noHiddenField = shape('no-field'); // hidden left undefined
    const explicitlyVisible = shape('explicit-false', { hidden: false });
    const tree: LayerNode[] = [group('g1', [noHiddenField, explicitlyVisible])]; // group itself not hidden
    const flat = flattenLayerNodes(tree);
    expect(flat.find((l) => l.id === 'no-field')).not.toHaveProperty('hidden');
    expect(flat.find((l) => l.id === 'explicit-false')?.hidden).toBe(false);
  });

  it('does not clone a leaf that is already hidden (reference preserved)', () => {
    const alreadyHidden = shape('h', { hidden: true });
    const tree: LayerNode[] = [group('g1', [alreadyHidden], { hidden: true })];
    expect(flattenLayerNodes(tree)[0]).toBe(alreadyHidden);
  });

  it('does not mutate the input tree or its leaves', () => {
    const leaf = shape('leaf');
    const g = group('g1', [leaf], { hidden: true });
    const tree: LayerNode[] = [g];
    const snapshotBefore = JSON.stringify(tree);
    flattenLayerNodes(tree);
    expect(JSON.stringify(tree)).toBe(snapshotBefore);
    expect(leaf.hidden).toBeUndefined();
  });

  it('is deterministic (same input, same output shape)', () => {
    const tree: LayerNode[] = [group('g1', [shape('a', { hidden: true })], { hidden: false })];
    expect(flattenLayerNodes(tree)).toEqual(flattenLayerNodes(tree));
  });

  it('MAX_GROUP_DEPTH is 8 (root nodes = depth 0)', () => {
    expect(MAX_GROUP_DEPTH).toBe(8);
  });
});

describe('fixed PCB stack projection', () => {
  it('walks ordinary nodes in physical stack order without counting the fixed wrapper as depth', () => {
    const stack = createPcbLayerStack({
      copper: [group('g', [shape('c')])],
      'solder-mask': [shape('m')],
      silkscreen: [shape('s')],
    });
    const visited: Array<[string, string, number]> = [];
    walkPcbLayerNodes(stack, (node, role, _container, depth) => {
      visited.push([node.id, role, depth]);
    });
    expect(visited).toEqual([
      ['g', 'copper', 0],
      ['c', 'copper', 1],
      ['m', 'solder-mask', 0],
      ['s', 'silkscreen', 0],
    ]);
  });

  it('forces effective paint from membership, folds fixed hidden, and memoizes by stack identity', () => {
    const stack = createPcbLayerStack({
      copper: [shape('c', { color: 0 })],
      'solder-mask': [
        {
          id: 'p',
          name: 'p',
          type: 'path',
          points: [],
          closed: false,
          fill: null,
          stroke: 2,
          strokeWidth: 1,
        },
      ],
      silkscreen: [shape('s', { color: 1 })],
    });
    stack[1] = { ...stack[1], hidden: true };

    const first = projectPcbLayerStack(stack);
    expect(projectPcbLayerStack(stack)).toBe(first);
    expect(first[0]).toMatchObject({ id: 'c', color: 1 });
    expect(first[1]).toMatchObject({ id: 'p', fill: null, stroke: 0, hidden: true });
    expect(first[2]).toMatchObject({ id: 's', color: 2 });
  });
});
