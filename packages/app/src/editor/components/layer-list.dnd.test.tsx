// @vitest-environment jsdom
// #154 — layers-panel DnD wiring + tree-aware range selection. Synthetic drag
// events (fireEvent.dragStart/dragOver/drop), per the repo's drag-test
// approach. jsdom rects are 0-height, so the pointer→zone fallback lands on
// 'after' for leaves and 'into' for group headers; zone-specific cases mock
// getBoundingClientRect on the hovered row and pass a matching clientY.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import {
  createPcbLayerStack,
  getPcbLayer,
  isGroupNode,
  projectPcbLayerStack as projectFlatLayers,
  type GroupNode,
  type LayerNode,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import type { ToolContext } from '../types';
import { LayerList } from './layer-list';

afterEach(cleanup);

function shape(id: string, name: string): ShapeLayer {
  return { id, name, type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, color: 1 };
}

function group(id: string, name: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name, children };
}

// Bottom -> top: a, G(b, c), d. Panel renders [D, G-header, C, B, A].
function fixtureTree(): LayerNode[] {
  return [
    shape('a', 'A'),
    group('G', 'Group', [shape('b', 'B'), shape('c', 'C')]),
    shape('d', 'D'),
  ];
}

function treeCtx(layers: LayerNode[], selectedIds: readonly string[] = []) {
  let doc = { panelHp: 12, layers: createPcbLayerStack({ copper: layers }), guides: [] };
  const commit = vi.fn((next: typeof doc) => {
    doc = next;
  });
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
  return { ctx, commit, selectIds };
}

function leafRow(name: string): HTMLElement {
  return screen.getByRole('button', { name: `Select layer ${name}` }).closest('li')!;
}

function groupHeader(name: string): HTMLElement {
  return screen.getByRole('button', { name: `Select group ${name}` }).closest('div')!;
}

function topIds(stack: PcbLayerStack): string[] {
  return getPcbLayer(stack, 'copper').children.map((n) => n.id);
}

function groupChildren(stack: PcbLayerStack, groupId: string): string[] {
  const tree = getPcbLayer(stack, 'copper').children;
  for (const n of tree) {
    if (!isGroupNode(n)) continue;
    if (n.id === groupId) return n.children.map((c) => c.id);
    const nested = findGroupChildren(n.children, groupId);
    if (nested.length > 0) return nested;
  }
  return [];
}

function findGroupChildren(tree: LayerNode[], groupId: string): string[] {
  for (const node of tree) {
    if (!isGroupNode(node)) continue;
    if (node.id === groupId) return node.children.map((child) => child.id);
    const nested = findGroupChildren(node.children, groupId);
    if (nested.length > 0) return nested;
  }
  return [];
}

// Pin a row's rect so clientY can steer the drop zone.
function mockRect(el: HTMLElement, top: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

// jsdom's DragEvent ignores MouseEvent init fields, so `fireEvent.dragOver(el,
// { clientY })` silently yields clientY: undefined — pin the coordinate onto
// the created event instead.
function fireDragAt(type: 'dragOver' | 'drop', el: HTMLElement, clientY: number): void {
  const event = createEvent[type](el);
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(el, event);
}

describe('LayerList DnD — drop on group header', () => {
  it('fires moveNodeToParent(child, group, 0): the dragged leaf becomes children[0]', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(groupHeader('Group')); // zero-rect fallback → 'into'
    fireEvent.drop(groupHeader('Group'));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['G', 'd']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['a', 'b', 'c']);
  });

  it('drop immediately after dragstart works (drag id read synchronously from the ref)', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // No dragOver in between — a state-only mirror would still be null here.
    fireEvent.dragStart(leafRow('A'));
    fireEvent.drop(groupHeader('Group'));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(groupChildren(commit.mock.calls[0][0].layers, 'G')).toEqual(['a', 'b', 'c']);
  });

  it('dropping into an empty group via its placeholder row', () => {
    const { ctx, commit } = treeCtx([shape('a', 'A'), group('G', 'Group', [])]);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.dragStart(leafRow('A'));
    const placeholder = screen.getByText('Empty group');
    fireEvent.dragOver(placeholder);
    fireEvent.drop(placeholder);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(groupChildren(commit.mock.calls[0][0].layers, 'G')).toEqual(['a']);
  });

  it('drops an ordinary subtree into an empty material as one commit', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    const { container } = render(<LayerList ctx={ctx} selectedIds={[]} />);
    const silkscreenList = container.querySelector(
      '[data-material-role="silkscreen"] > ul',
    ) as HTMLElement;

    fireEvent.dragStart(groupHeader('Group'));
    fireEvent.dragOver(silkscreenList);
    fireEvent.drop(silkscreenList);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(getPcbLayer(nextDoc.layers, 'copper').children.map((node) => node.id)).toEqual([
      'a',
      'd',
    ]);
    expect(getPcbLayer(nextDoc.layers, 'silkscreen').children.map((node) => node.id)).toEqual([
      'G',
    ]);
    expect(
      projectFlatLayers(nextDoc.layers)
        .filter((layer) => ['b', 'c'].includes(layer.id))
        .map((layer) => ('color' in layer ? layer.color : null)),
    ).toEqual([2, 2]);
  });
});

