// @vitest-environment jsdom
//
// Imported for its registration side effect: makes the built-in tools (and
// this dialog) discoverable via allCommands()/getDialog(), same reasoning as
// commands.test.ts.
import '../registry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Pt } from '@zpd/core';
import { type CommandContext, type CommandDef } from '../commands';
import { closeDialog, getDialog, openDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import {
  fuzzyFilterCommands,
  fuzzyScore,
  orderWithRecents,
  PALETTE_RECENTS_STORAGE_KEY,
  paletteCommands,
  paletteItems,
  readPaletteRecents,
  recordPaletteRecent,
} from './command-palette';

afterEach(() => {
  cleanup();
  localStorage.clear();
  closeDialog();
});

beforeEach(() => {
  localStorage.clear();
});

function stubCommandCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const base = {
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
    clipboard: {
      handleCopy: vi.fn(),
      handleCut: vi.fn(),
      handleDuplicate: vi.fn(),
      handleSelectAll: vi.fn(),
    },
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomFit: vi.fn(),
  } as unknown as CommandContext;
  return Object.assign(base, overrides);
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

describe('fuzzyScore — subsequence match, case-insensitive', () => {
  it('matches a contiguous substring with the lowest score', () => {
    expect(fuzzyScore('copy', 'Copy')).toBe(0);
  });

  it('matches a scattered subsequence with a higher (worse) score', () => {
    const tight = fuzzyScore('cpy', 'Copy')!;
    const loose = fuzzyScore('cy', 'Cxxxxxy')!;
    expect(tight).toBeGreaterThanOrEqual(0);
    expect(loose).toBeGreaterThan(tight);
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('zzz', 'Copy')).toBeNull();
    expect(fuzzyScore('yc', 'Copy')).toBeNull(); // wrong order
  });

  it('empty query matches everything with score 0', () => {
    expect(fuzzyScore('', 'Copy')).toBe(0);
  });
});

describe('fuzzyFilterCommands — matches label/category, best match first', () => {
  const commands = [
    cmd({ id: 'copy', label: 'Copy', category: 'Edit' }),
    cmd({ id: 'duplicate', label: 'Duplicate', category: 'Edit' }),
    cmd({ id: 'align-left', label: 'Align Left', category: 'Align' }),
  ];

  it('a category-only query surfaces every command in that category', () => {
    const result = fuzzyFilterCommands(commands, 'align');
    expect(result.map((c) => c.id)).toEqual(['align-left']);
  });

  it('a tighter label match ranks above a looser one', () => {
    const result = fuzzyFilterCommands(commands, 'cpy');
    expect(result[0]!.id).toBe('copy');
  });

  it('excludes non-matching commands entirely', () => {
    const result = fuzzyFilterCommands(commands, 'zzz');
    expect(result).toEqual([]);
  });
});

