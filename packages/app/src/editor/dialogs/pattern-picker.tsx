// Wave-5 (#12) pattern picker — a grid of pattern thumbnails. Opened two ways:
//  - inspectors/pattern.tsx "Browse…" passes { layerId }: clicking a card
//    swaps that layer's patternType and resets its params to the new
//    pattern's defaults.
//  - add-actions/add-pattern.ts "Add pattern…" opens with no props: clicking
//    a card adds a brand-new pattern layer on top and selects it.
// Either path is a single commit() — one undo entry — then closes.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { mintId, type PatternLayer } from '@zpd/core';
import {
  defaultParams,
  PATTERN_GENERATORS,
  renderPatternThumb,
  type PanelPatternGenerator,
} from '@zpd/patterns';
import { registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

export interface PatternPickerProps {
  layerId?: string;
}

// CSS px per thumbnail; renderPatternThumb scales the backing store for the
// device's devicePixelRatio internally.
export const THUMBNAIL_SIZE_PX = 96;

function PatternCard({ gen, onPick }: { gen: PanelPatternGenerator; onPick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // useLayoutEffect (not useEffect) so the thumbnail is sized+drawn before the
  // browser's first paint — otherwise the canvas shows its default 300x150 box
  // for one frame and the grid visibly jumps. The inline style width/height
  // pins the CSS box to its final size even before this runs.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPatternThumb(canvas, gen, THUMBNAIL_SIZE_PX);
  }, [gen]);

  return (
    <button
      type="button"
      onClick={onPick}
      title={gen.displayName}
      className="flex flex-col items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 p-2 hover:border-sky-400 hover:bg-neutral-700"
    >
      <canvas
        ref={canvasRef}
        className="rounded"
        style={{ width: THUMBNAIL_SIZE_PX, height: THUMBNAIL_SIZE_PX }}
      />
      <span className="w-full truncate text-center text-[11px] text-neutral-300">
        {gen.displayName}
      </span>
    </button>
  );
}

function PatternPickerDialog({ props, close, ctx }: DialogProps<PatternPickerProps>) {
  // Esc closes (the dialog host only wires backdrop-click); focus returns to
  // whatever invoked the dialog (the "Browse…" or "Add pattern…" button).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [close]);

  function handlePick(gen: PanelPatternGenerator): void {
    if (props.layerId) {
      const layerId = props.layerId;
      const nextLayers = ctx.doc.layers.map((l) =>
        l.id === layerId && l.type === 'pattern'
          ? { ...l, patternType: gen.name, params: defaultParams(gen.name) }
          : l,
      );
      ctx.commit({ ...ctx.doc, layers: nextLayers });
    } else {
      const layer: PatternLayer = {
        id: mintId('pattern'),
        name: gen.displayName,
        type: 'pattern',
        patternType: gen.name,
        color: 1,
        params: defaultParams(gen.name),
      };
      ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
      ctx.select(layer.id);
    }
    close();
  }

  return (
    <div className="w-[min(640px,92vw)]">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">Choose a pattern</h2>
      <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3 overflow-y-auto pr-1">
        {PATTERN_GENERATORS.map((gen) => (
          <PatternCard key={gen.name} gen={gen} onPick={() => handlePick(gen)} />
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}

registerDialog<PatternPickerProps>({ id: 'pattern-picker', component: PatternPickerDialog });
