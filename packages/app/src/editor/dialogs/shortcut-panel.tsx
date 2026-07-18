// Searchable, category-grouped keyboard-shortcuts overlay (issue #77):
// replaces the old hand-maintained dialogs/shortcuts.tsx static table. The
// command registry (commands.ts) is now the single source of truth — every
// row here is DERIVED from allCommands(), so a command's chord can never
// drift out of sync with what this panel shows. Opened by the `?` key (see
// commands.ts's 'help-shortcuts' entry) and the header's `?` button.
//
// Rendered through the dialog host (dialog-host.tsx supplies the backdrop,
// focus trap, initial focus, Escape-to-close) — this component supplies
// content only. Ported (downsized) from pgen's shared/shortcut-panel.tsx:
// dropped the D1-backed user-shortcut-override plumbing (zpd has no
// settings surface — remapping is explicitly out of scope for this sub).
import { useMemo, useState } from 'react';
import {
  allCommands,
  commandShortcutDisplay,
  commandsByCategory,
  type CommandDef,
} from '../commands';
import { isMac } from '../is-mac';
import { registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

// Only commands with an actual keyboard shortcut belong here — chordless,
// palette-only commands (Align, New Panel, zoom, …) are the command
// palette's job (see commands.ts's "Chordless (palette-only)" comments).
// `mac` is threaded through explicitly (rather than each call re-reading
// isMac()) so the filter and the rendered glyphs never disagree.
export function shortcuttableCommands(commands: readonly CommandDef[], mac: boolean): CommandDef[] {
  return commands.filter((cmd) => commandShortcutDisplay(cmd, mac) !== undefined);
}

export function filterShortcuts(commands: readonly CommandDef[], query: string): CommandDef[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...commands];
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(trimmed) || cmd.category.toLowerCase().includes(trimmed),
  );
}

function ShortcutPanelDialog({ close }: DialogProps) {
  const [query, setQuery] = useState('');
  const mac = useMemo(() => isMac(), []);

  const filtered = useMemo(
    () => filterShortcuts(shortcuttableCommands(allCommands(), mac), query),
    [mac, query],
  );
  const grouped = useMemo(() => commandsByCategory(filtered), [filtered]);

  return (
    <div className="flex max-h-[80vh] w-[min(30rem,92vw)] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-100">Keyboard shortcuts</h2>
        <button
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Close
        </button>
      </div>

      <label className="sr-only" htmlFor="shortcut-panel-search">
        Search shortcuts
      </label>
      <input
        id="shortcut-panel-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search shortcuts…"
        className="mb-3 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500"
      />

      <div className="flex-1 overflow-y-auto pr-1">
        {grouped.size === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">
            No shortcuts match &ldquo;{query}&rdquo;
          </p>
        ) : (
          Array.from(grouped.entries()).map(([category, cmds]) => (
            <div key={category} className="mb-3 last:mb-0">
              <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                {category}
              </h3>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-xs">
                {cmds.map((cmd) => (
                  <div key={cmd.id} className="contents">
                    <dt className="text-neutral-300">{cmd.label}</dt>
                    <dd className="justify-self-end font-mono text-sky-300">
                      {commandShortcutDisplay(cmd, mac)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

registerDialog({ id: 'shortcut-panel', component: ShortcutPanelDialog });