describe('LayerList DnD — positional drops', () => {
  it("drops ABOVE the top row via the 'before' zone (top-level positional move)", () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const dRow = leafRow('D');
    mockRect(dRow, 0, 24);
    fireEvent.dragStart(leafRow('A'));
    fireDragAt('dragOver', dRow, 4); // top half → 'before'
    fireDragAt('drop', dRow, 4);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(topIds(commit.mock.calls[0][0].layers)).toEqual(['G', 'd', 'a']);
  });

  it("drops BELOW a row via the 'after' zone", () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // zero-rect fallback on a leaf → 'after' (below A = bottom of the stack)
    fireEvent.dragStart(leafRow('D'));
    fireEvent.dragOver(leafRow('A'));
    fireEvent.drop(leafRow('A'));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(topIds(commit.mock.calls[0][0].layers)).toEqual(['d', 'a', 'G']);
  });

  it('reorders WITHIN a group (intra-group positional move)', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const cRow = leafRow('C');
    mockRect(cRow, 0, 24);
    fireEvent.dragStart(leafRow('B'));
    fireDragAt('dragOver', cRow, 4); // above C, still inside G
    fireDragAt('drop', cRow, 4);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['a', 'G', 'd']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['c', 'b']);
  });

  it('drags a nested row OUT of its group onto a top-level slot', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const dRow = leafRow('D');
    mockRect(dRow, 0, 24);
    fireEvent.dragStart(leafRow('B'));
    fireDragAt('dragOver', dRow, 4); // above D → top-level top slot
    fireDragAt('drop', dRow, 4);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['a', 'G', 'd', 'b']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['c']);
  });

  it("the gap below an EXPANDED group header drops into the group's visual top", () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const header = groupHeader('Group');
    mockRect(header, 0, 24);
    fireEvent.dragStart(leafRow('A'));
    fireDragAt('dragOver', header, 22); // bottom edge → 'after'
    fireDragAt('drop', header, 22);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(groupChildren(commit.mock.calls[0][0].layers, 'G')).toEqual(['b', 'c', 'a']);
  });

  it('the gap below a COLLAPSED group header stays a sibling slot (no accidental reparent)', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Group' }));
    const header = groupHeader('Group');
    mockRect(header, 0, 24);
    fireEvent.dragStart(leafRow('D'));
    fireDragAt('dragOver', header, 22);
    fireDragAt('drop', header, 22);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['a', 'd', 'G']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['b', 'c']);
  });

  it('drops on the root list tail land at the visual bottom (outdent below an expanded group)', () => {
    // [G([a])]: without the tail target, no row zone reaches the top-level
    // slot below G (codex review finding).
    const { ctx, commit } = treeCtx([group('G', 'Group', [shape('a', 'A')])]);
    const { container } = render(<LayerList ctx={ctx} selectedIds={[]} />);

    const rootList = container.querySelector('[data-material-role="copper"] > ul') as HTMLElement;
    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(rootList);
    fireEvent.drop(rootList);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['a', 'G']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual([]);
  });

  it('a multi-root drop landing back on its own run commits nothing (no phantom history entry)', () => {
    const { ctx, commit } = treeCtx(fixtureTree(), ['a', 'G']);
    render(<LayerList ctx={ctx} selectedIds={['a', 'G']} />);

    // 'after' D (zero-rect fallback) anchors [a, G] right back before d —
    // structurally unchanged, so the drop must not create an undo entry.
    fireEvent.dragStart(groupHeader('Group'));
    fireEvent.dragOver(leafRow('D'));
    fireEvent.drop(leafRow('D'));

    expect(commit).not.toHaveBeenCalled();
  });

  it('dropping a row onto its own slot commits nothing (no phantom history entry)', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // 'after' D (zero-rect fallback) = the slot D already occupies... use A:
    // below G is exactly where A sits.
    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(leafRow('A'));
    fireEvent.drop(leafRow('A'));

    expect(commit).not.toHaveBeenCalled();
  });
});

