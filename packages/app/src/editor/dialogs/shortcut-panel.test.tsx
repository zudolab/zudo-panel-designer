// @vitest-environment jsdom
//
// Imported for its registration side effect: makes the built-in tools (and
// this dialog) discoverable via allCommands()/getDialog(), same reasoning as
// commands.test.ts.
import '../registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Pt } from '@zpd/core';
import { allCommands, type CommandDef } from '../commands';
import { getDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import { filterShortcuts, shortcuttableCommands } from './shortcut-panel';

afterEach(cleanup);

function stubCtx(): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: [] },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn(),
    replace: vi.fn(),
    reset: vi.fn(),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    evictImageCache: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
  } as unknown as ToolContext;
}

function cmd(overrides: Partial<CommandDef>): CommandDef {
  return {
    id: 'demo',
    label: 'Demo',
    category: 'Demo',
    run: vi.fn(),
    isEnabled: () => true,
    ...overrides,
  };
}

describe('shortcuttableCommands — only commands with a real shortcut belong in the panel', () => {
  it('keeps chorded commands and shortcutDisplay overrides, drops chordless ones', () => {
    const chorded = cmd({ id: 'a', chord: { key: 'z', meta: true } });
    const overridden = cmd({ id: 'b', shortcutDisplay: 'Arrows' });
    const chordless = cmd({ id: 'c' });
    const result = shortcuttableCommands([chorded, overridden, chordless], true);
    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('applied to the real registry, includes Undo/tool-switches but excludes Align (palette-only)', () => {
    const result = shortcuttableCommands(allCommands(), true);
    const ids = result.map((c) => c.id);
    expect(ids).toContain('edit-undo');
    expect(ids).toContain('tool-select');
    expect(ids).toContain('help-shortcuts');
    expect(ids).toContain('app-command-palette');
    expect(ids).not.toContain('align-left');
    expect(ids).not.toContain('view-zoom-in');
  });

  // #155: Group/Ungroup are chorded CommandDefs, so they must surface here
  // for free — no bespoke wiring into the overlay.
  it('includes edit-group and edit-ungroup (⌘G / ⌘⇧G)', () => {
    const result = shortcuttableCommands(allCommands(), true);
    const ids = result.map((c) => c.id);
    expect(ids).toContain('edit-group');
    expect(ids).toContain('edit-ungroup');
  });
});

describe('filterShortcuts — live search over label/category', () => {
  const commands = [
    cmd({ id: 'a', label: 'Undo', category: 'Edit' }),
    cmd({ id: 'b', label: 'Redo', category: 'Edit' }),
    cmd({ id: 'c', label: 'Select tool', category: 'Tool' }),
  ];

  it('returns everything for an empty/whitespace query', () => {
    expect(filterShortcuts(commands, '')).toHaveLength(3);
    expect(filterShortcuts(commands, '   ')).toHaveLength(3);
  });

  it('matches by label, case-insensitively', () => {
    expect(filterShortcuts(commands, 'undo').map((c) => c.id)).toEqual(['a']);
    expect(filterShortcuts(commands, 'UNDO').map((c) => c.id)).toEqual(['a']);
  });

  it('matches by category', () => {
    expect(filterShortcuts(commands, 'tool').map((c) => c.id)).toEqual(['c']);
  });

  it('returns nothing when no label/category matches', () => {
    expect(filterShortcuts(commands, 'zzz')).toEqual([]);
  });
});

describe('shortcut-panel dialog', () => {
  function getShortcutPanelDialog() {
    return getDialog('shortcut-panel')!.component;
  }

  it('renders category-grouped rows derived from the real command registry', () => {
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={vi.fn()} ctx={stubCtx()} />);

    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(screen.getByText('Tool')).toBeTruthy();
  });

  it('lists Group and Ungroup (#155)', () => {
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={vi.fn()} ctx={stubCtx()} />);

    expect(screen.getByText('Group')).toBeTruthy();
    expect(screen.getByText('Ungroup')).toBeTruthy();
  });

  it('focuses the search input on mount, not the Close button that precedes it in DOM order', () => {
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={vi.fn()} ctx={stubCtx()} />);

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search shortcuts…'));
  });

  it('search filters the visible rows live', () => {
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={vi.fn()} ctx={stubCtx()} />);

    fireEvent.change(screen.getByPlaceholderText('Search shortcuts…'), {
      target: { value: 'undo' },
    });

    expect(screen.getByText('Undo')).toBeTruthy();
    expect(screen.queryByText('Redo')).toBeNull();
    expect(screen.queryByText('Select')).toBeNull();
  });

  it('shows an empty state when nothing matches', () => {
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={vi.fn()} ctx={stubCtx()} />);

    fireEvent.change(screen.getByPlaceholderText('Search shortcuts…'), {
      target: { value: 'zzzznomatch' },
    });

    expect(screen.getByText(/No shortcuts match/)).toBeTruthy();
  });

  it('Close button calls close()', () => {
    const close = vi.fn();
    const ShortcutPanelDialog = getShortcutPanelDialog();
    render(<ShortcutPanelDialog props={{}} close={close} ctx={stubCtx()} />);

    fireEvent.click(screen.getByText('Close'));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
