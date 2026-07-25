// Op result → new layer tree. The specs are hand-built rather than produced by
// a real op on purpose: this file is about WHERE the result lands and WHAT it
// consumes, and a literal spec makes the destination assertions exact. One
// test at the bottom does run a real op, to pin PATHFINDER_OP_LABELS against
// the names the ops themselves emit.
import {
  createPcbLayerStack,
  findPcbNodeById,
  isGroupNode,
  pcbLayerDefinition,
  projectPcbLayerStack,
  type ColorIndex,
  type GroupNode,
  type Layer,
  type LayerNode,
  type PathLayer,
  type PcbLayerRole,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import { describe, expect, it } from 'vitest';
import type { KernelPathSpec } from '../geometry-kernel';
import { applyPathfinderOp } from './dispatch';
import { applyPathfinderResult, PATHFINDER_OP_LABELS, specToPathLayer } from './mutation';
import { rectPoints, rectShape } from './test-fixtures';
import type { PathfinderOpResult } from './types';

const COPPER = pcbLayerDefinition('copper').color;
const SILK = pcbLayerDefinition('silkscreen').color;

function shape(id: string, x = 0): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y: 0, width: 10, height: 10, color: 1 };
}

function group(id: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name: id, children };
}

function spec(
  name: string,
  fill: ColorIndex | null = 1,
  stroke: ColorIndex | null = null,
): KernelPathSpec {
  return { points: rectPoints(0, 0, 5, 5), closed: true, fill, stroke, strokeWidth: 0, name };
}

function result(
  specs: KernelPathSpec[],
  frontmostLeafId: string,
  role: PcbLayerRole = 'copper',
): PathfinderOpResult {
  return { specs, target: { role, frontmostLeafId } };
}

/** Ids of one container's children, top level only. */
function childIds(stack: PcbLayerStack, index: 0 | 1 | 2): string[] {
  return stack[index].children.map((node) => node.id);
}

function leafNames(stack: PcbLayerStack): string[] {
  return projectPcbLayerStack(stack).map((layer) => layer.name);
}

describe('specToPathLayer', () => {
  it('carries the spec across verbatim under a fresh id', () => {
    const source = spec('Unite', 2, 0);
    source.extraSubpaths = [rectPoints(1, 1, 2, 2)];
    const layer = specToPathLayer(source);

    expect(layer.type).toBe('path');
    expect(layer.id).not.toBe('');
    expect(layer.name).toBe('Unite');
    expect(layer.points).toBe(source.points);
    expect(layer.extraSubpaths).toBe(source.extraSubpaths);
    expect(layer.closed).toBe(true);
    expect(layer.fill).toBe(2);
    expect(layer.stroke).toBe(0);
  });

  it('omits extraSubpaths rather than writing an empty array', () => {
    expect('extraSubpaths' in specToPathLayer(spec('Unite'))).toBe(false);
    const empty = spec('Unite');
    empty.extraSubpaths = [];
    expect('extraSubpaths' in specToPathLayer(empty)).toBe(false);
  });

  it('mints a distinct id per call', () => {
    const source = spec('Divide 1');
    expect(specToPathLayer(source).id).not.toBe(specToPathLayer(source).id);
  });
});

describe('applyPathfinderResult — single-piece result', () => {
  it('takes over the frontmost input’s slot and consumes the rest', () => {
    const stack = createPcbLayerStack({
      copper: [shape('back'), shape('front'), shape('bystander')],
    });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);

    expect(applied).not.toBeNull();
    // Same index the frontmost input held: after 'back' is consumed the result
    // is the first child, still below the untouched bystander.
    expect(childIds(applied!.stack, 0)).toEqual([applied!.createdLeafIds[0], 'bystander']);
    expect(applied!.groupId).toBeNull();
    expect(applied!.selectionIds).toEqual(applied!.createdLeafIds);
    expect(leafNames(applied!.stack)).toEqual(['Unite', 'bystander']);
  });

  it('replaces in place inside the frontmost input’s own group', () => {
    const stack = createPcbLayerStack({
      copper: [group('g', [shape('back'), shape('front'), shape('keep')])],
    });
    const applied = applyPathfinderResult(
      stack,
      'intersect',
      result([spec('Intersect')], 'front'),
      ['back', 'front'],
    );

    const g = findPcbNodeById(applied!.stack, 'g')!.node as GroupNode;
    expect(g.children.map((node) => node.name)).toEqual(['Intersect', 'keep']);
    expect(applied!.prunedGroupIds).toEqual([]);
  });

  it('leaves the input stack untouched (pure)', () => {
    const stack = createPcbLayerStack({ copper: [shape('back'), shape('front')] });
    const before = JSON.stringify(stack);
    applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), ['back', 'front']);
    expect(JSON.stringify(stack)).toBe(before);
  });
});

