// Host for the per-layer-type inspector registry. Looks up the inspector for
// the selected layer's type and feeds it a commit-aware onChange. When no
// inspector is registered for a type it degrades to a clear message rather than
// crashing — so a half-built wave still runs.
import { createElement } from 'react';
import { updatePcbNodeById, type DocState, type Layer } from '@zpd/core';
import { getInspector } from '../registry/inspectors';
import type { ToolContext } from '../types';

export interface InspectorHostProps {
  ctx: ToolContext;
  layer: Layer | null;
  // The full selection (#45). `layer` is non-null only at exactly one selected;
  // this disambiguates "nothing selected" from "many selected".
  selectedIds: readonly string[];
}

export function InspectorHost({ ctx, layer, selectedIds }: InspectorHostProps) {
  // Multi-selection has no single-layer inspector yet — a plain count message.
  if (selectedIds.length > 1) {
    return <p className="text-xs text-neutral-500">{selectedIds.length} layers selected</p>;
  }
  if (!layer) {
    return <p className="text-xs text-neutral-500">Select a layer to edit its properties.</p>;
  }
  const inspector = getInspector(layer.type);
  if (!inspector) {
    return <p className="text-xs text-neutral-500">No inspector registered for “{layer.type}”.</p>;
  }

  const onChange = (patch: Partial<Layer>, options?: { commit?: boolean }) => {
    const next: DocState = {
      ...ctx.doc,
      // Recursive material-aware write (#150, #166): the inspected leaf may
      // sit inside a group, and compatibility paint must be normalized back to
      // its owning fixed container after every patch.
      layers: updatePcbNodeById(
        ctx.doc.layers,
        layer.id,
        (node) => ({ ...node, ...patch }) as Layer,
      ),
    };
    if (options?.commit ?? true) ctx.commit(next);
    else ctx.replace(next);
  };

  // The component is resolved dynamically from the registry (stable per
  // registration); createElement keeps that out of the static-JSX analysis.
  return createElement(inspector, { layer, onChange, ctx });
}
