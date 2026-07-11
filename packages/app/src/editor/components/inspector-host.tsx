// Host for the per-layer-type inspector registry. Looks up the inspector for
// the selected layer's type and feeds it a commit-aware onChange. When no
// inspector is registered for a type it degrades to a clear message rather than
// crashing — so a half-built wave still runs.
import { createElement } from 'react';
import type { DocState, Layer } from '@zpd/core';
import { getInspector } from '../registry/inspectors';
import type { ToolContext } from '../types';

export interface InspectorHostProps {
  ctx: ToolContext;
  layer: Layer | null;
}

export function InspectorHost({ ctx, layer }: InspectorHostProps) {
  if (!layer) {
    return <p className="text-xs text-neutral-500">Select a layer to edit its properties.</p>;
  }
  const inspector = getInspector(layer.type);
  if (!inspector) {
    return (
      <p className="text-xs text-neutral-500">
        No inspector registered for “{layer.type}”.
      </p>
    );
  }

  const onChange = (patch: Partial<Layer>, options?: { commit?: boolean }) => {
    const next: DocState = {
      ...ctx.doc,
      layers: ctx.doc.layers.map((l) => (l.id === layer.id ? ({ ...l, ...patch } as Layer) : l)),
    };
    if (options?.commit ?? true) ctx.commit(next);
    else ctx.replace(next);
  };

  // The component is resolved dynamically from the registry (stable per
  // registration); createElement keeps that out of the static-JSX analysis.
  return createElement(inspector, { layer, onChange, ctx });
}
