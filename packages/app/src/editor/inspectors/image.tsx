import type { ImageLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { getDialog } from '../registry/dialogs';
import { ActionButton, Field, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function ImageInspector({ layer, onChange, ctx }: InspectorProps<ImageLayer>) {
  // Wave 5 (#11) registers a dialog with id 'trace' for the image-to-vector
  // flow; until then this button is a disabled placeholder.
  const traceAvailable = getDialog('trace') !== undefined;
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
      <Field label="rotation (°)">
        <NumberField step={1} value={layer.rotation ?? 0} onCommit={(v) => onChange({ rotation: v })} />
      </Field>
      <ActionButton
        disabled={!traceAvailable}
        title={traceAvailable ? 'Convert to vector' : 'Image tracing coming in a later wave'}
        onClick={() => ctx.openDialog('trace', { layerId: layer.id })}
      >
        Convert to vector…
      </ActionButton>
      <p className="text-[11px] text-neutral-500">
        images are design-time sources — the manufactured panel is made only of vector layers
      </p>
    </div>
  );
}

registerInspector('image', ImageInspector);
