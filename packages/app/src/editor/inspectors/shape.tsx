import type { ShapeLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { ColorPicker, Field, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function ShapeInspector({ layer, onChange }: InspectorProps<ShapeLayer>) {
  return (
    <div className="flex flex-col gap-2">
      <Field label="Color">
        <ColorPicker value={layer.color} onPick={(c) => c !== null && onChange({ color: c })} />
      </Field>
      <Field label="x (mm)">
        <NumberField value={layer.x} onCommit={(v) => onChange({ x: v })} />
      </Field>
      <Field label="y (mm)">
        <NumberField value={layer.y} onCommit={(v) => onChange({ y: v })} />
      </Field>
      <Field label="width (mm)">
        <NumberField value={layer.width} onCommit={(v) => onChange({ width: v })} />
      </Field>
      <Field label="height (mm)">
        <NumberField value={layer.height} onCommit={(v) => onChange({ height: v })} />
      </Field>
      <Field label="rotation (°)">
        <NumberField step={1} value={layer.rotation ?? 0} onCommit={(v) => onChange({ rotation: v })} />
      </Field>
    </div>
  );
}

registerInspector('shape', ShapeInspector);