describe('applyPathfinderResult — multi-piece result', () => {
  it('wraps the pieces in ONE group named after the op, in the frontmost slot', () => {
    const stack = createPcbLayerStack({
      copper: [shape('back'), shape('front'), shape('bystander')],
    });
    const applied = applyPathfinderResult(
      stack,
      'divide',
      result([spec('Divide 1'), spec('Divide 2'), spec('Divide 3')], 'front'),
      ['back', 'front'],
    );

    expect(applied!.groupId).not.toBeNull();
    expect(applied!.selectionIds).toEqual([applied!.groupId]);
    expect(childIds(applied!.stack, 0)).toEqual([applied!.groupId, 'bystander']);

    const wrapper = findPcbNodeById(applied!.stack, applied!.groupId!)!.node;
    expect(isGroupNode(wrapper)).toBe(true);
    expect((wrapper as GroupNode).name).toBe(PATHFINDER_OP_LABELS.divide);
    expect((wrapper as GroupNode).children.map((node) => node.id)).toEqual(applied!.createdLeafIds);
    expect(leafNames(applied!.stack)).toEqual(['Divide 1', 'Divide 2', 'Divide 3', 'bystander']);
  });

  it('falls back to flat siblings when the wrapper would exceed MAX_GROUP_DEPTH', () => {
    // Nine nested groups puts the anchor deeper than the cap allows a wrapper
    // to sit; the pieces must still land rather than the op silently vanishing.
    let node: LayerNode = shape('front');
    for (let i = 9; i > 0; i -= 1) node = group(`g${i}`, [node]);
    const stack = createPcbLayerStack({ copper: [node, shape('back')] });

    const applied = applyPathfinderResult(
      stack,
      'divide',
      result([spec('Divide 1'), spec('Divide 2')], 'front'),
      ['back', 'front'],
    );

    expect(applied!.groupId).toBeNull();
    const deepest = findPcbNodeById(applied!.stack, 'g9')!.node as GroupNode;
    expect(deepest.children.map((child) => child.id)).toEqual(applied!.createdLeafIds);
  });
});

describe('applyPathfinderResult — cross-material destination and colour collapse', () => {
  it('lands in the frontmost input’s container and deletes the input in the other one', () => {
    const stack = createPcbLayerStack({
      copper: [shape('back')],
      silkscreen: [shape('front')],
    });
    const applied = applyPathfinderResult(
      stack,
      'minusFront',
      result([spec('Minus Front', COPPER)], 'front', 'silkscreen'),
      ['back', 'front'],
    );

    expect(childIds(applied!.stack, 0)).toEqual([]);
    expect(childIds(applied!.stack, 2)).toEqual(applied!.createdLeafIds);
  });

  it('collapses several attributed colours onto the destination material', () => {
    // What the faces ops hand over on a cross-material selection: one spec per
    // input, each carrying its own source colour (#208 reports attribution
    // faithfully and leaves the collapse here).
    const stack = createPcbLayerStack({
      copper: [shape('back')],
      silkscreen: [shape('front')],
    });
    const applied = applyPathfinderResult(
      stack,
      'trim',
      result(
        [spec('Trim 1', COPPER), spec('Trim 2', 0), spec('Trim 3', SILK)],
        'front',
        'silkscreen',
      ),
      ['back', 'front'],
    );

    const leaves = projectPcbLayerStack(applied!.stack) as PathLayer[];
    expect(leaves).toHaveLength(3);
    expect(leaves.map((leaf) => leaf.fill)).toEqual([SILK, SILK, SILK]);
  });

  it('preserves the null/non-null paint channels through normalization', () => {
    // Outline's edges are open, unfilled and stroked — normalization must
    // recolour the stroke without giving the edge a fill.
    const stack = createPcbLayerStack({ copper: [shape('back'), shape('front')] });
    const edge = spec('front', null, SILK);
    edge.closed = false;
    const applied = applyPathfinderResult(stack, 'outline', result([edge], 'front'), [
      'back',
      'front',
    ]);

    const [leaf] = projectPcbLayerStack(applied!.stack) as PathLayer[];
    expect(leaf.fill).toBeNull();
    expect(leaf.stroke).toBe(COPPER);
    expect(leaf.closed).toBe(false);
  });
});

