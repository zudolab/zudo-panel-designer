// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ShapeLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import { LayerList } from './layer-list';

afterEach(cleanup);

const LAYER: ShapeLayer = {
  id: 's1',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: 1,
};

function stubCtx() {
  const commit = vi.fn();
  const select = vi.fn();
  const selectIds = vi.fn();
  const ctx = {
    doc: { panelHp: 12, layers: [LAYER] },
    selectedIds: [],
    commit,
    select,
    selectIds,
  } as unknown as ToolContext;
  return { ctx, commit, select, selectIds };
}

describe('LayerList rename', () => {
  it('double-click enters inline rename; Enter commits the new name via renameLayer', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'Header Cutout' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(commit).toHaveBeenCalledTimes(1);
    const [patchedDoc] = commit.mock.calls[0];
    expect(patchedDoc.layers[0]).toMatchObject({ id: 's1', name: 'Header Cutout' });
    // edit mode closed
    expect(screen.queryByDisplayValue('Header Cutout')).toBeNull();
  });

  it('Escape cancels without committing', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Rect')).toBeTruthy();
  });

  it('blur without Enter cancels without committing', () => {
    const { ctx, commit } = stubCtx();
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    const input = screen.getByDisplayValue('Rect');
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.blur(input);

    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Rect')).toBeTruthy();
  });

  it('double-clicking the name does not also toggle selection', () => {
    const { ctx, select } = stubCtx();
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    expect(select).not.toHaveBeenCalled();
  });
});

function shape(id: string, name: string): ShapeLayer {
  return { ...LAYER, id, name };
}

// Document order [a, b, c]; the list renders top-of-stack first, so the visible
// rows are [C, B, A].
function multiCtx(selectedIds: readonly string[]) {
  const selectIds = vi.fn();
  const ctx = {
    doc: { panelHp: 12, layers: [shape('a', 'A'), shape('b', 'B'), shape('c', 'C')] },
    selectedIds,
    commit: vi.fn(),
    select: vi.fn(),
    selectIds,
  } as unknown as ToolContext;
  return { ctx, selectIds };
}

describe('LayerList multi-select', () => {
  it('plain click selects exactly one', () => {
    const { ctx, selectIds } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByText('B'));
    expect(selectIds).toHaveBeenLastCalledWith(['b']);
  });

  it('meta-click adds an unselected layer to the selection', () => {
    const { ctx, selectIds } = multiCtx(['a']);
    render(<LayerList ctx={ctx} selectedIds={['a']} />);

    fireEvent.click(screen.getByText('C'), { metaKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'c']);
  });

  it('ctrl-click toggles a selected layer back off', () => {
    const { ctx, selectIds } = multiCtx(['a', 'c']);
    render(<LayerList ctx={ctx} selectedIds={['a', 'c']} />);

    fireEvent.click(screen.getByText('A'), { ctrlKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['c']);
  });

  it('shift-click selects the range from the last singly-clicked anchor', () => {
    const { ctx, selectIds } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // establish the anchor with a plain click on A, then shift-click C
    fireEvent.click(screen.getByText('A'));
    expect(selectIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.click(screen.getByText('C'), { shiftKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });
});
