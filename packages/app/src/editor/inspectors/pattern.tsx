import { useRef } from 'react';
import type { PatternLayer } from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import type { PatternParamDef } from '@zpd/patterns';
import { registerInspector } from '../registry/inspectors';
import { getDialog } from '../registry/dialogs';
import { ActionButton, ColorPicker, Field, Row } from '../components/inspector-ui';
import type { InspectorProps, ToolContext } from '../types';

// One slider = one undo entry per scrub. The gesture opens LAZILY on the first
// value change (ctx.beginGesture snapshots the pre-scrub state as a single undo
// entry), every intermediate input streams as a coalesced replace (commit:false
// → ctx.replace, live preview), and the pointer/key release just closes the
// gesture so the next scrub opens a fresh entry. No trailing commit — that would
// double the undo entry on top of the one beginGesture already opened.
function PatternParamSlider({
  def,
  value,
  ctx,
  onScrub,
}: {
  def: PatternParamDef;
  value: number;
  ctx: ToolContext;
  onScrub: (v: number) => void;
}) {
  const scrubbing = useRef(false);
  const endScrub = () => {
    scrubbing.current = false;
  };
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-400">{def.label}</span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => {
          if (!scrubbing.current) {
            scrubbing.current = true;
            ctx.beginGesture();
          }
          onScrub(Number(e.target.value));
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onKeyUp={endScrub}
        onBlur={endScrub}
        className="max-w-[60%] flex-1 accent-sky-400"
      />
    </label>
  );
}

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
        <PatternParamSlider
          key={def.key}
          def={def}
          value={layer.params[def.key] ?? def.defaultValue}
          ctx={ctx}
          onScrub={(v) => onChange({ params: { ...layer.params, [def.key]: v } }, { commit: false })}
        />
      ))}
    </div>
  );
}

registerInspector('pattern', PatternInspector);
