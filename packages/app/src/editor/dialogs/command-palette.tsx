// Fuzzy command palette (issue #77), opened on Cmd/Ctrl+Shift+K (see
// commands.ts's 'app-command-palette' entry). Downsized port of pgen's
// app-shell/command-palette.tsx: dropped the drill-down / value-input /
// select-input sub-modes and toggle commands (zpd's CommandDef has none of
// those — every command is a plain run(ctx)/isEnabled(ctx) pair) and the
// ⌘-digit "palette pick" hint badges. What's kept: fuzzy label/category
// search, Enter-to-run, disabled rows shown but inert, and recents-first
// ordering.
//
// Rendered through the dialog host (backdrop, focus trap, initial focus,
// Escape-to-close all host-owned) — this component supplies content only.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  allCommands,
  commandShortcutDisplay,
  type CommandContext,
  type CommandDef,
} from '../commands';
import { isMac } from '../is-mac';
import { getOpenDialog, registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

export const PALETTE_RECENTS_STORAGE_KEY = 'zpd.palette-recents.v1';
const MAX_RECENTS = 8;

export function readPaletteRecents(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PALETTE_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Malformed JSON / storage access denied → behave as if empty; recents
    // are a convenience, never load-bearing.
    return [];
  }
}

// Most-recent-first, deduped, capped. Called on every successful command
// execution (see executeCommand below) — never on a disabled/no-op attempt.
export function recordPaletteRecent(id: string): void {
  if (typeof localStorage === 'undefined') return;
  const next = [id, ...readPaletteRecents().filter((existing) => existing !== id)].slice(
    0,
    MAX_RECENTS,
  );
  try {
    localStorage.setItem(PALETTE_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / private-mode denial — keep going in-memory only.
  }
}

// Subsequence fuzzy match, case-insensitive: every character of `query` must
// appear in `target`, in order, not necessarily contiguous ("cpy" matches
// "Copy"). Returns a score — lower is a tighter match (a contiguous run costs
// nothing; each gap between consecutive matched characters adds its length)
// — or null when `query` isn't a subsequence of `target` at all.
export function fuzzyScore(query: string, target: string): number | null {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    score += lastMatchIndex === -1 ? ti : ti - lastMatchIndex - 1;
    lastMatchIndex = ti;
    qi++;
  }
  return qi === q.length ? score : null;
}

