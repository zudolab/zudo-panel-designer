import type { ImageLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { Field, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function ImageInspector({ layer, onChange }: InspectorProps<ImageLayer>) {
  return (
    <div className="flex flex-col gap-2">
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
      <p className="text-[11px] text-neutral-500">
        images are design-time sources — the manufactured panel is made only of vector layers
      </p>
    </div>
  );
}

registerInspector('image', ImageInspector);
