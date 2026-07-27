import { describe, expect, it } from 'vitest';
import {
  flattenLayerNodes,
  isGroupNode,
  MAX_GROUP_DEPTH,
  projectPcbLayerSlices,
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

describe('projectPcbLayerSlices', () => {
  it('splits the flat projection by role using the same references, and memoizes by stack identity', () => {
    const stack = createPcbLayerStack({
      copper: [shape('c1'), shape('c2')],
      'solder-mask': [shape('m')],
      silkscreen: [shape('s')],
    });

    const flat = projectPcbLayerStack(stack);
    const first = projectPcbLayerSlices(stack);
    expect(projectPcbLayerSlices(stack)).toBe(first);

    expect(first.flat).toBe(flat);
    expect(first.copper).toEqual([flat[0], flat[1]]);
    expect(first.copper[0]).toBe(flat[0]);
    expect(first.copper[1]).toBe(flat[1]);
    expect(first.solderMask[0]).toBe(flat[2]);
    expect(first.silkscreen[0]).toBe(flat[3]);
    expect([...first.copper, ...first.solderMask, ...first.silkscreen]).toEqual(flat);
  });

  it('folds container hidden into slice members and surfaces solderMaskHidden explicitly', () => {
    const stack = createPcbLayerStack({
      copper: [shape('c')],
      'solder-mask': [shape('m')],
      silkscreen: [shape('s')],
    });
    stack[1] = { ...stack[1], hidden: true };

    const slices = projectPcbLayerSlices(stack);
    expect(slices.solderMaskHidden).toBe(true);
    expect(slices.solderMask[0].hidden).toBe(true);
    expect(slices.copper[0].hidden).toBeUndefined();
    expect(slices.silkscreen[0].hidden).toBeUndefined();
  });

  it('reports solderMaskHidden false when the mask container is visible, even if empty', () => {
    const stack = createPcbLayerStack({ copper: [shape('c')] });
    expect(projectPcbLayerSlices(stack).solderMaskHidden).toBe(false);
    expect(projectPcbLayerSlices(stack).solderMask).toEqual([]);
  });
});

// The projections are stack-parametric, not front-bound (#230): a BACK stack
// (pcb-layer-back-* container ids) projects with the same role-driven paint,
// hidden folding, and slicing — role comes from container.role, never from
// which DocState field the stack came out of.
describe('projection against an explicit back stack', () => {
  it('projects a back stack with role-forced paint and independent memoization', () => {
    const front = createPcbLayerStack({ copper: [shape('c-front', { color: 0 })] });
    const back = createPcbLayerStack('back', {
      copper: [shape('c-back', { color: 0 })],
      silkscreen: [shape('s-back', { color: 1 })],
    });
    expect(back.map((container) => container.id)).toEqual([
      'pcb-layer-back-copper',
      'pcb-layer-back-solder-mask',
      'pcb-layer-back-silkscreen',
    ]);

    const projected = projectPcbLayerStack(back);
    expect(projectPcbLayerStack(back)).toBe(projected);
    expect(projected[0]).toMatchObject({ id: 'c-back', color: 1 });
    expect(projected[1]).toMatchObject({ id: 's-back', color: 2 });

    // Front and back memoize per stack array — one never shadows the other.
    expect(projectPcbLayerStack(front)).not.toBe(projected);
    expect(projectPcbLayerStack(front)[0]).toMatchObject({ id: 'c-front', color: 1 });
  });

  it('slices a back stack by role with container hidden folded in', () => {
    const back = createPcbLayerStack('back', {
      copper: [shape('c')],
      'solder-mask': [shape('m')],
    });
    back[1] = { ...back[1], hidden: true };

    const slices = projectPcbLayerSlices(back);
    expect(slices.flat).toBe(projectPcbLayerStack(back));
    expect(slices.copper[0]).toMatchObject({ id: 'c' });
    expect(slices.solderMask[0]).toMatchObject({ id: 'm', hidden: true });
    expect(slices.solderMaskHidden).toBe(true);
    expect(slices.silkscreen).toEqual([]);
  });
});