describe('orderWithRecents — recents lead, in recency order; rest follow', () => {
  const commands = [
    cmd({ id: 'a', label: 'A' }),
    cmd({ id: 'b', label: 'B' }),
    cmd({ id: 'c', label: 'C' }),
  ];

  it('puts recent ids first, most-recent first, then the remaining commands', () => {
    const result = orderWithRecents(commands, ['c', 'a']);
    expect(result.map((cmd) => cmd.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores a recent id that no longer maps to a real command', () => {
    const result = orderWithRecents(commands, ['ghost', 'b']);
    expect(result.map((cmd) => cmd.id)).toEqual(['b', 'a', 'c']);
  });

  it('with no recents, returns the natural order unchanged', () => {
    expect(orderWithRecents(commands, [])).toEqual(commands);
  });
});

describe('paletteItems — fuzzy-sorted while searching, recents-first when empty', () => {
  const commands = [cmd({ id: 'a', label: 'Alpha' }), cmd({ id: 'b', label: 'Beta' })];

  it('empty query defers to recents ordering', () => {
    expect(paletteItems(commands, '', ['b']).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('a whitespace-only query is treated as empty', () => {
    expect(paletteItems(commands, '   ', ['b']).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('a real query ignores recents and fuzzy-filters instead', () => {
    expect(paletteItems(commands, 'beta', ['a']).map((c) => c.id)).toEqual(['b']);
  });
});

describe('paletteCommands — excludes displayOnly entries', () => {
  it('drops displayOnly (Paste, Nudge) but keeps everything else', () => {
    const commands = [cmd({ id: 'real' }), cmd({ id: 'ghost', displayOnly: true })];
    expect(paletteCommands(commands).map((c) => c.id)).toEqual(['real']);
  });
});

describe('palette recents — localStorage-backed', () => {
  it('reads an empty list when nothing is stored', () => {
    expect(readPaletteRecents()).toEqual([]);
  });

  it('recordPaletteRecent persists most-recent-first, deduped', () => {
    recordPaletteRecent('a');
    recordPaletteRecent('b');
    recordPaletteRecent('a'); // re-run 'a' — moves back to the front, no duplicate
    expect(readPaletteRecents()).toEqual(['a', 'b']);
  });

  it('caps at the max recents count', () => {
    for (let i = 0; i < 12; i++) recordPaletteRecent(`cmd-${i}`);
    const recents = readPaletteRecents();
    expect(recents.length).toBeLessThanOrEqual(8);
    expect(recents[0]).toBe('cmd-11'); // most recent first
  });

  it('ignores malformed JSON rather than throwing', () => {
    localStorage.setItem(PALETTE_RECENTS_STORAGE_KEY, '{not json');
    expect(readPaletteRecents()).toEqual([]);
  });
});

describe('command-palette dialog', () => {
  function getCommandPaletteDialog() {
    return getDialog('command-palette')!.component;
  }

  // In production, DialogHost only ever mounts this component after
  // openDialog('command-palette') set the store — executeCommand's
  // close-only-if-still-open guard reads that store, so these direct-render
  // tests need it primed too (mirrors dialog-host.test.tsx's act(() =>
  // openDialog(...)) setup).
  beforeEach(() => {
    openDialog('command-palette');
  });

  it('Enter executes the highlighted (first) command and closes', () => {
    const ctx = stubCommandCtx();
    const close = vi.fn();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={close} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'undo' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Type a command…'), { key: 'Enter' });

    expect(ctx.undo).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(readPaletteRecents()).toEqual(['edit-undo']);
  });

  it('clicking a row executes that command directly', () => {
    const ctx = stubCommandCtx();
    const close = vi.fn();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={close} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'redo' },
    });
    fireEvent.click(screen.getByText('Redo'));

    expect(ctx.redo).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a disabled command (isEnabled === false) is shown but neither click nor Enter executes it', () => {
    // text-browse-google-fonts is disabled with no text layer selected.
    const ctx = stubCommandCtx({ selectedLayer: null });
    const close = vi.fn();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={close} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'google fonts' },
    });
    const row = screen.getByText('Browse Google Fonts');
    expect(row.closest('[role="option"]')?.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(row);
    expect(ctx.openDialog).not.toHaveBeenCalledWith('font-explorer', expect.anything());
    expect(close).not.toHaveBeenCalled();
  });

  it('Escape does not execute anything — the dialog host owns closing (no local handling)', () => {
    const ctx = stubCommandCtx();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={vi.fn()} ctx={ctx as unknown as ToolContext} />);

    fireEvent.keyDown(screen.getByPlaceholderText('Type a command…'), { key: 'Escape' });
    expect(ctx.undo).not.toHaveBeenCalled();
  });

  it('ArrowDown/ArrowUp move the highlighted row, and Enter runs whatever is highlighted', () => {
    const ctx = stubCommandCtx();
    const close = vi.fn();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={close} ctx={ctx as unknown as ToolContext} />);

    const input = screen.getByPlaceholderText('Type a command…');
    fireEvent.change(input, { target: { value: 'redo' } });
    // Only one match ("Redo") — ArrowDown should clamp, not overshoot.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ctx.redo).toHaveBeenCalledTimes(1);
  });

  it('shows "No matching commands" for an unmatched query', () => {
    const ctx = stubCommandCtx();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={vi.fn()} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'zzzznomatch' },
    });
    expect(screen.getByText('No matching commands')).toBeTruthy();
  });

  // #155: Group/Ungroup are plain chorded CommandDefs, so they're runnable
  // from the palette for free — proving this also exercises isEnabled gating
  // through the SAME cmdCtx the keyboard path uses (rowClassName/aria-disabled).
  it('clicking "Group" with 2 selected leaves groups them and closes', () => {
    const ctx = stubCommandCtx({
      doc: {
        panelHp: 12,
        guides: [],
        layers: [
          { id: 'a', name: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, color: 1 },
          { id: 'b', name: 'b', type: 'shape', shape: 'rect', x: 5, y: 5, width: 10, height: 10, color: 1 },
        ],
      },
      selectedIds: ['a', 'b'],
    });
    const close = vi.fn();
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={close} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'group' },
    });
    fireEvent.click(screen.getByText('Group'));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('"Ungroup" is listed disabled (aria-disabled) when nothing selected is a group', () => {
    const ctx = stubCommandCtx({
      doc: { panelHp: 12, guides: [], layers: [] },
      selectedIds: [],
    });
    const CommandPaletteDialog = getCommandPaletteDialog();
    render(<CommandPaletteDialog props={{}} close={vi.fn()} ctx={ctx as unknown as ToolContext} />);

    fireEvent.change(screen.getByPlaceholderText('Type a command…'), {
      target: { value: 'ungroup' },
    });
    const row = screen.getByText('Ungroup');
    expect(row.closest('[role="option"]')?.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(row);
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('renders recents first when reopened with an empty query', () => {
    recordPaletteRecent('edit-redo');
    const ctx = stubCommandCtx();
    const CommandPaletteDialog = getCommandPaletteDialog();
    const { container } = render(
      <CommandPaletteDialog props={{}} close={vi.fn()} ctx={ctx as unknown as ToolContext} />,
    );

    const firstRow = container.querySelector('[role="option"]');
    expect(firstRow?.textContent).toContain('Redo');
  });
});
