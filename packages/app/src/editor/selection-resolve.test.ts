// The group-aware selection resolver (#151): expansion, promotion, the
// modifier toggles that maintain the no-[group, descendant]-overlap
// invariant, the overlay-mode matrix, and leaf resolution (visible/editable/
// rotatable + combined bounds) against the flat projection.
import { describe, expect, it } from 'vitest';
import type { GroupNode, LayerNode, PathLayer, PatternLayer, ShapeLayer } from '@zpd/core';
import { projectFlatLayers } from './flat-projection';
import {
  expandSelectionToLeafIds,
  promoteMarqueeSelection,
  resolveSelectionLeaves,
  resolveSelectionOverlayMode,
  selectionOwnerId,
  toggleLeafSelection,
  togglePromotedSelection,
  topmostAncestorIdForLeaf,
} from './selection-resolve';

const rect = (id: string, x: number, y: number, hidden = false): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: 10,
  height: 10,
  color: 1,
  ...(hidden ? { hidden: true } : {}),
});

const path = (id: string): PathLayer => ({
  id,
  name: id,
  type: 'path',
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
  closed: false,
  fill: null,
  stroke: 1,
  strokeWidth: 1,
});

const pattern = (id: string): PatternLayer => ({
  id,
  name: id,
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x: 0,
  y: 0,
  size: 100,
});

const group = (id: string, children: LayerNode[], hidden = false): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
  ...(hidden ? { hidden: true } : {}),
});

// a, G1[b, G2[c]], d — the standard nesting fixture.
const tree = (): LayerNode[] => [
  rect('a', 0, 0),
  group('G1', [rect('b', 10, 10), group('G2', [rect('c', 20, 20)])]),
  rect('d', 40, 40),
];

