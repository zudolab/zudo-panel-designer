import type { ColorIndex, PathLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { ColorPicker, Field, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function PathInspector({ layer, onChange }: InspectorProps<PathLayer>) {
  return (
    <div className="flex flex-col gap-2">
      <Field label="Fill">
        <ColorPicker
          value={layer.fill}
          allowNone
          onPick={(c: ColorIndex | null) => onChange({ fill: c })}
        />
      </Field>
      <Field label="Stroke">
        <ColorPicker
          value={layer.stroke}
          allowNone
          onPick={(c: ColorIndex | null) => onChange({ stroke: c })}
        />
      </Field>
      <Field label="stroke w (mm)">
        <NumberField value={layer.strokeWidth} onCommit={(v) => onChange({ strokeWidth: v })} />
      </Field>
      <Field label="Closed">
        <input
          type="checkbox"
          checked={layer.closed}
          onChange={(e) => onChange({ closed: e.target.checked })}
          className="accent-sky-400"
        />
      </Field>
      <p className="text-[11px] text-neutral-500">
        drag anchors/handles on the canvas to edit nodes (Alt = break mirror)
      </p>
    </div>
  );
}

registerInspector('path', PathInspector);
