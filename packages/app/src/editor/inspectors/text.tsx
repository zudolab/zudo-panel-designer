import type { TextLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { ColorPicker, Field, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function TextInspector({ layer, onChange }: InspectorProps<TextLayer>) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-400">Text</span>
        <textarea
          rows={2}
          value={layer.content}
          onChange={(e) => onChange({ content: e.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
        />
      </label>
      <Field label="Color">
        <ColorPicker value={layer.color} onPick={(c) => c !== null && onChange({ color: c })} />
      </Field>
      <Field label="size (mm)">
        <NumberField value={layer.sizeMm} onCommit={(v) => onChange({ sizeMm: v })} />
      </Field>
      <Field label="x (mm)">
        <NumberField value={layer.x} onCommit={(v) => onChange({ x: v })} />
      </Field>
      <Field label="y (mm)">
        <NumberField value={layer.y} onCommit={(v) => onChange({ y: v })} />
      </Field>
      <Field label="rotation (°)">
        <NumberField step={1} value={layer.rotation ?? 0} onCommit={(v) => onChange({ rotation: v })} />
      </Field>
    </div>
  );
}

registerInspector('text', TextInspector);
