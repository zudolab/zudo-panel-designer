// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GroupNode, LayerNode, ShapeLayer } from '@zpd/core';
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

  // #151: the Meta list-toggle is the same raw-leaf escape hatch as a canvas
  // Meta-click — adding a grouped row's leaf strips its selected ancestor
  // group id so a [group, descendant] overlap never enters selectedIds.
  it('meta-click on a grouped row strips its selected ancestor group', () => {
    const doc = {
      panelHp: 12,
      layers: [
        { kind: 'group' as const, id: 'G', name: 'G', children: [shape('a', 'A'), shape('b', 'B')] },
        shape('c', 'C'),
      ],
    };
    const selectIds = vi.fn();
    const ctx = {
      get doc() {
        return doc;
      },
      get flatLayers() {
        return projectFlatLayers(doc.layers);
      },
      commit: vi.fn(),
      select: vi.fn(),
      selectIds,
    } as unknown as ToolContext;
    render(<LayerList ctx={ctx} selectedIds={['G']} />);

    fireEvent.click(selectionButton('A'), { metaKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a']); // G dropped, raw leaf in
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

// ─── #153 tree rendering + row actions ─────────────────────────────────────

function group(id: string, name: string, children: LayerNode[], extra: Partial<GroupNode> = {}): GroupNode {
  return { kind: 'group', id, name, children, ...extra };
}

function nodeTreeCtx(layers: LayerNode[]) {
  let doc = { panelHp: 12, layers };
  const commit = vi.fn();
  const selectIds = vi.fn();
  const ctx = {
    get doc() {
      return doc;
    },
    get flatLayers() {
      return projectFlatLayers(doc.layers);
    },
    selectedIds: [] as readonly string[],
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

// Bottom -> top: A, then group G (containing B, C), then D. Reversed for
// panel display this interleaves as [D, G-header, C, B, A] — G's z-band
// renders exactly where G sits, not bundled separately above/below.
function fixtureTree(): LayerNode[] {
  return [shape('a', 'A'), group('G', 'Group', [shape('b', 'B'), shape('c', 'C')]), shape('d', 'D')];
}

describe('LayerList tree rendering (#153)', () => {
  it('renders nested rows with correct data-depth and true z-order interleaving', () => {
    const { ctx } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('D'),
      expect.stringContaining('Group'),
      expect.stringContaining('C'),
      expect.stringContaining('B'),
      expect.stringContaining('A'),
    ]);
    expect(rows.map((row) => row.getAttribute('data-depth'))).toEqual(['0', '0', '1', '1', '0']);
    // G's own header is top-level (no parent group) — its two children carry
    // G's id as their DIRECT parent.
    expect(rows[1].hasAttribute('data-group-id')).toBe(false);
    expect(rows[2].getAttribute('data-group-id')).toBe('G');
    expect(rows[3].getAttribute('data-group-id')).toBe('G');
  });

  it('collapsing a group hides its descendant rows; expanding restores them', () => {
    const { ctx } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Group' }));
    expect(screen.queryByText('B')).toBeNull();
    expect(screen.queryByText('C')).toBeNull();
    expect(screen.getByText('D')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Group' }));
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('C')).toBeTruthy();
  });

  it('collapse state survives an unrelated re-render', () => {
    const { ctx } = nodeTreeCtx(fixtureTree());
    const { rerender } = render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Group' }));
    expect(screen.queryByText('B')).toBeNull();

    // Unrelated re-render: same ctx/doc identity, only the selectedIds prop
    // changes — collapse is component-local state, so it must not reset.
    rerender(<LayerList ctx={ctx} selectedIds={['d']} />);
    expect(screen.queryByText('B')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand Group' })).toBeTruthy();
  });

  it('renders a hint row for an empty group', () => {
    const { ctx } = nodeTreeCtx([group('G', 'Empty', [])]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);
    expect(screen.getByText('Empty group')).toBeTruthy();
  });

  it('clicking a group row selects the group id, not its leaves', () => {
    const { ctx, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select group Group' }));
    expect(selectIds).toHaveBeenLastCalledWith(['G']);
  });

  it('shift-click ranges over the flat leaf sequence, never capturing a group id (tree range-selection is #154)', () => {
    const { ctx, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select layer A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer D' }), { shiftKey: true });
    // Leaf-only range [a..d] — b and c (G's children) are swept in, but G's
    // own id never enters the selection, so the [group, descendant]
    // invariant can't be violated by this baseline behavior.
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'b', 'c', 'd']);
  });

  it('shift-clicking a group row degrades to a plain single-select of the group', () => {
    const { ctx, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select layer A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select group Group' }), { shiftKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['G']);
  });

  describe('group rename', () => {
    it('Enter commits a trimmed, changed name', () => {
      const { ctx, commit } = nodeTreeCtx(fixtureTree());
      render(<LayerList ctx={ctx} selectedIds={[]} />);

      fireEvent.doubleClick(screen.getByText('Group'));
      const input = screen.getByDisplayValue('Group');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(commit).toHaveBeenCalledTimes(1);
      const [nextDoc] = commit.mock.calls[0];
      const renamedGroup = (nextDoc.layers as LayerNode[]).find((n) => n.id === 'G');
      expect(renamedGroup).toMatchObject({ name: 'Renamed' });
      expect(screen.queryByDisplayValue('Renamed')).toBeNull();
    });

    it('blur commits a trimmed, changed name', () => {
      const { ctx, commit } = nodeTreeCtx(fixtureTree());
      render(<LayerList ctx={ctx} selectedIds={[]} />);

      fireEvent.doubleClick(screen.getByText('Group'));
      const input = screen.getByDisplayValue('Group');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.blur(input);

      expect(commit).toHaveBeenCalledTimes(1);
      const [nextDoc] = commit.mock.calls[0];
      const renamedGroup = (nextDoc.layers as LayerNode[]).find((n) => n.id === 'G');
      expect(renamedGroup).toMatchObject({ name: 'Renamed' });
    });

    it('Escape cancels without committing, even when a blur follows', () => {
      const { ctx, commit } = nodeTreeCtx(fixtureTree());
      render(<LayerList ctx={ctx} selectedIds={[]} />);

      fireEvent.doubleClick(screen.getByText('Group'));
      const input = screen.getByDisplayValue('Group');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.blur(input);

      expect(commit).not.toHaveBeenCalled();
      expect(screen.getByText('Group')).toBeTruthy();
    });

    it('Enter followed by a racing blur does not double-commit', () => {
      const { ctx, commit } = nodeTreeCtx(fixtureTree());
      render(<LayerList ctx={ctx} selectedIds={[]} />);

      fireEvent.doubleClick(screen.getByText('Group'));
      const input = screen.getByDisplayValue('Group');
      fireEvent.change(input, { target: { value: 'Renamed' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);

      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('an unchanged name does not commit on blur', () => {
      const { ctx, commit } = nodeTreeCtx(fixtureTree());
      render(<LayerList ctx={ctx} selectedIds={[]} />);

      fireEvent.doubleClick(screen.getByText('Group'));
      fireEvent.blur(screen.getByDisplayValue('Group'));

      expect(commit).not.toHaveBeenCalled();
    });
  });

  it('group visibility toggle sets the group hidden and folds hidden to descendants at flatten', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Group' }));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    const groupNode = (nextDoc.layers as LayerNode[]).find((n) => n.id === 'G');
    expect(groupNode).toMatchObject({ hidden: true });
    const flat = projectFlatLayers(nextDoc.layers);
    expect(flat.find((l) => l.id === 'b')).toMatchObject({ hidden: true });
    expect(flat.find((l) => l.id === 'c')).toMatchObject({ hidden: true });
  });

  it('delete-group cascades in one history entry', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group (and all children)' }));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect((nextDoc.layers as LayerNode[]).map((n) => n.id)).toEqual(['a', 'd']);
  });

  it('drops a cascade-deleted descendant out of the selection', () => {
    const { ctx, commit, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={['b', 'd']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group (and all children)' }));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(selectIds).toHaveBeenLastCalledWith(['d']);
  });

  it('ungroup releases children in place, at the group\'s own slot', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Group' }));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect((nextDoc.layers as LayerNode[]).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ungrouping a selected group selects the children it released', () => {
    const { ctx, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={['G']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Group' }));

    expect(selectIds).toHaveBeenLastCalledWith(['b', 'c']);
  });

  it('local reorder (bring forward) moves a leaf within its group parent via moveNodeToParent', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const bRow = screen.getByRole('button', { name: 'Select layer B' }).closest('li')!;
    fireEvent.click(within(bRow).getByTitle('Bring forward'));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    const groupNode = (nextDoc.layers as LayerNode[]).find((n) => n.id === 'G') as GroupNode;
    expect(groupNode.children.map((n) => n.id)).toEqual(['c', 'b']);
  });

  it('local reorder does not reparent across group boundaries', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // 'C' is the topmost child of G; "bring forward" one more step must stay
    // inside G (same-parent clamp), never spill out to the top level.
    const cRow = screen.getByRole('button', { name: 'Select layer C' }).closest('li')!;
    fireEvent.click(within(cRow).getByTitle('Bring forward'));

    expect(commit).not.toHaveBeenCalled();
  });

  it('group rows have no bring-forward/send-backward buttons (issue spec)', () => {
    const { ctx } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // Scope to the group's own HEADER <div> (a direct child of its <li>),
    // not the whole <li> subtree — the group's <li> now also nests its
    // children's <ul> (codex review: valid list markup), and those child
    // leaf rows (B, C) legitimately DO have their own move buttons.
    const groupLi = screen.getByRole('button', { name: 'Select group Group' }).closest('li')!;
    const header = groupLi.querySelector(':scope > div')!;
    expect(within(header as HTMLElement).queryByTitle('Bring forward')).toBeNull();
    expect(within(header as HTMLElement).queryByTitle('Send backward')).toBeNull();
  });

  it('group rename commits a cleared (empty) name, same as leaf rename', () => {
    const { ctx, commit } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.doubleClick(screen.getByText('Group'));
    const input = screen.getByDisplayValue('Group');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    const renamedGroup = (nextDoc.layers as LayerNode[]).find((n) => n.id === 'G');
    expect(renamedGroup).toMatchObject({ name: '' });
  });

  it('meta-clicking a group strips an already-selected descendant leaf (overlap invariant)', () => {
    const { ctx, selectIds } = nodeTreeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={['b']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select group Group' }), { metaKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['G']);
  });
});
