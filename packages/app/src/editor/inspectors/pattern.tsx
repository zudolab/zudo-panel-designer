import { useRef } from 'react';
import { MAX_PATTERN_SIZE_MM, patternCoverGeometry, type PatternLayer } from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import type { PatternParamDef } from '@zpd/patterns';
import { registerInspector } from '../registry/inspectors';
import { getDialog } from '../registry/dialogs';
import { ActionButton, Field, MaterialField, NumberField, Row } from '../components/inspector-ui';
import type { InspectorProps, ToolContext } from '../types';

// Keep committed sizes inside the renderer's draw guard (renderer.ts only
// draws 0 < size <= MAX_PATTERN_SIZE_MM): an out-of-range inspector entry
// would make the square silently vanish instead of clamping the way the parse
// boundary (serialize.ts) does. 0.1 is the grid step — the smallest size the
// rest of the editor meaningfully distinguishes.
const MIN_PATTERN_SIZE_MM = 0.1;
const clampSize = (v: number) => Math.min(Math.max(v, MIN_PATTERN_SIZE_MM), MAX_PATTERN_SIZE_MM);

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

function PatternInspector({ layer, materialRole, onChange, ctx }: InspectorProps<PatternLayer>) {
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
      <MaterialField role={materialRole} />
      {/* Square geometry (#97) — NumberField commits are discrete edits, one
          undo entry each, matching the shape/image inspector conventions. */}
      <Field label="x (mm)">
        <NumberField value={layer.x} onCommit={(v) => onChange({ x: v })} />
      </Field>
      <Field label="y (mm)">
        <NumberField value={layer.y} onCommit={(v) => onChange({ y: v })} />
      </Field>
      <Field label="size (mm)">
        <NumberField
          value={layer.size}
          onCommit={(v) => {
            // Skip the commit when clamping lands on the CURRENT size (e.g.
            // typing 5000 while already at the max): NumberField's own
            // parsed !== value guard can't see through the clamp, and a no-op
            // commit would write a phantom undo entry and wipe any redo
            // branch (ctx.commit always discards redo — see history.ts).
            const size = clampSize(v);
            if (size !== layer.size) onChange({ size });
          }}
        />
      </Field>
      <ActionButton
        title="Recenter and resize the square to cover the whole panel"
        onClick={() => {
          // Same no-op guard: the default doc already has cover geometry, so
          // an unguarded click would phantom-commit and clear the redo stack.
          const cover = patternCoverGeometry(ctx.panel);
          if (cover.x !== layer.x || cover.y !== layer.y || cover.size !== layer.size) {
            onChange(cover);
          }
        }}
      >
        Cover panel
      </ActionButton>
      {gen?.paramDefs.map((def) => (
        <PatternParamSlider
          key={def.key}
          def={def}
          value={layer.params[def.key] ?? def.defaultValue}
          ctx={ctx}
          onScrub={(v) =>
            onChange({ params: { ...layer.params, [def.key]: v } }, { commit: false })
          }
        />
      ))}
    </div>
  );
}

registerInspector('pattern', PatternInspector);