describe('expandSelectionToLeafIds', () => {
  it('a leaf id passes through; a group id expands to every descendant leaf', () => {
    expect(expandSelectionToLeafIds(tree(), ['a'])).toEqual(['a']);
    expect(expandSelectionToLeafIds(tree(), ['G1'])).toEqual(['b', 'c']);
    expect(expandSelectionToLeafIds(tree(), ['G2'])).toEqual(['c']);
  });

  it('dedupes an overlapping [group, descendant] selection and orders by tree DFS', () => {
    expect(expandSelectionToLeafIds(tree(), ['c', 'G1'])).toEqual(['b', 'c']);
    expect(expandSelectionToLeafIds(tree(), ['d', 'G1', 'a'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops ids not present in the tree and returns [] for an empty selection', () => {
    expect(expandSelectionToLeafIds(tree(), ['ghost', 'a'])).toEqual(['a']);
    expect(expandSelectionToLeafIds(tree(), [])).toEqual([]);
  });
});

describe('topmostAncestorIdForLeaf / selectionOwnerId', () => {
  it('promotes a nested leaf to its TOPMOST ancestor, not the nearest', () => {
    expect(topmostAncestorIdForLeaf(tree(), 'c')).toBe('G1');
    expect(topmostAncestorIdForLeaf(tree(), 'b')).toBe('G1');
  });

  it('an ungrouped leaf (and an unknown id, defensively) promotes to itself', () => {
    expect(topmostAncestorIdForLeaf(tree(), 'a')).toBe('a');
    expect(topmostAncestorIdForLeaf(tree(), 'ghost')).toBe('ghost');
  });

  it('owner is the leaf itself when directly selected, else its selected ancestor, else null', () => {
    expect(selectionOwnerId(tree(), ['c', 'a'], 'c')).toBe('c');
    expect(selectionOwnerId(tree(), ['G1', 'a'], 'c')).toBe('G1');
    expect(selectionOwnerId(tree(), ['G2'], 'c')).toBe('G2');
    expect(selectionOwnerId(tree(), ['a', 'd'], 'c')).toBeNull();
  });
});

describe('toggleLeafSelection (Meta/Ctrl semantics)', () => {
  it('removes an already-selected leaf, leaving the rest', () => {
    expect(toggleLeafSelection(tree(), ['a', 'c'], 'c')).toEqual(['a']);
  });

  it('adding a leaf STRIPS its selected ancestor — the Meta escape hatch invariant', () => {
    expect(toggleLeafSelection(tree(), ['G1', 'a'], 'c')).toEqual(['a', 'c']);
    expect(toggleLeafSelection(tree(), ['G2'], 'c')).toEqual(['c']);
  });

  it('adding an ungrouped leaf simply appends', () => {
    expect(toggleLeafSelection(tree(), ['a'], 'd')).toEqual(['a', 'd']);
  });
});

describe('togglePromotedSelection (Shift semantics)', () => {
  it('toggles the PROMOTED id: adds the topmost group for a nested leaf, removes it when present', () => {
    expect(togglePromotedSelection(tree(), ['a'], 'c')).toEqual(['a', 'G1']);
    expect(togglePromotedSelection(tree(), ['a', 'G1'], 'b')).toEqual(['a']);
  });

  it('adding a group STRIPS selected descendants (a previously Meta-picked leaf)', () => {
    expect(togglePromotedSelection(tree(), ['c', 'a'], 'b')).toEqual(['a', 'G1']);
  });
});

describe('promoteMarqueeSelection', () => {
  it('promotes each swept leaf to its topmost ancestor, deduped', () => {
    expect(promoteMarqueeSelection(tree(), ['b', 'c', 'd'], [])).toEqual(['G1', 'd']);
  });

  it('an additive union collapses a base leaf swallowed by a swept group (maximal roots)', () => {
    expect(promoteMarqueeSelection(tree(), ['b'], ['c', 'a'])).toEqual(['a', 'G1']);
  });
});

describe('resolveSelectionOverlayMode — the #151 matrix', () => {
  it('empty (and stale-only) selections are none', () => {
    expect(resolveSelectionOverlayMode(tree(), [])).toBe('none');
    expect(resolveSelectionOverlayMode(tree(), ['ghost'])).toBe('none');
  });

  it('a lone leaf is single', () => {
    expect(resolveSelectionOverlayMode(tree(), ['a'])).toBe('single');
  });

  it('a lone group is combined — INCLUDING a one-child group', () => {
    expect(resolveSelectionOverlayMode(tree(), ['G1'])).toBe('combined');
    expect(resolveSelectionOverlayMode(tree(), ['G2'])).toBe('combined'); // one child
  });

  it('a group+leaf mix and a multi-leaf selection are combined', () => {
    expect(resolveSelectionOverlayMode(tree(), ['G1', 'a'])).toBe('combined');
    expect(resolveSelectionOverlayMode(tree(), ['a', 'd'])).toBe('combined');
  });
});

describe('resolveSelectionLeaves', () => {
  it('excludes an intrinsically hidden leaf from visible/editable', () => {
    const t: LayerNode[] = [group('G', [rect('v', 0, 0), rect('h', 10, 10, true)])];
    const res = resolveSelectionLeaves(t, ['G'], projectFlatLayers(t));
    expect(res.visibleLeafIds).toEqual(['v']);
    expect(res.editableLeafIds).toEqual(['v']);
  });

  it('excludes ancestor-folded hidden leaves (hidden GROUP) — nothing visible, no bounds', () => {
    const t: LayerNode[] = [group('H', [rect('e', 0, 0)], true), rect('a', 20, 20)];
    const res = resolveSelectionLeaves(t, ['H'], projectFlatLayers(t));
    expect(res.visibleLeafIds).toEqual([]);
    expect(res.editableLeafIds).toEqual([]);
    expect(res.combinedBounds).toBeNull();
  });

  it('rotatableLeafIds follows core rotatableLayer: paths bake and stay in, patterns drop out', () => {
    const t: LayerNode[] = [group('G', [rect('s', 0, 0), path('p'), pattern('pat')])];
    const res = resolveSelectionLeaves(t, ['G'], projectFlatLayers(t));
    expect(res.editableLeafIds).toEqual(['s', 'p', 'pat']);
    expect(res.rotatableLeafIds).toEqual(['s', 'p']);
  });

  it('combinedBounds is the AABB union of the editable leaves', () => {
    const t: LayerNode[] = [group('G', [rect('s1', 0, 0), rect('s2', 30, 20)]), rect('x', 90, 90)];
    const res = resolveSelectionLeaves(t, ['G'], projectFlatLayers(t));
    expect(res.combinedBounds).toEqual({ x: 0, y: 0, width: 40, height: 30 });
  });

  it('a mixed leaf+group selection resolves in tree DFS order, deduped', () => {
    const t = tree();
    const res = resolveSelectionLeaves(t, ['d', 'G1', 'c'], projectFlatLayers(t));
    expect(res.editableLeafIds).toEqual(['b', 'c', 'd']);
  });
});
