// Layer list — top of the stack first (visual top == last array index).
// Select / show-hide / reorder / rename / delete go through @zpd/core
// layer-ops so ordering + immutability semantics live in one place.
import { useState } from 'react';
import {
  PALETTE,
  removeLayer,
  renameLayer,
  reorderLayer,
  toggleLayerHidden,
  type ColorIndex,
  type Layer,
} from '@zpd/core';
import type { ToolContext } from '../types';

const TYPE_ICON: Record<Layer['type'], string> = {
  shape: '▭',
  pattern: '▦',
  path: '✒',
  text: 'T',
  image: '🖼',
};

function layerColorIndex(layer: Layer): ColorIndex {
  if (layer.type === 'path') return layer.fill ?? layer.stroke ?? 1;
  if (layer.type === 'image') return 0;
  return layer.color;
}

export interface LayerListProps {
  ctx: ToolContext;
  selectedId: string | null;
}

export function LayerList({ ctx, selectedId }: LayerListProps) {
  const layers = ctx.doc.layers;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const move = (id: string, dir: 1 | -1) => {
    const from = layers.findIndex((l) => l.id === id);
    // reorderLayer returns the SAME array when the move is a no-op (already at
    // the top/bottom of the stack) — don't write a phantom undo entry for that.
    const next = reorderLayer(layers, from, from + dir);
    if (next !== layers) ctx.commit({ ...ctx.doc, layers: next });
  };
  const remove = (id: string) => {
    ctx.commit({ ...ctx.doc, layers: removeLayer(layers, id) });
    if (selectedId === id) ctx.select(null);
  };
  const toggle = (id: string) => {
    ctx.commit({ ...ctx.doc, layers: toggleLayerHidden(layers, id) });
  };
  const startRename = (layer: Layer) => {
    setRenamingId(layer.id);
    setDraftName(layer.name);
  };
  // Enter is the only path that calls ctx.commit — Escape/blur both just
  // close the editor, so a blur racing an Escape-driven unmount can never
  // fire a second (stale) commit.
  const commitRename = (id: string) => {
    // An empty name is a valid stored value — the row display already falls
    // back to layer.type (see the span below), same as the initial data.
    ctx.commit({ ...ctx.doc, layers: renameLayer(layers, id, draftName.trim()) });
    setRenamingId(null);
  };

  return (
    <ul className="flex flex-col gap-0.5">
      {[...layers].reverse().map((layer) => (
        <li
          key={layer.id}
          onClick={() => ctx.select(layer.id)}
          className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
            layer.id === selectedId ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800'
          }`}
        >
          <span className="w-4 text-center">{TYPE_ICON[layer.type]}</span>
          <span
            className="h-3 w-3 rounded-sm border border-neutral-600"
            style={{ background: PALETTE[layerColorIndex(layer)].hex }}
          />
          {renamingId === layer.id ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setRenamingId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename(layer.id);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenamingId(null);
                }
              }}
              className="min-w-0 flex-1 rounded border border-sky-500 bg-neutral-950 px-1 text-neutral-100"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(layer);
              }}
              title="Double-click to rename"
              className={`flex-1 truncate ${layer.hidden ? 'italic opacity-50' : ''}`}
            >
              {layer.name || layer.type}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-neutral-400">
            <button title="Bring forward" onClick={(e) => { e.stopPropagation(); move(layer.id, 1); }}>
              ▲
            </button>
            <button title="Send backward" onClick={(e) => { e.stopPropagation(); move(layer.id, -1); }}>
              ▼
            </button>
            <button title="Show / hide" onClick={(e) => { e.stopPropagation(); toggle(layer.id); }}>
              {layer.hidden ? '🚫' : '👁'}
            </button>
            <button title="Delete" onClick={(e) => { e.stopPropagation(); remove(layer.id); }}>
              ✕
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