describe('LayerList DnD — invalid-drop guards (silent reject, no history)', () => {
  it('rejects dropping a group into itself: disabled affordance, no commit', () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const header = groupHeader('Group');
    fireEvent.dragStart(header);
    fireEvent.dragOver(header); // zero-rect fallback → 'into' itself
    expect(header.getAttribute('data-drop-invalid')).toBe('true');
    expect(header.getAttribute('aria-disabled')).toBe('true');

    fireEvent.drop(header);
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects dropping a group into its own descendant subtree', () => {
    const tree = [
      group('outer', 'Outer', [group('inner', 'Inner', [shape('x', 'X')])]),
      shape('y', 'Y'),
    ];
    const { ctx, commit } = treeCtx(tree);
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const innerHeader = groupHeader('Inner');
    fireEvent.dragStart(groupHeader('Outer'));
    fireEvent.dragOver(innerHeader);
    expect(innerHeader.getAttribute('data-drop-invalid')).toBe('true');

    fireEvent.drop(innerHeader);
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a drop 'between' rows that live inside the dragged subtree", () => {
    const { ctx, commit } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const bRow = leafRow('B');
    fireEvent.dragStart(groupHeader('Group'));
    fireEvent.dragOver(bRow); // 'after' B → a slot inside G itself
    expect(bRow.getAttribute('data-drop-invalid')).toBe('true');

    fireEvent.drop(bRow);
    expect(commit).not.toHaveBeenCalled();
  });

  // Depth-cap ground truth is the parser (serialize.ts): MAX_GROUP_DEPTH caps
  // GROUP nesting only. g1..g9 is the deepest legal chain (g9 at
  // ancestor-group-count 8); a group dropped into g9 would sit one past the
  // cap, but a LEAF dropped there is still legal.
  function deepTree(): LayerNode[] {
    let node: LayerNode = shape('leaf', 'Leaf');
    for (let i = 9; i >= 1; i -= 1) node = group(`g${i}`, `g${i}`, [node]);
    return [node, group('H', 'H', [shape('x', 'X')]), shape('solo', 'Solo')];
  }

  it('rejects a group drop past the depth cap: disabled affordance, no commit', () => {
    const { ctx, commit } = treeCtx(deepTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const g9Header = groupHeader('g9');
    fireEvent.dragStart(groupHeader('H'));
    fireEvent.dragOver(g9Header);
    expect(g9Header.getAttribute('data-drop-invalid')).toBe('true');
    expect(g9Header.getAttribute('aria-disabled')).toBe('true');

    fireEvent.drop(g9Header);
    expect(commit).not.toHaveBeenCalled();
  });

  it('still accepts a LEAF into the deepest legal group (leaves are never depth-capped)', () => {
    const { ctx, commit } = treeCtx(deepTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const g9Header = groupHeader('g9');
    fireEvent.dragStart(leafRow('Solo'));
    fireEvent.dragOver(g9Header);
    expect(g9Header.hasAttribute('data-drop-invalid')).toBe(false);

    fireEvent.drop(g9Header);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(groupChildren(commit.mock.calls[0][0].layers, 'g9')).toEqual(['solo', 'leaf']);
  });

  it('a valid hover then an invalid hover swaps the affordance rows', () => {
    const { ctx } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    const header = groupHeader('Group');
    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(header);
    expect(header.getAttribute('data-drop')).toBe('into');
    expect(header.hasAttribute('data-drop-invalid')).toBe(false);

    fireEvent.dragLeave(header);
    expect(header.hasAttribute('data-drop')).toBe(false);
  });
});

describe('LayerList DnD — multi-selection drag', () => {
  it('dragging a selected row moves the maximal selected roots as ONE commit', () => {
    const { ctx, commit } = treeCtx(fixtureTree(), ['a', 'd']);
    render(<LayerList ctx={ctx} selectedIds={['a', 'd']} />);

    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(groupHeader('Group'));
    fireEvent.drop(groupHeader('Group'));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['G']);
    // Both roots land contiguously at the header slot, DFS order preserved.
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('a selection containing a group and a stray descendant collapses to maximal roots for the drag', () => {
    // Selection ['G', 'b'] should never happen post-#151, but the drag path
    // must still collapse defensively rather than move b twice.
    const { ctx, commit } = treeCtx(fixtureTree(), ['G', 'b']);
    render(<LayerList ctx={ctx} selectedIds={['G', 'b']} />);

    const dRow = leafRow('D');
    mockRect(dRow, 0, 24);
    fireEvent.dragStart(groupHeader('Group'));
    fireDragAt('dragOver', dRow, 4); // above D
    fireDragAt('drop', dRow, 4);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['a', 'd', 'G']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['b', 'c']);
  });

  it('dragging an UNselected row moves only that row, leaving the selection alone', () => {
    const { ctx, commit } = treeCtx(fixtureTree(), ['d']);
    render(<LayerList ctx={ctx} selectedIds={['d']} />);

    fireEvent.dragStart(leafRow('A'));
    fireEvent.dragOver(groupHeader('Group'));
    fireEvent.drop(groupHeader('Group'));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextDoc] = commit.mock.calls[0];
    expect(topIds(nextDoc.layers)).toEqual(['G', 'd']);
    expect(groupChildren(nextDoc.layers, 'G')).toEqual(['a', 'b', 'c']);
  });
});

