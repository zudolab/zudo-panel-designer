import type { PatternLayer } from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import { registerInspector } from '../registry/inspectors';
import { ColorPicker, Field } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function PatternInspector({ layer, onChange }: InspectorProps<PatternLayer>) {
  const gen = patternByName(layer.patternType);
  return (
    <div className="flex flex-col gap-2">
      <Field label="Pattern">
        <span className="text-neutral-200">{gen?.displayName ?? layer.patternType}</span>
      </Field>
      <Field label="Color">
        <ColorPicker value={layer.color} onPick={(c) => c !== null && onChange({ color: c })} />
      </Field>
      {gen?.paramDefs.map((def) => (
        <label key={def.key} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-neutral-400">{def.label}</span>
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={layer.params[def.key] ?? def.defaultValue}
            onChange={(e) =>
              onChange({ params: { ...layer.params, [def.key]: Number(e.target.value) } })
            }
            className="max-w-[60%] flex-1 accent-sky-400"
          />
        </label>
      ))}
    </div>
  );
}

registerInspector('pattern', PatternInspector);
