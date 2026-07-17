// @vitest-environment jsdom
//
// Imported for its registration side effect only: this is what makes the
// built-in select/pan/zoom/pen/text tools discoverable via allTools() below
// (mirrors __tests__/registry-contract.test.tsx, which gets the same side
// effect by rendering <App/>).
import './registry';
import { describe, expect, it, vi } from 'vitest';
import type { DocState, Pt, ShapeLayer, TextLayer } from '@zpd/core';
import { downloadPanelConfig } from './download';
import {
  allCommands,
  commandShortcutDisplay,
  commandsByCategory,
  dispatchCommand,
  findMatchingCommand,
  formatChord,
  matchesChord,
  type CommandContext,
  type CommandDef,
} from './commands';
import { registerTool, unregisterTool } from './registry/tools';
import type { ToolContext, ToolKeyEvent } from './types';

// download.ts's downloadPanelConfig() drives Blob/anchor DOM APIs jsdom
// doesn't implement (URL.createObjectURL) — download.test.ts already covers
// its actual output via the pure panelConfigJson(); here we only prove the
// command is wired to call it with ctx.doc.
vi.mock('./download', () => ({ downloadPanelConfig: vi.fn() }));

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const doc: DocState = { panelHp: 12, guides: [], layers: [] };
  return {
    doc,
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
    ...overrides,
  } as unknown as ToolContext;
}

function stubCommandCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const base = stubCtx() as CommandContext;
  base.clipboard = {
    handleCopy: vi.fn(),
    handleCut: vi.fn(),
    handleDuplicate: vi.fn(),
    handleSelectAll: vi.fn(),
  };
  base.zoomIn = vi.fn();
  base.zoomOut = vi.fn();
  base.zoomFit = vi.fn();
  return Object.assign(base, overrides);
}

function keyEvent(overrides: Partial<ToolKeyEvent> & { key: string }): ToolKeyEvent {
  return {
    key: overrides.key,
    code: overrides.code ?? `Key${overrides.key.toUpperCase()}`,
    altKey: overrides.altKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    metaKey: overrides.metaKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    preventDefault: overrides.preventDefault ?? vi.fn(),
  };
}

function rect(id: string, x: number, y: number): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width: 10, height: 10, color: 1 };
}

const textLayer: TextLayer = {
  id: 'text-1',
  name: 'Label',
  type: 'text',
  content: 'hi',
  fontFamily: 'Inter',
  sizeMm: 4,
  x: 1,
  y: 2,
  color: 0,
};

describe('tool commands — derived from the tool registry (single source of truth)', () => {
  it('every built-in tool with a shortcut appears as a tool-* command with a matching chord', () => {
    const ids = allCommands().map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['tool-select', 'tool-pan', 'tool-zoom', 'tool-pen', 'tool-text']),
    );
    const select = allCommands().find((c) => c.id === 'tool-select');
    expect(select?.chord).toEqual({ key: 'v', meta: false, alt: false });
    expect(select?.category).toBe('Tool');
  });

  it('registering a new tool with a shortcut immediately adds a matching command (live derivation)', () => {
    expect(allCommands().some((c) => c.id === 'tool-demo-throwaway')).toBe(false);
    registerTool({ id: 'demo-throwaway', label: 'Demo', shortcut: '9' });
    try {
      const cmd = allCommands().find((c) => c.id === 'tool-demo-throwaway');
      expect(cmd).toBeDefined();
      expect(cmd?.chord).toEqual({ key: '9', meta: false, alt: false });
      const ctx = stubCommandCtx();
      cmd?.run(ctx);
      expect(ctx.setActiveTool).toHaveBeenCalledWith('demo-throwaway');
    } finally {
      unregisterTool('demo-throwaway');
    }
    expect(allCommands().some((c) => c.id === 'tool-demo-throwaway')).toBe(false);
  });

  it('a tool with no shortcut produces no command', () => {
    registerTool({ id: 'demo-no-shortcut', label: 'Demo' });
    try {
      expect(allCommands().some((c) => c.id === 'tool-demo-no-shortcut')).toBe(false);
    } finally {
      unregisterTool('demo-no-shortcut');
    }
  });
});

