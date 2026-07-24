// Small shared building blocks for the built-in inspectors. Kept OUTSIDE the
// globbed inspectors/ folder so it is never mistaken for a registering module.
import { PALETTE, pcbLayerDefinition, type ColorIndex, type PcbLayerRole } from '@zpd/core';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-400">{label}</span>
      <span className="flex-1 max-w-[60%]">{children}</span>
    </label>
  );
}

// Same layout as Field but a <div> instead of a <label> — use this when the
// row's control is a <button> (e.g. an "open a dialog" action) rather than a
// form field. A <label> implicitly renames a wrapped button to the label
// text in the accessibility tree, which stomps the button's own name.
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-400">{label}</span>
      <span className="flex-1 max-w-[60%]">{children}</span>
    </div>
  );
}

// Fixed-container membership is the material control. Inspectors expose that
// fact as context, never as an object-level palette picker.
export function MaterialField({ role }: { role: PcbLayerRole | null }) {
  if (!role) {
    return (
      <Row label="Material">
        <span className="text-neutral-500">Unassigned</span>
      </Row>
    );
  }
  const definition = pcbLayerDefinition(role);
  const palette = PALETTE[definition.color];
  return (
    <>
      <Row label="Material">
        <span className="flex items-center gap-1.5 text-neutral-300">
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full border border-neutral-600"
            style={{ background: palette.hex }}
          />
          {definition.name}
        </span>
      </Row>
      {/* Solder mask is negative: this object doesn't paint mask, it OPENS
          one, revealing copper (or bare substrate) beneath. */}
      {role === 'solder-mask' && (
        <p className="text-[10px] leading-snug text-neutral-500">
          Objects on this layer open the mask, revealing copper — or bare substrate where there's
          no copper — beneath.
        </p>
      )}
    </>
  );
}

// A numeric field that commits ONE undo entry per discrete edit. While focused
// it holds a local draft string, so typing "250" or clearing-and-retyping never
// snaps to 0 or streams a commit per keystroke. It commits once on blur and on
// Enter; a cleared/NaN draft reverts to the last valid prop value instead of
// committing 0. Arrow-up/down step discretely (one commit per press). When the
// incoming value prop changes (undo/redo, a canvas drag) while not editing, the
// draft re-syncs to it.
export function NumberField({
  value,
  step = 0.1,
  onCommit,
}: {
  value: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Sync the draft to an incoming value change (undo/redo, a canvas drag, a
  // sibling edit) while the field isn't being actively edited. This is the
  // render-time "adjust state when a prop changes" pattern React recommends over
  // a setState-in-effect (https://react.dev/learn/you-might-not-need-an-effect).
  if (!editing && value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commitDraft = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setDraft(String(value)); // empty/NaN reverts to the last valid value — never commits 0
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  // Round to the step's decimal precision so a 0.1 step gives 6.1, not
  // 6.300000000000001, and an integer step stays integral.
  const stepBy = (dir: 1 | -1, raw: string) => {
    const base = Number(raw);
    const start = Number.isNaN(base) ? value : base;
    const decimals = (String(step).split('.')[1] ?? '').length;
    const next = Number((start + dir * step).toFixed(decimals));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      step={step}
      value={draft}
      onFocus={() => {
        setEditing(true);
        setDraft(String(value));
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        setEditing(false);
        commitDraft(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft(e.currentTarget.value);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); // own the step so it's one discrete commit, not per-frame
          stepBy(e.key === 'ArrowUp' ? 1 : -1, e.currentTarget.value);
        }
      }}
      className="w-full select-text rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-right text-neutral-100"
    />
  );
}

// Full-width action button for an inspector's "open a dialog" affordance
// (e.g. pattern Browse…, image Convert to vector…). disabled gets its own
// dimmed style since these fire before their target dialog exists yet.
export function ActionButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`w-full truncate rounded border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-left text-neutral-200 hover:bg-neutral-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-neutral-800 ${className}`}
    />
  );
}

export function ColorPicker({
  value,
  allowNone = false,
  onPick,
}: {
  value: ColorIndex | null;
  allowNone?: boolean;
  onPick: (c: ColorIndex | null) => void;
}) {
  return (
    <span className="flex gap-1">
      {PALETTE.map((entry) => (
        <button
          key={entry.name}
          type="button"
          title={`${entry.name} — ${entry.note}`}
          onClick={() => onPick(entry.index)}
          className={`h-5 w-5 rounded border ${
            value === entry.index ? 'border-sky-400 ring-1 ring-sky-400' : 'border-neutral-600'
          }`}
          style={{ background: entry.hex }}
        />
      ))}
      {allowNone && (
        <button
          type="button"
          title="none"
          onClick={() => onPick(null)}
          className={`grid h-5 w-5 place-items-center rounded border text-[10px] text-neutral-300 ${
            value === null ? 'border-sky-400 ring-1 ring-sky-400' : 'border-neutral-600'
          }`}
        >
          ∅
        </button>
      )}
    </span>
  );
}
