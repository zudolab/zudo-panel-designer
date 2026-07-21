// @vitest-environment jsdom
//
// #150 write-path audit: the inspector's onChange must route through the
// recursive updateLeafById, so an edit to a leaf nested inside groups lands
// on that leaf IN PLACE (structure preserved) instead of silently no-oping
// against the root array. Registers a capture-only mock inspector — vitest
// isolates modules per test file, so this never collides with the real
// registry glob (which only runs when ../registry is imported).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { DocState, GroupNode, LayerNode, ShapeLayer } from '@zpd/core';
import { registerInspector, unregisterInspector } from '../registry/inspectors';
import type { InspectorProps, ToolContext } from '../types';
import { InspectorHost } from './inspector-host';

// A vi.fn AS the component: renders a marker and lets each test read the
// props of the latest render from mock.calls (no mutable module state, which
// the react-hooks/immutability lint forbids inside a render).
const MockShapeInspector = vi.fn<(props: InspectorProps<ShapeLayer>) => ReactElement>(() => (
  <div data-testid="mock-shape-inspector" />
));

function lastInspectorProps(): InspectorProps<ShapeLayer> {
  const call = MockShapeInspector.mock.calls.at(-1);
  if (!call) throw new Error('MockShapeInspector never rendered');
  return call[0];
}

afterEach(() => {
  MockShapeInspector.mockClear();
  unregisterInspector('shape');
  cleanup();
});

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

function group(id: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name: id, children };
}

function stubCtx(doc: DocState) {
  const commit = vi.fn();
  const replace = vi.fn();
  const ctx = { doc, commit, replace } as unknown as ToolContext;
  return { ctx, commit, replace };
}

describe('InspectorHost onChange (#150)', () => {
  it('edits a depth-2 nested leaf in place, preserving group structure and sibling identity', () => {
    registerInspector('shape', MockShapeInspector);
    const leaf = shape('deep');
    const rootSibling = shape('root-sibling');
    const innerSibling = shape('inner-sibling');
    const doc: DocState = {
      panelHp: 12,
      guides: [],
      layers: [group('outer', [group('inner', [leaf, innerSibling])]), rootSibling],
    };
    const { ctx, commit } = stubCtx(doc);
    render(<InspectorHost ctx={ctx} layer={leaf} selectedIds={['deep']} />);
    expect(screen.getByTestId('mock-shape-inspector')).toBeTruthy();

    lastInspectorProps().onChange({ x: 42 });

    expect(commit).toHaveBeenCalledTimes(1);
    const next = commit.mock.calls[0][0] as DocState;
    const outer = next.layers[0] as GroupNode;
    expect(outer.kind).toBe('group');
    const inner = outer.children[0] as GroupNode;
    expect(inner.kind).toBe('group');
    expect((inner.children[0] as ShapeLayer).x).toBe(42);
    // untouched nodes keep their identity — no unrelated churn
    expect(inner.children[1]).toBe(innerSibling);
    expect(next.layers[1]).toBe(rootSibling);
  });

  it('routes commit:false through replace (drag/scrub), same recursive path', () => {
    registerInspector('shape', MockShapeInspector);
    const leaf = shape('deep');
    const doc: DocState = { panelHp: 12, guides: [], layers: [group('g', [leaf])] };
    const { ctx, commit, replace } = stubCtx(doc);
    render(<InspectorHost ctx={ctx} layer={leaf} selectedIds={['deep']} />);

    lastInspectorProps().onChange({ width: 33 }, { commit: false });

    expect(commit).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    const next = replace.mock.calls[0][0] as DocState;
    expect(((next.layers[0] as GroupNode).children[0] as ShapeLayer).width).toBe(33);
  });
});