describe('matchesChord — tri-state modifiers, key aliases, platform-agnostic meta', () => {
  it('meta matches metaKey OR ctrlKey — the pre-refactor code was never platform-gated', () => {
    const chord = { key: 'z', meta: true };
    expect(matchesChord(chord, keyEvent({ key: 'z', metaKey: true }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'z' }))).toBe(false);
  });

  it('an unspecified modifier is a wildcard (not checked)', () => {
    const chord = { key: 'v', meta: false, alt: false }; // shift omitted
    expect(matchesChord(chord, keyEvent({ key: 'v' }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'v', shiftKey: true }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'V', shiftKey: true }))).toBe(true); // case-insensitive
  });

  it('an explicit false modifier must NOT be held', () => {
    const chord = { key: 'v', meta: false, alt: false };
    expect(matchesChord(chord, keyEvent({ key: 'v', altKey: true }))).toBe(false);
    expect(matchesChord(chord, keyEvent({ key: 'v', metaKey: true }))).toBe(false);
  });

  it('an explicit true modifier must be held', () => {
    const chord = { key: 'z', meta: true, shift: true };
    expect(matchesChord(chord, keyEvent({ key: 'z', metaKey: true, shiftKey: true }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'z', metaKey: true, shiftKey: false }))).toBe(false);
  });

  it('a key array matches any alias (Delete/Backspace share one command)', () => {
    const chord = { key: ['Delete', 'Backspace'] as const };
    expect(matchesChord(chord, keyEvent({ key: 'Delete' }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'Backspace' }))).toBe(true);
    expect(matchesChord(chord, keyEvent({ key: 'Escape' }))).toBe(false);
  });
});

describe('findMatchingCommand — disabled and display-only commands never fire', () => {
  const enabledCmd: CommandDef = {
    id: 'enabled',
    label: 'Enabled',
    category: 'Test',
    chord: { key: 'k' },
    run: vi.fn(),
    isEnabled: () => true,
  };
  const disabledCmd: CommandDef = {
    id: 'disabled',
    label: 'Disabled',
    category: 'Test',
    chord: { key: 'j' },
    run: vi.fn(),
    isEnabled: () => false,
  };
  const displayOnlyCmd: CommandDef = {
    id: 'display-only',
    label: 'Display only',
    category: 'Test',
    chord: { key: 'l' },
    displayOnly: true,
    run: vi.fn(),
    isEnabled: () => true,
  };

  it('matches an enabled command with a chord match', () => {
    const found = findMatchingCommand([enabledCmd], keyEvent({ key: 'k' }), stubCommandCtx());
    expect(found).toBe(enabledCmd);
  });

  it('a disabled command is skipped even though its chord matches', () => {
    const found = findMatchingCommand([disabledCmd], keyEvent({ key: 'j' }), stubCommandCtx());
    expect(found).toBeNull();
  });

  it('a displayOnly command is never matched, even with a matching chord and isEnabled true', () => {
    const found = findMatchingCommand([displayOnlyCmd], keyEvent({ key: 'l' }), stubCommandCtx());
    expect(found).toBeNull();
  });

  it('a chordless command is never matched by keyboard dispatch', () => {
    const chordless: CommandDef = { ...enabledCmd, id: 'chordless', chord: undefined };
    const found = findMatchingCommand([chordless], keyEvent({ key: 'k' }), stubCommandCtx());
    expect(found).toBeNull();
  });
});

