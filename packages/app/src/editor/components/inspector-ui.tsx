// Small shared building blocks for the built-in inspectors. Kept OUTSIDE the
// globbed inspectors/ folder so it is never mistaken for a registering module.
import { PALETTE, type ColorIndex } from '@zpd/core';
import type { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-400">{label}</span>
      <span className="flex-1 max-w-[60%]">{children}</span>
    </label>
  );
}

export function NumberField({
  value,
  step = 0.1,
  onCommit,
}: {
  value: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onCommit(Number(e.target.value))}
      className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-right text-neutral-100"
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