describe('LayerList tree range selection (#154)', () => {
  it('a shift-range spans a group boundary: leaves inside and outside stay individual', () => {
    const { ctx, selectIds } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // Visible rows [D, G, C, B, A]; anchor C (inside G) → shift A (outside).
    fireEvent.click(screen.getByRole('button', { name: 'Select layer C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer A' }), { shiftKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });

  it('a range covering a group header and its child rows keeps only the group ([group, descendant] invariant)', () => {
    const { ctx, selectIds } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    // Anchor D → shift B: range [D, G, C, B] collapses to ['G', 'd'].
    fireEvent.click(screen.getByRole('button', { name: 'Select layer D' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer B' }), { shiftKey: true });
    const last = selectIds.mock.calls.at(-1)![0] as string[];
    expect(last).toEqual(['G', 'd']);
    expect(last).not.toContain('b');
    expect(last).not.toContain('c');
  });

  it('collapsed groups contribute only their header — descendant ids never enter a range', () => {
    const { ctx, selectIds } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Group' }));
    // Visible rows now [D, G, A].
    fireEvent.click(screen.getByRole('button', { name: 'Select layer A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer D' }), { shiftKey: true });
    const last = selectIds.mock.calls.at(-1)![0] as string[];
    expect(last).toEqual(['a', 'G', 'd']);
    expect(last).not.toContain('b');
    expect(last).not.toContain('c');
  });

  it('an anchor that vanishes into a collapsed subtree degrades the shift-click to a single select', () => {
    const { ctx, selectIds } = treeCtx(fixtureTree());
    render(<LayerList ctx={ctx} selectedIds={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select layer B' })); // anchor inside G
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select layer D' }), { shiftKey: true });
    expect(selectIds).toHaveBeenLastCalledWith(['d']);
  });
});