describe('dispatchCommand — parity table against the pre-refactor Editor.tsx branches', () => {
  it('Cmd+Z undoes, Ctrl+Z (non-Mac) also undoes, and preventDefault fires', () => {
    const ctx = stubCommandCtx();
    const e = keyEvent({ key: 'z', metaKey: true });
    const match = dispatchCommand(e, ctx);
    expect(match?.id).toBe('edit-undo');
    expect(ctx.undo).toHaveBeenCalledTimes(1);
    expect(ctx.redo).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Ctrl combos aside, Ctrl+Z alone (no meta) also undoes — platform-agnostic', () => {
    const ctx = stubCommandCtx();
    dispatchCommand(keyEvent({ key: 'z', ctrlKey: true }), ctx);
    expect(ctx.undo).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Shift+Z redoes', () => {
    const ctx = stubCommandCtx();
    const match = dispatchCommand(keyEvent({ key: 'z', metaKey: true, shiftKey: true }), ctx);
    expect(match?.id).toBe('edit-redo');
    expect(ctx.redo).toHaveBeenCalledTimes(1);
    expect(ctx.undo).not.toHaveBeenCalled();
  });

  it('Cmd+C copies with preventDefault; Cmd+Shift+C does not (shift excludes it, same as before #76)', () => {
    const ctx = stubCommandCtx();
    const e1 = keyEvent({ key: 'c', metaKey: true });
    dispatchCommand(e1, ctx);
    expect(ctx.clipboard.handleCopy).toHaveBeenCalledTimes(1);
    expect(e1.preventDefault).toHaveBeenCalledTimes(1);

    const ctx2 = stubCommandCtx();
    const match2 = dispatchCommand(keyEvent({ key: 'c', metaKey: true, shiftKey: true }), ctx2);
    expect(match2).toBeNull();
    expect(ctx2.clipboard.handleCopy).not.toHaveBeenCalled();
  });

  it('Cmd+X cuts, Cmd+D duplicates, Cmd+A selects all', () => {
    const ctx = stubCommandCtx();
    dispatchCommand(keyEvent({ key: 'x', metaKey: true }), ctx);
    expect(ctx.clipboard.handleCut).toHaveBeenCalledTimes(1);
    dispatchCommand(keyEvent({ key: 'd', metaKey: true }), ctx);
    expect(ctx.clipboard.handleDuplicate).toHaveBeenCalledTimes(1);
    dispatchCommand(keyEvent({ key: 'a', metaKey: true }), ctx);
    expect(ctx.clipboard.handleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('Cmd+V never dispatches — paste is display-only, owned entirely by the native paste event', () => {
    const ctx = stubCommandCtx();
    const e = keyEvent({ key: 'v', metaKey: true });
    const match = dispatchCommand(e, ctx);
    expect(match).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('a bare tool-shortcut letter switches tools; Shift is ignored, Alt/Meta excludes it', () => {
    const ctx = stubCommandCtx();
    dispatchCommand(keyEvent({ key: 'v' }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('select');
    dispatchCommand(keyEvent({ key: 'V', shiftKey: true }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('select');
    dispatchCommand(keyEvent({ key: 'h' }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('pan');
    dispatchCommand(keyEvent({ key: 'z' }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('zoom');
    dispatchCommand(keyEvent({ key: 'p' }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('pen');
    dispatchCommand(keyEvent({ key: 't' }), ctx);
    expect(ctx.setActiveTool).toHaveBeenLastCalledWith('text');

    const setActiveToolCalls = (ctx.setActiveTool as ReturnType<typeof vi.fn>).mock.calls.length;
    dispatchCommand(keyEvent({ key: 'v', altKey: true }), ctx);
    dispatchCommand(keyEvent({ key: 'v', metaKey: true }), ctx);
    expect((ctx.setActiveTool as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      setActiveToolCalls,
    );
  });

  it('Delete/Backspace delete the selection as one commit, WITHOUT preventDefault (matches pre-#76)', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: [rect('a', 0, 0), rect('b', 5, 5)] };
    const ctx = stubCommandCtx({ doc, selectedIds: ['a'] });
    const e = keyEvent({ key: 'Delete' });
    const match = dispatchCommand(e, ctx);
    expect(match?.id).toBe('edit-delete');
    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.selectIds).toHaveBeenCalledWith([]);
    expect(e.preventDefault).not.toHaveBeenCalled();

    const ctx2 = stubCommandCtx({ doc, selectedIds: ['b'] });
    dispatchCommand(keyEvent({ key: 'Backspace' }), ctx2);
    expect(ctx2.commit).toHaveBeenCalledTimes(1);
  });

  it('Delete with nothing selected still "matches" but is a safe no-op (mirrors the old internal guard)', () => {
    const ctx = stubCommandCtx({ selectedIds: [] });
    const match = dispatchCommand(keyEvent({ key: 'Delete' }), ctx);
    expect(match?.id).toBe('edit-delete');
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('Escape deselects without preventDefault, regardless of any held modifier', () => {
    const ctx = stubCommandCtx();
    const e = keyEvent({ key: 'Escape', metaKey: true });
    const match = dispatchCommand(e, ctx);
    expect(match?.id).toBe('edit-deselect');
    expect(ctx.selectIds).toHaveBeenCalledWith([]);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('an unrelated key with no matching command dispatches nothing', () => {
    const ctx = stubCommandCtx();
    const match = dispatchCommand(keyEvent({ key: 'q' }), ctx);
    expect(match).toBeNull();
  });
});

describe('align / distribute commands — real isEnabled gating (issue: "disabled commands don\'t fire")', () => {
  it('align-left is disabled under 2 eligible layers and enabled at 2+', () => {
    const align = allCommands().find((c) => c.id === 'align-left')!;
    const oneLayerCtx = stubCommandCtx({
      doc: { panelHp: 12, guides: [], layers: [rect('a', 0, 0)] },
      selectedIds: ['a'],
    });
    expect(align.isEnabled(oneLayerCtx)).toBe(false);

    const twoLayerCtx = stubCommandCtx({
      doc: { panelHp: 12, guides: [], layers: [rect('a', 0, 0), rect('b', 30, 20)] },
      selectedIds: ['a', 'b'],
    });
    expect(align.isEnabled(twoLayerCtx)).toBe(true);
    align.run(twoLayerCtx);
    expect(twoLayerCtx.commit).toHaveBeenCalledTimes(1);
  });

  it('align-distribute-h needs 3+ eligible layers (selection reference)', () => {
    const distribute = allCommands().find((c) => c.id === 'align-distribute-h')!;
    const twoLayerCtx = stubCommandCtx({
      doc: { panelHp: 12, guides: [], layers: [rect('a', 0, 0), rect('b', 30, 20)] },
      selectedIds: ['a', 'b'],
    });
    expect(distribute.isEnabled(twoLayerCtx)).toBe(false);
  });
});

describe('text-browse-google-fonts — real isEnabled gating', () => {
  it('is disabled with no selection, disabled for a non-text layer, enabled for a text layer', () => {
    const cmd = allCommands().find((c) => c.id === 'text-browse-google-fonts')!;
    expect(cmd.isEnabled(stubCommandCtx({ selectedLayer: null }))).toBe(false);
    expect(cmd.isEnabled(stubCommandCtx({ selectedLayer: rect('a', 0, 0) }))).toBe(false);

    const ctx = stubCommandCtx({ selectedLayer: textLayer });
    expect(cmd.isEnabled(ctx)).toBe(true);
    cmd.run(ctx);
    expect(ctx.openDialog).toHaveBeenCalledWith('font-explorer', { layerId: 'text-1' });
  });
});

describe('chordless commands (zoom / align / file / text) have run() wired to a real effect', () => {
  it('view-zoom-in/out/fit call the CommandContext zoom methods', () => {
    const ctx = stubCommandCtx();
    allCommands()
      .find((c) => c.id === 'view-zoom-in')!
      .run(ctx);
    expect(ctx.zoomIn).toHaveBeenCalledTimes(1);
    allCommands()
      .find((c) => c.id === 'view-zoom-out')!
      .run(ctx);
    expect(ctx.zoomOut).toHaveBeenCalledTimes(1);
    allCommands()
      .find((c) => c.id === 'view-zoom-fit')!
      .run(ctx);
    expect(ctx.zoomFit).toHaveBeenCalledTimes(1);
  });

  it('file-download-json calls downloadPanelConfig with ctx.doc', () => {
    const doc: DocState = { panelHp: 6, guides: [], layers: [] };
    const ctx = stubCommandCtx({ doc });
    allCommands()
      .find((c) => c.id === 'file-download-json')!
      .run(ctx);
    expect(downloadPanelConfig).toHaveBeenCalledWith(doc);
  });
});

describe('no two dispatchable commands share an identical chord', () => {
  it('every (key, meta, shift, alt) combination among chorded, non-displayOnly commands is unique enough to avoid ambiguity', () => {
    const dispatchable = allCommands().filter((c) => c.chord && !c.displayOnly);
    // Sanity check via direct matching rather than a naive signature string:
    // two chords "collide" only if some real event matches both.
    for (let i = 0; i < dispatchable.length; i++) {
      for (let j = i + 1; j < dispatchable.length; j++) {
        const a = dispatchable[i]!.chord!;
        const b = dispatchable[j]!.chord!;
        const aKeys = Array.isArray(a.key) ? a.key : [a.key];
        const bKeys = Array.isArray(b.key) ? b.key : [b.key];
        const sharesKey = aKeys.some((k) =>
          bKeys.some((k2) => k.toLowerCase() === k2.toLowerCase()),
        );
        if (!sharesKey) continue;
        // Same key(s) — only a real collision if meta/shift/alt could all
        // simultaneously satisfy both (any explicit value must agree).
        const compatible = (['meta', 'shift', 'alt'] as const).every((mod) => {
          if (a[mod] === undefined || b[mod] === undefined) return true;
          return a[mod] === b[mod];
        });
        expect(
          compatible,
          `${dispatchable[i]!.id} vs ${dispatchable[j]!.id} share an ambiguous chord`,
        ).toBe(false);
      }
    }
  });
});

describe('formatChord / commandShortcutDisplay — platform-aware (issue #76: is-mac.ts)', () => {
  it('renders Mac glyphs when mac=true', () => {
    expect(formatChord({ key: 'z', meta: true, shift: false }, true)).toBe('⌘Z');
    expect(formatChord({ key: 'z', meta: true, shift: true }, true)).toBe('⌘⇧Z');
    expect(formatChord({ key: 'v', meta: false, alt: false }, true)).toBe('V');
  });

  it('renders textual Ctrl/Shift/Alt when mac=false', () => {
    expect(formatChord({ key: 'z', meta: true, shift: false }, false)).toBe('Ctrl+Z');
    expect(formatChord({ key: 'z', meta: true, shift: true }, false)).toBe('Ctrl+Shift+Z');
  });

  it('joins key aliases with " / " (Delete/Backspace)', () => {
    expect(formatChord({ key: ['Delete', 'Backspace'] }, true)).toBe('Delete / Backspace');
  });

  it('commandShortcutDisplay prefers an explicit override (Nudge) over chord derivation', () => {
    const nudge = allCommands().find((c) => c.id === 'edit-nudge')!;
    expect(commandShortcutDisplay(nudge, true)).toBe('Arrows (Shift = ×10)');
  });

  it('commandShortcutDisplay derives from the chord when no override is set (Paste)', () => {
    const paste = allCommands().find((c) => c.id === 'edit-paste')!;
    expect(commandShortcutDisplay(paste, true)).toBe('⌘V');
    expect(commandShortcutDisplay(paste, false)).toBe('Ctrl+V');
  });

  it('commandShortcutDisplay is undefined for a chordless, non-overridden command (Align)', () => {
    const align = allCommands().find((c) => c.id === 'align-left')!;
    expect(commandShortcutDisplay(align)).toBeUndefined();
  });
});

describe('commandsByCategory', () => {
  it('groups every command under its category with no loss/duplication', () => {
    const all = allCommands();
    const grouped = commandsByCategory(all);
    const flattened = [...grouped.values()].flat();
    expect(flattened.length).toBe(all.length);
    expect(grouped.get('Tool')?.length).toBe(5);
    expect(grouped.get('Align')?.length).toBe(8);
  });
});