// Fuzzy-filters + best-match-first sorts. Matches against "label category"
// combined, so a query can hit either field (e.g. "align" surfaces every
// Align command even though none of their labels contain that word).
export function fuzzyFilterCommands(commands: readonly CommandDef[], query: string): CommandDef[] {
  const scored: { cmd: CommandDef; score: number }[] = [];
  for (const cmd of commands) {
    const score = fuzzyScore(query, `${cmd.label} ${cmd.category}`);
    if (score !== null) scored.push({ cmd, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.cmd);
}

// Recents (that still exist in `commands`) lead the list, in recency order;
// everything else follows in its natural registry order.
export function orderWithRecents(
  commands: readonly CommandDef[],
  recentIds: readonly string[],
): CommandDef[] {
  const byId = new Map(commands.map((cmd) => [cmd.id, cmd] as const));
  const recentCommands = recentIds
    .map((id) => byId.get(id))
    .filter((cmd): cmd is CommandDef => cmd !== undefined);
  const recentIdSet = new Set(recentCommands.map((cmd) => cmd.id));
  const rest = commands.filter((cmd) => !recentIdSet.has(cmd.id));
  return [...recentCommands, ...rest];
}

// The palette's full row-ordering rule: fuzzy-sorted while searching,
// recents-first when the query is empty (mirrors the reference's "recent
// list only shown with no query" behavior).
export function paletteItems(
  commands: readonly CommandDef[],
  query: string,
  recentIds: readonly string[],
): CommandDef[] {
  const trimmed = query.trim();
  return trimmed ? fuzzyFilterCommands(commands, trimmed) : orderWithRecents(commands, recentIds);
}

// Runnable commands only: excludes displayOnly entries (Paste, Nudge) whose
// run() is an inert stand-in that exists purely for the shortcuts panel —
// executing one from the palette would silently do nothing.
export function paletteCommands(commands: readonly CommandDef[] = allCommands()): CommandDef[] {
  return commands.filter((cmd) => !cmd.displayOnly);
}

function rowClassName(isHighlighted: boolean, enabled: boolean): string {
  const base = 'flex items-center gap-3 px-3 py-1.5 text-xs';
  const tone = isHighlighted ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-200';
  const affordance = enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-40';
  return `${base} ${tone} ${affordance}`;
}

function CommandPaletteDialog({ close, ctx }: DialogProps) {
  // DialogHost is wired (Editor.tsx's `commandCtx`) to hand every dialog the
  // FULL command-execution context, even though DialogProps types `ctx` as
  // the narrower ToolContext that every other, read-only dialog needs —
  // cast here rather than widen that shared contract for this one consumer.
  const cmdCtx = ctx as unknown as CommandContext;
  const mac = useMemo(() => isMac(), []);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  // Read once per open — the palette is a fresh mount every time it opens
  // (DialogHost unmounts on close), so there's no live-sync need.
  const [recentIds] = useState(() => readPaletteRecents());
  const [commands] = useState(() => paletteCommands());
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => paletteItems(commands, query, recentIds),
    [commands, query, recentIds],
  );

  // Reset the highlight when the query changes — adjusted during render
  // (React's recommended pattern, see font-explorer.tsx's identical
  // filterKey/prevFilterKey trick) rather than a setState-in-effect, which
  // would cost an extra render/paint cycle for a purely derived reset.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setHighlightIndex(0);
  }

  useEffect(() => {
    const highlighted = listRef.current?.querySelector('[data-highlighted="true"]');
    if (highlighted instanceof HTMLElement && typeof highlighted.scrollIntoView === 'function') {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const executeCommand = useCallback(
    (cmd: CommandDef) => {
      if (!cmd.isEnabled(cmdCtx)) return;
      recordPaletteRecent(cmd.id);
      cmd.run(cmdCtx);
      // Some commands open a DIFFERENT dialog themselves (Keyboard Shortcuts
      // → shortcut-panel, Browse Google Fonts → font-explorer). The dialog
      // store only tracks one open dialog at a time, so an unconditional
      // close() here would tear down whatever run() just opened. Only close
      // if the palette is still the one showing.
      if (getOpenDialog()?.id === 'command-palette') close();
    },
    [cmdCtx, close],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (items.length > 0) setHighlightIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (items.length > 0) setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        e.preventDefault();
        const cmd = items[highlightIndex];
        if (cmd) executeCommand(cmd);
        break;
      }
      // Escape is intentionally NOT handled here — it bubbles to the dialog
      // host's document-level listener, which closes any open dialog.
    }
  };

  return (
    <div className="flex max-h-[70vh] w-[min(32rem,92vw)] flex-col" onKeyDown={onKeyDown}>
      <label className="sr-only" htmlFor="command-palette-search">
        Search commands
      </label>
      <input
        id="command-palette-search"
        type="text"
        role="combobox"
        aria-expanded={true}
        aria-controls="command-palette-listbox"
        aria-activedescendant={
          items[highlightIndex] ? `command-palette-item-${items[highlightIndex]!.id}` : undefined
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a command…"
        autoComplete="off"
        spellCheck={false}
        className="mb-2 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500"
      />

      <div
        ref={listRef}
        id="command-palette-listbox"
        role="listbox"
        aria-label="Commands"
        className="flex-1 overflow-y-auto rounded border border-neutral-800"
      >
        {items.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">No matching commands</p>
        ) : (
          items.map((cmd, index) => {
            const enabled = cmd.isEnabled(cmdCtx);
            const isHighlighted = index === highlightIndex;
            const shortcut = commandShortcutDisplay(cmd, mac);
            return (
              <div
                key={cmd.id}
                id={`command-palette-item-${cmd.id}`}
                role="option"
                aria-selected={isHighlighted}
                aria-disabled={!enabled}
                data-highlighted={isHighlighted ? 'true' : undefined}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => executeCommand(cmd)}
                className={rowClassName(isHighlighted, enabled)}
              >
                <span className="truncate">{cmd.label}</span>
                <span className="ml-auto shrink-0 text-[10px] text-neutral-500">
                  {cmd.category}
                </span>
                {shortcut && (
                  <kbd className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-sky-300">
                    {shortcut}
                  </kbd>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

registerDialog({ id: 'command-palette', component: CommandPaletteDialog });
