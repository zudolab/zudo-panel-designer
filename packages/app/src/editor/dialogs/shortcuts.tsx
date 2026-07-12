// Built-in help dialog — the concrete example of the dialog host. Opened from
// the header via ctx.openDialog('shortcuts'); a Wave-5 dialog (pattern picker,
// trace) is a NEW file in this folder registering the same way.
import { registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

const ROWS: [string, string][] = [
  ['V', 'Select tool'],
  ['H / Space-drag', 'Pan'],
  ['Z / Alt-Z-click', 'Zoom in / out'],
  ['Wheel', 'Zoom at pointer'],
  ['−  /  +  / Fit', 'Zoom out / in / fit panel'],
  ['⌘/Ctrl + Z', 'Undo'],
  ['⌘/Ctrl + Shift + Z', 'Redo'],
  ['Delete / Backspace', 'Delete selected layer'],
  ['Arrows (Shift = ×10)', 'Nudge selected layer'],
  ['Esc', 'Deselect'],
];

function ShortcutsDialog({ close }: DialogProps) {
  return (
    <div className="w-[min(28rem,90vw)]">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">Keyboard &amp; mouse</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {ROWS.map(([keys, desc]) => (
          <div key={keys} className="contents">
            <dt className="whitespace-nowrap font-mono text-sky-300">{keys}</dt>
            <dd className="text-neutral-300">{desc}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}

registerDialog({ id: 'shortcuts', component: ShortcutsDialog });
