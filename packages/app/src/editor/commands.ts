// Contextual command registry (issue #76): a flat list of CommandDef entries
// describing every app-level action reachable from a keyboard shortcut, plus
// a command palette / shortcuts overlay (issue #77 — dialogs/command-palette.tsx
// and dialogs/shortcut-panel.tsx) that both consume this list directly.
//
// Each command reads `ctx` FRESH on every invocation — commands are never pre-bound closures
// baked in at registration time. This deliberately diverges from the
// reference port (pgen's composer-commands.ts CommandCallbacks indirection
// layer) per the issue's review guidance: "a contextual command model, no
// pre-bound actions."
//
// Tool-switch commands are DERIVED from the tool registry (registry/tools.ts)
// at call time, so a tool's `shortcut` stays the ONE source of truth for both
// the toolbar and this list — see toolCommands() below.
//
// HARD REQUIREMENT (behavioral parity): every shortcut that fired before this
// refactor fires exactly the same way after it. See Editor.tsx's keydown
// handler for how this registry replaces the old inline branches, and
// commands.test.ts for the parity table.
import { deleteNodeById, type AlignType, type DistributeAxis } from '@zpd/core';
import { applyAlign, applyDistribute, canAlign, canDistribute, type Reference } from './align-ops';
import { downloadPanelConfig } from './download';
import { pickImportJsonFile } from './import';
import { isMac } from './is-mac';
import { allTools } from './registry/tools';
import { newPanelAction } from './replace-doc';
import type { ToolContext, ToolKeyEvent, ToolModule } from './types';
import type { UseClipboardReturn } from './use-clipboard';

// The context every command's run()/isEnabled() reads from. A superset of
// ToolContext: clipboard actions need the LIVE useClipboard() hook instance
// (OS clipboard writes + same-session fallback ref state can't be derived
// from ctx alone — see use-clipboard.ts), and zoom actions need the camera
// step/fit operations that live in Editor.tsx's render closures (viewport
// size isn't part of the shared ToolContext extension contract). Editor.tsx
// builds one of these per dispatch — see buildCommandContext-equivalent
// object literal in its keydown handler.
export interface CommandContext extends ToolContext {
  clipboard: Pick<
    UseClipboardReturn,
    'handleCopy' | 'handleCut' | 'handleDuplicate' | 'handleSelectAll'
  >;
  zoomIn(): void;
  zoomOut(): void;
  zoomFit(): void;
}

