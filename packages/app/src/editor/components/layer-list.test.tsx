// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ShapeLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
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
  Object.defineProperty(ctx, 'flatLayers', {
    get: () => projectFlatLayers(ctx.doc.layers),
  });
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
    const { ctx, selectIds } = stubCtx();
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Rect'));
    expect(selectIds).not.toHaveBeenCalled();
  });
});

function shape(id: string, name: string): ShapeLayer {
  return { ...LAYER, id, name };
}

// Document order [a, b, c]; the list renders top-of-stack first, so the visible
// rows are [C, B, A].
function multiCtx(selectedIds: readonly string[]) {
  let doc = {
    panelHp: 12,
    layers: [shape('a', 'A'), shape('b', 'B'), shape('c', 'C')],
  };
  const commit = vi.fn();
  const selectIds = vi.fn();
  const ctx = {
    get doc() {
      return doc;
    },
    get flatLayers() {
      return projectFlatLayers(doc.layers);
    },
    selectedIds,
    commit,
    select: vi.fn(),
    selectIds,
  } as unknown as ToolContext;
  return {
    ctx,
    commit,
    selectIds,
    setDoc(next: typeof doc) {
      doc = next;
    },
  };
}

function selectionButton(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: `Select layer ${name}` });
}

describe('LayerList multi-select', () => {
  it('plain click selects exactly one', () => {
    const { ctx, selectIds } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(selectionButton('B'));
    expect(selectIds).toHaveBeenLastCalledWith(['b']);
  });

  it('meta-click adds an unselected layer to the selection', () => {
    const { ctx, selectIds } = multiCtx(['a']);
    render(<LayerList ctx={ctx} selectedIds={['a']} />);

    fireEvent.click(selectionButton('C'), { metaKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'c']);
  });

  it('ctrl-click toggles a selected layer back off', () => {
    const { ctx, selectIds } = multiCtx(['a', 'c']);
    render(<LayerList ctx={ctx} selectedIds={['a', 'c']} />);

    fireEvent.click(selectionButton('A'), { ctrlKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['c']);
  });

  it('shift-click selects the range from the last singly-clicked anchor', () => {
    const { ctx, selectIds } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // establish the anchor with a plain click on A, then shift-click C
    fireEvent.click(selectionButton('A'));
    expect(selectIds).toHaveBeenLastCalledWith(['a']);
    fireEvent.click(selectionButton('C'), { shiftKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });
});

describe('LayerList keyboard access', () => {
  it('keeps structural list items and exposes selection with one roving tab stop', () => {
    const { ctx } = multiCtx(['b']);
    render(<LayerList ctx={ctx} selectedIds={['b']} />);

    const a = selectionButton('A');
    const b = selectionButton('B');
    const c = selectionButton('C');
    const row = b.closest('li');
    expect(row).not.toBeNull();
    expect(row?.hasAttribute('role')).toBe(false);
    expect(row?.hasAttribute('tabindex')).toBe(false);
    expect(b.querySelector('button, input')).toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(b.tabIndex).toBe(0);
    expect(a.tabIndex).toBe(-1);
    expect(c.tabIndex).toBe(-1);
    expect(b.className).toContain('focus-visible:outline-2');
  });

  it('moves focus through rendered top-to-bottom order with ArrowDown and ArrowUp', () => {
    const { ctx } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const c = selectionButton('C');
    c.focus();
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(selectionButton('B'));
    expect(selectionButton('B').tabIndex).toBe(0);

    fireEvent.keyDown(selectionButton('B'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(selectionButton('A'));
    fireEvent.keyDown(selectionButton('A'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(selectionButton('B'));
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('keeps native %s activation away from editor-level shortcuts', (_label, key) => {
    const { ctx } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      fireEvent.keyDown(selectionButton('C'), { key });
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });

  it('keeps focus at the first and last rows when an arrow has no neighbor', () => {
    const { ctx } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const c = selectionButton('C');
    c.focus();
    fireEvent.keyDown(c, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(c);

    const a = selectionButton('A');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a);
  });

  it('does not select a row when rename or sibling action controls are used', () => {
    const { ctx, selectIds } = multiCtx([]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const row = selectionButton('B').closest('li');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(within(row!).getByText('B'));
    fireEvent.click(within(row!).getByTitle('Bring forward'));
    fireEvent.click(within(row!).getByTitle('Send backward'));
    fireEvent.click(within(row!).getByTitle('Show / hide'));
    fireEvent.click(within(row!).getByTitle('Delete'));
    expect(selectIds).not.toHaveBeenCalled();
  });

  it('preserves the focused layer id when rows reorder', () => {
    const { ctx, commit, setDoc } = multiCtx([]);
    const { rerender } = render(<LayerList ctx={ctx} selectedIds={[]} />);

    const b = selectionButton('B');
    b.focus();
    const row = b.closest('li');
    fireEvent.click(within(row!).getByTitle('Bring forward'));
    const [nextDoc] = commit.mock.calls[0];
    setDoc(nextDoc);
    rerender(<LayerList ctx={ctx} selectedIds={[]} />);

    expect(document.activeElement).toBe(selectionButton('B'));
    expect(selectionButton('B').tabIndex).toBe(0);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('B'),
      expect.stringContaining('C'),
      expect.stringContaining('A'),
    ]);
  });

  it.each([
    ['the same rendered index after a middle removal', 'B', 'A'],
    ['the nearest remaining row after removing the last row', 'A', 'B'],
  ])('focuses %s', (_label, removedName, expectedName) => {
    const { ctx, commit, setDoc } = multiCtx([]);
    const { rerender } = render(<LayerList ctx={ctx} selectedIds={[]} />);

    const removed = selectionButton(removedName);
    removed.focus();
    fireEvent.click(within(removed.closest('li')!).getByTitle('Delete'));
    const [nextDoc] = commit.mock.calls[0];
    setDoc(nextDoc);
    rerender(<LayerList ctx={ctx} selectedIds={[]} />);

    expect(document.activeElement).toBe(selectionButton(expectedName));
    expect(selectionButton(expectedName).tabIndex).toBe(0);
  });

  it('renders no selection tab stop after the final row is removed', () => {
    const { ctx, commit } = stubCtx();
    let currentCtx = ctx;
    const { rerender } = render(<LayerList ctx={currentCtx} selectedIds={[]} />);

    const onlyButton = selectionButton('Rect');
    onlyButton.focus();
    fireEvent.click(within(onlyButton.closest('li')!).getByTitle('Delete'));
    const [nextDoc] = commit.mock.calls[0];
    currentCtx = {
      ...ctx,
      doc: nextDoc,
      flatLayers: projectFlatLayers(nextDoc.layers),
    } as ToolContext;
    rerender(<LayerList ctx={currentCtx} selectedIds={[]} />);

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Select layer/ })).toBeNull();
  });
});
