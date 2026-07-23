import { pcbLayerDefinition, type PathLayer } from '@zpd/core';
import { registerInspector } from '../registry/inspectors';
import { Field, MaterialField, NumberField } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function PathInspector({ layer, materialRole, onChange }: InspectorProps<PathLayer>) {
  const materialColor = materialRole === null ? null : pcbLayerDefinition(materialRole).color;
  return (
    <div className="flex flex-col gap-2">
      <MaterialField role={materialRole} />
      <Field label="Fill enabled">
        <input
          type="checkbox"
          checked={layer.fill !== null}
          disabled={materialColor === null}
          onChange={(event) => onChange({ fill: event.target.checked ? materialColor : null })}
          className="accent-sky-400 disabled:opacity-40"
        />
      </Field>
      <Field label="Stroke enabled">
        <input
          type="checkbox"
          checked={layer.stroke !== null}
          disabled={materialColor === null}
          onChange={(event) => onChange({ stroke: event.target.checked ? materialColor : null })}
          className="accent-sky-400 disabled:opacity-40"
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