// key: one physical key, or several that all mean the same logical shortcut
// (e.g. Delete/Backspace). Case-insensitive against KeyboardEvent.key.
//
// meta/shift/alt are tri-state: `undefined` = don't care (not checked),
// `true`/`false` = that modifier MUST be held / MUST NOT be held. This is
// what lets a single matcher reproduce the pre-refactor code's asymmetric
// checks — e.g. tool-switch shortcuts never looked at Shift (V and Shift+V
// both switched tools), while clipboard shortcuts explicitly excluded it
// (Cmd+Shift+C never copied).
//
// `meta` matches metaKey OR ctrlKey, on ANY platform — the pre-refactor code
// was never platform-gated (Ctrl+Z worked on Mac too). is-mac.ts only
// decides which glyph to SHOW (⌘ vs "Ctrl+"), never which key is accepted.
export interface Chord {
  key: string | readonly string[];
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface CommandDef {
  id: string;
  label: string;
  category: string;
  /** Absent = not reachable from a keyboard shortcut (palette-only, e.g. Align, New Panel). */
  chord?: Chord;
  /**
   * True for entries whose real gesture is owned by other code (Paste — the
   * native browser `paste` event, see use-clipboard.ts; Nudge — Editor.tsx's
   * own arrow-key handling). They keep a `chord`/`shortcutDisplay` purely so
   * a future shortcuts UI can list them, but the fallback dispatcher below
   * never matches or runs them.
   */
  displayOnly?: boolean;
  /**
   * Editor's keydown dispatcher calls event.preventDefault() before run()
   * when true. Mirrors the exact pre-refactor branches: clipboard/undo/redo
   * always preventDefault()'d once their modifier+key matched; Escape/Delete
   * never did. Kept as an explicit per-command flag (rather than inferred)
   * so that asymmetry survives the refactor exactly.
   */
  preventDefault?: boolean;
  run(ctx: CommandContext): void;
  isEnabled(ctx: CommandContext): boolean;
  /** Overrides the auto-derived display string (see formatChord). */
  shortcutDisplay?: string;
}

const ALWAYS_ENABLED = () => true;

// --- tool-switch commands: derived from the tool registry ------------------
//
// Reads registry/tools.ts's allTools() FRESH on every call (not cached at
// module load) so a tool registered/unregistered after this module loads
// (e.g. a test's throwaway tool) is immediately reflected — see
// commands.test.ts's "adding a tool adds a command" case.
function hasShortcut(tool: ToolModule): tool is ToolModule & { shortcut: string } {
  return typeof tool.shortcut === 'string';
}

function toolCommands(): CommandDef[] {
  return allTools()
    .filter(hasShortcut)
    .map((tool): CommandDef => ({
      id: `tool-${tool.id}`,
      label: tool.label,
      category: 'Tool',
      // meta/alt required false, shift unchecked — mirrors the pre-refactor
      // gate `!e.metaKey && !e.ctrlKey && !e.altKey` before toolByShortcut().
      chord: { key: tool.shortcut, meta: false, alt: false },
      run: (ctx) => ctx.setActiveTool(tool.id),
      isEnabled: ALWAYS_ENABLED,
    }));
}

// --- static commands ---------------------------------------------------

const ALIGN_REFERENCE: Reference = 'selection';

function alignCommand(id: string, label: string, type: AlignType): CommandDef {
  return {
    id,
    label,
    category: 'Align',
    run: (ctx) => applyAlign(ctx, ctx.selectedIds, type, ALIGN_REFERENCE),
    isEnabled: (ctx) => canAlign(ctx.doc, ctx.selectedIds, ALIGN_REFERENCE),
  };
}

function distributeCommand(id: string, label: string, axis: DistributeAxis): CommandDef {
  return {
    id,
    label,
    category: 'Align',
    run: (ctx) => applyDistribute(ctx, ctx.selectedIds, axis, ALIGN_REFERENCE),
    isEnabled: (ctx) => canDistribute(ctx.doc, ctx.selectedIds, ALIGN_REFERENCE),
  };
}

const STATIC_COMMANDS: CommandDef[] = [
  // ── Edit ──────────────────────────────────────────────────────────────
  {
    id: 'edit-undo',
    label: 'Undo',
    category: 'Edit',
    chord: { key: 'z', meta: true, shift: false },
    preventDefault: true,
    run: (ctx) => ctx.undo(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-redo',
    label: 'Redo',
    category: 'Edit',
    chord: { key: 'z', meta: true, shift: true },
    preventDefault: true,
    run: (ctx) => ctx.redo(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-copy',
    label: 'Copy',
    category: 'Edit',
    chord: { key: 'c', meta: true, shift: false },
    preventDefault: true,
    run: (ctx) => ctx.clipboard.handleCopy(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-cut',
    label: 'Cut',
    category: 'Edit',
    chord: { key: 'x', meta: true, shift: false },
    preventDefault: true,
    run: (ctx) => ctx.clipboard.handleCut(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-duplicate',
    label: 'Duplicate',
    category: 'Edit',
    chord: { key: 'd', meta: true, shift: false },
    preventDefault: true,
    run: (ctx) => ctx.clipboard.handleDuplicate(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-select-all',
    label: 'Select All',
    category: 'Edit',
    chord: { key: 'a', meta: true, shift: false },
    preventDefault: true,
    run: (ctx) => ctx.clipboard.handleSelectAll(),
    isEnabled: ALWAYS_ENABLED,
  },
  // Paste is display-only: the ONLY paste path is the native browser `paste`
  // event (use-clipboard.ts owns it end to end — a keydown handler has no
  // access to clipboard contents). This entry exists purely so a shortcuts
  // UI can list "⌘V — Paste"; run() is never invoked.
  {
    id: 'edit-paste',
    label: 'Paste',
    category: 'Edit',
    chord: { key: 'v', meta: true },
    displayOnly: true,
    run: () => {},
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-delete',
    label: 'Delete',
    category: 'Edit',
    chord: { key: ['Delete', 'Backspace'] },
    run: (ctx) => {
      // Deletes the WHOLE selection as one undo entry (#45) — the same logic
      // as Editor.tsx's old inline deleteSelected() closure, rewritten
      // against ctx (equivalent: ctx.doc/selectedIds/commit/selectIds are the
      // same refs that closure read/called directly). Now the single owner,
      // since Delete/Backspace is fully registry-dispatched.
      const ids = ctx.selectedIds;
      if (ids.length === 0) return;
      // Recursive delete (#150): deleteNodeById removes each selected node
      // wherever it sits in the tree (a flat root filter would no-op for
      // group-nested leaves). Group-id cascade + maximal-root collapse
      // semantics for group selections are #151's.
      ctx.commit({
        ...ctx.doc,
        layers: ids.reduce((tree, id) => deleteNodeById(tree, id), ctx.doc.layers),
      });
      ctx.selectIds([]);
    },
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'edit-deselect',
    label: 'Deselect',
    category: 'Edit',
    chord: { key: 'Escape' },
    run: (ctx) => ctx.selectIds([]),
    isEnabled: ALWAYS_ENABLED,
  },
  // Nudge is display-only: 4 distinct arrow keys plus a Shift-scaled step
  // size don't collapse into one Chord, and the gesture stays exactly where
  // it was — Editor.tsx's own arrow-key switch (unchanged by this refactor).
  {
    id: 'edit-nudge',
    label: 'Nudge Selection',
    category: 'Edit',
    displayOnly: true,
    shortcutDisplay: 'Arrows (Shift = ×10)',
    run: () => {},
    isEnabled: ALWAYS_ENABLED,
  },

  // ── View ──────────────────────────────────────────────────────────────
  // Chordless (palette-only) for now: zpd has no pre-existing keyboard zoom
  // shortcut (only the Header's mouse buttons + wheel), and this is a
  // parity-focused refactor with "no UI" — adding a NEW, undocumented
  // keyboard shortcut is left to the palette/help-overlay sub, which can
  // surface it. run() still calls the exact same camera math as the Header
  // buttons (see Editor.tsx's zoomStep/fitView).
  {
    id: 'view-zoom-in',
    label: 'Zoom In',
    category: 'View',
    run: (ctx) => ctx.zoomIn(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'view-zoom-out',
    label: 'Zoom Out',
    category: 'View',
    run: (ctx) => ctx.zoomOut(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'view-zoom-fit',
    label: 'Zoom to Fit',
    category: 'View',
    run: (ctx) => ctx.zoomFit(),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'view-preview-3d',
    label: 'Preview 3D',
    category: 'View',
    run: (ctx) => ctx.openDialog('preview-3d'),
    isEnabled: ALWAYS_ENABLED,
  },

  // ── Align ─────────────────────────────────────────────────────────────
  // Chordless (palette-only), same as the reference app's align commands.
  // Reference mode defaults to 'selection' — the Align panel's own default —
  // since a palette-triggered command has no visible reference toggle to
  // read from.
  alignCommand('align-left', 'Align Left', 'left'),
  alignCommand('align-center-h', 'Align Center (Horizontal)', 'center-h'),
  alignCommand('align-right', 'Align Right', 'right'),
  alignCommand('align-top', 'Align Top', 'top'),
  alignCommand('align-middle-v', 'Align Middle (Vertical)', 'middle-v'),
  alignCommand('align-bottom', 'Align Bottom', 'bottom'),
  distributeCommand('align-distribute-h', 'Distribute Horizontally', 'horizontal'),
  distributeCommand('align-distribute-v', 'Distribute Vertically', 'vertical'),

  // ── File ──────────────────────────────────────────────────────────────
  {
    id: 'file-new-panel',
    label: 'New Panel',
    category: 'File',
    run: (ctx) => {
      void newPanelAction(ctx);
    },
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'file-import-json',
    label: 'Import JSON',
    category: 'File',
    run: (ctx) => pickImportJsonFile(ctx),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'file-download-json',
    label: 'Download JSON',
    category: 'File',
    run: (ctx) => downloadPanelConfig(ctx.doc),
    isEnabled: ALWAYS_ENABLED,
  },

  // ── Text ──────────────────────────────────────────────────────────────
  {
    id: 'text-browse-google-fonts',
    label: 'Browse Google Fonts',
    category: 'Text',
    run: (ctx) => {
      const layer = ctx.selectedLayer;
      if (layer && layer.type === 'text') ctx.openDialog('font-explorer', { layerId: layer.id });
    },
    isEnabled: (ctx) => ctx.selectedLayer?.type === 'text',
  },

  // ── Help ──────────────────────────────────────────────────────────────
  // Issue #77: the two entry points into the command-system UI itself. Both
  // dispatch through the SAME registry-routed fallback chain as every other
  // command (see Editor.tsx's keydown handler) — no parallel keydown path.
  // dialogs/shortcut-panel.tsx and dialogs/command-palette.tsx read ctx back
  // as a CommandContext (Editor.tsx wires DialogHost to the same commandCtx
  // dispatchCommand uses), so the palette can run any command it lists.
  {
    id: 'help-shortcuts',
    label: 'Keyboard Shortcuts',
    category: 'Help',
    chord: { key: '?' },
    // Without preventDefault the opening '?' keystroke also types into the
    // panel's auto-focused search field, filtering to nothing.
    preventDefault: true,
    run: (ctx) => ctx.openDialog('shortcut-panel'),
    isEnabled: ALWAYS_ENABLED,
  },
  {
    id: 'app-command-palette',
    label: 'Command Palette',
    category: 'Help',
    chord: { key: 'k', meta: true, shift: true },
    preventDefault: true,
    run: (ctx) => ctx.openDialog('command-palette'),
    isEnabled: ALWAYS_ENABLED,
  },
];

// --- registry-wide reads ----------------------------------------------

// Live: recomputes tool commands from the registry on every call. Cheap (a
// handful of tools) and correct under dynamic register/unregister (tests).
export function allCommands(): CommandDef[] {
  return [...toolCommands(), ...STATIC_COMMANDS];
}

export function commandsByCategory(
  commands: readonly CommandDef[] = allCommands(),
): Map<string, CommandDef[]> {
  const map = new Map<string, CommandDef[]>();
  for (const cmd of commands) {
    const list = map.get(cmd.category);
    if (list) list.push(cmd);
    else map.set(cmd.category, [cmd]);
  }
  return map;
}

// --- chord matching + dispatch ------------------------------------------

function normalizedKeys(chord: Chord): string[] {
  const keys = Array.isArray(chord.key) ? chord.key : [chord.key];
  return keys.map((k) => k.toLowerCase());
}

export function matchesChord(
  chord: Chord,
  e: Pick<ToolKeyEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): boolean {
  if (!normalizedKeys(chord).includes(e.key.toLowerCase())) return false;
  if (chord.meta !== undefined && chord.meta !== (e.metaKey || e.ctrlKey)) return false;
  if (chord.shift !== undefined && chord.shift !== e.shiftKey) return false;
  if (chord.alt !== undefined && chord.alt !== e.altKey) return false;
  return true;
}

// Pure matcher over an EXPLICIT command list — kept separate from
// dispatchCommand() so tests can probe matching/gating (e.g. "a disabled
// command never fires") against a small fixture list, independent of the
// real registry.
export function findMatchingCommand(
  commands: readonly CommandDef[],
  e: Pick<ToolKeyEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  ctx: CommandContext,
): CommandDef | null {
  for (const cmd of commands) {
    if (cmd.displayOnly || !cmd.chord) continue;
    if (!matchesChord(cmd.chord, e)) continue;
    if (!cmd.isEnabled(ctx)) continue;
    return cmd;
  }
  return null;
}

// Editor.tsx's fallback keydown entry point: finds the first enabled,
// non-display-only command whose chord matches `e`, preventDefault()s it if
// flagged, runs it, and returns it (or null if nothing matched) so the
// caller knows whether to keep falling through its own bespoke handling
// (nudge — see Editor.tsx).
export function dispatchCommand(e: ToolKeyEvent, ctx: CommandContext): CommandDef | null {
  const match = findMatchingCommand(allCommands(), e, ctx);
  if (match) {
    if (match.preventDefault) e.preventDefault();
    match.run(ctx);
  }
  return match;
}

// --- shortcut display (issue #76: is-mac.ts platform-aware ⌘/Ctrl) --------

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

function formatChordKey(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function formatChord(chord: Chord, mac: boolean = isMac()): string {
  const parts: string[] = [];
  if (chord.meta) parts.push(mac ? '⌘' : 'Ctrl');
  if (chord.alt) parts.push(mac ? '⌥' : 'Alt');
  if (chord.shift) parts.push(mac ? '⇧' : 'Shift');
  const keys = Array.isArray(chord.key) ? chord.key : [chord.key];
  parts.push(keys.map(formatChordKey).join(' / '));
  return mac ? parts.join('') : parts.join('+');
}

// The single place a future shortcuts UI reads a command's display string —
// an explicit shortcutDisplay always wins (e.g. Nudge's "Arrows (Shift =
// ×10)", which has no real Chord to derive from); otherwise it's derived
// from the chord; commands with neither (Align, New Panel, …) have no
// keyboard shortcut to show.
export function commandShortcutDisplay(
  cmd: CommandDef,
  mac: boolean = isMac(),
): string | undefined {
  if (cmd.shortcutDisplay) return cmd.shortcutDisplay;
  if (!cmd.chord) return undefined;
  return formatChord(cmd.chord, mac);
}