describe('applyPathfinderResult — empty-group cleanup', () => {
  it('removes a group the op emptied, and cascades to its parent', () => {
    const stack = createPcbLayerStack({
      copper: [group('outer', [group('inner', [shape('back')])]), shape('front')],
    });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);

    expect(applied!.prunedGroupIds.sort()).toEqual(['inner', 'outer']);
    expect(childIds(applied!.stack, 0)).toEqual(applied!.createdLeafIds);
  });

  it('keeps a group that still has children left', () => {
    const stack = createPcbLayerStack({
      copper: [group('g', [shape('back'), shape('survivor')]), shape('front')],
    });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);

    expect(applied!.prunedGroupIds).toEqual([]);
    const g = findPcbNodeById(applied!.stack, 'g')!.node as GroupNode;
    expect(g.children.map((node) => node.id)).toEqual(['survivor']);
  });

  it('never prunes the group the result landed in', () => {
    const stack = createPcbLayerStack({
      copper: [shape('back'), group('host', [shape('front')])],
    });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);

    expect(applied!.prunedGroupIds).toEqual([]);
    const host = findPcbNodeById(applied!.stack, 'host')!.node as GroupNode;
    expect(host.children.map((node) => node.name)).toEqual(['Unite']);
  });

  it('leaves a group that was ALREADY empty before the op alone', () => {
    // Documented boundary: cleanup is scoped to what this op emptied, so one
    // undo cannot restore a group the user emptied in some earlier edit.
    const stack = createPcbLayerStack({
      copper: [group('stale', []), shape('back'), shape('front')],
    });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);

    expect(applied!.prunedGroupIds).toEqual([]);
    expect(childIds(applied!.stack, 0)).toEqual(['stale', applied!.createdLeafIds[0]]);
  });
});

describe('applyPathfinderResult — nothing to commit', () => {
  const stack = createPcbLayerStack({ copper: [shape('back'), shape('front')] });

  it('returns null for an empty result', () => {
    expect(applyPathfinderResult(stack, 'unite', { specs: [], target: null }, ['back'])).toBeNull();
  });

  it('returns null when the frontmost input is no longer in the tree', () => {
    expect(
      applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'gone'), ['back', 'gone']),
    ).toBeNull();
  });
});

describe('PATHFINDER_OP_LABELS', () => {
  it('names every op', () => {
    expect(Object.values(PATHFINDER_OP_LABELS).every((label) => label.length > 0)).toBe(true);
  });

  it('matches the spec name a real op emits', async () => {
    // The ops keep private label tables for their spec names; this pins the
    // group-naming table above against one of them so the two cannot drift.
    const inputs = [rectShape('a', 0, 0, 10, 10, 1), rectShape('b', 5, 0, 10, 10, 1)];
    const united = await applyPathfinderOp('unite', inputs);
    expect(united.specs.map((s) => s.name)).toEqual([PATHFINDER_OP_LABELS.unite]);
  });
});

describe('applyPathfinderResult — leaf typing', () => {
  it('always produces path leaves, even from shape inputs', () => {
    const stack = createPcbLayerStack({ copper: [shape('back'), shape('front')] });
    const applied = applyPathfinderResult(stack, 'unite', result([spec('Unite')], 'front'), [
      'back',
      'front',
    ]);
    const types = projectPcbLayerStack(applied!.stack).map((layer: Layer) => layer.type);
    expect(types).toEqual(['path']);
  });
});
