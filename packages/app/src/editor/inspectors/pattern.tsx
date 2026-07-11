import type { PatternLayer } from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import { registerInspector } from '../registry/inspectors';
import { getDialog } from '../registry/dialogs';
import { ActionButton, ColorPicker, Field, Row } from '../components/inspector-ui';
import type { InspectorProps } from '../types';

function PatternInspector({ layer, onChange, ctx }: InspectorProps<PatternLayer>) {
  const gen = patternByName(layer.patternType);
  // Wave 5 (#12) registers a dialog with id 'pattern-picker' to swap the
  // pattern; until then this button just shows the current pattern, disabled.
  const pickerAvailable = getDialog('pattern-picker') !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <Row label="Pattern">
        <ActionButton
          disabled={!pickerAvailable}
          title={pickerAvailable ? 'Browse patterns' : 'Pattern picker coming in a later wave'}
          onClick={() => ctx.openDialog('pattern-picker', { layerId: layer.id })}
        >
          {gen?.displayName ?? layer.patternType} — Browse…
        </ActionButton>
      </Row>
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
