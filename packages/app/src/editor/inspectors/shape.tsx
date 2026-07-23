import type { ShapeLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { Field, MaterialField, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';
import { owningMaterialRole } from './material';

function ShapeInspector({ layer, onChange, ctx }: InspectorProps<ShapeLayer>) {
  const material = owningMaterialRole(ctx.doc.layers, layer.id);
  return (
    <div className="flex flex-col gap-2">
      <MaterialField role={material} />
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
        <NumberField
          step={1}
          value={layer.rotation ?? 0}
          onCommit={(v) => onChange({ rotation: v })}
        />
      </Field>
    </div>
  );
}

registerInspector('shape', ShapeInspector);
