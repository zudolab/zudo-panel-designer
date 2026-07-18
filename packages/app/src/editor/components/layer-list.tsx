// Layer list — top of the stack first (visual top == last array index).
// Select / show-hide / reorder / rename / delete go through @zpd/core
// layer-ops so ordering + immutability semantics live in one place.
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  PALETTE,
  removeLayer,
  renameLayer,
  reorderLayer,
  toggleLayerHidden,
  type ColorIndex,
  type Layer,
} from '@zpd/core';
import { nextListSelection } from '../selection';
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
  selectedIds: readonly string[];
}

export function LayerList({ ctx, selectedIds }: LayerListProps) {
  const layers = ctx.doc.layers;
  const visibleLayers = [...layers].reverse();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const selectionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  // Shift-range anchor (#45). A ref, not state: it only steers the NEXT click
  // and must never trigger a re-render of its own.
  const anchorRef = useRef<string | null>(null);

  const currentFocusId = visibleLayers.some((layer) => layer.id === focusedLayerId)
    ? focusedLayerId
    : (visibleLayers.find((layer) => selectedIds.includes(layer.id))?.id ??
      visibleLayers[0]?.id ??
      null);

  const handleRowClick = (
    id: string,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    const next = nextListSelection(
      { selectedIds, anchorId: anchorRef.current },
      layers.map((l) => l.id),
      id,
      { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey },
    );
    anchorRef.current = next.anchorId;
    ctx.selectIds(next.selectedIds);
  };

  const move = (id: string, dir: 1 | -1) => {
    const from = layers.findIndex((l) => l.id === id);
    // reorderLayer returns the SAME array when the move is a no-op (already at
    // the top/bottom of the stack) — don't write a phantom undo entry for that.
    const next = reorderLayer(layers, from, from + dir);
    if (next !== layers) ctx.commit({ ...ctx.doc, layers: next });
  };
  const remove = (id: string) => {
    const renderedIndex = visibleLayers.findIndex((layer) => layer.id === id);
    const nextLayers = removeLayer(layers, id);
    const nextVisibleLayers = [...nextLayers].reverse();
    const nextFocusId =
      renderedIndex < 0
        ? currentFocusId
        : (nextVisibleLayers[Math.min(renderedIndex, nextVisibleLayers.length - 1)]?.id ?? null);

    ctx.commit({ ...ctx.doc, layers: nextLayers });
    setFocusedLayerId(nextFocusId);
    if (nextFocusId) selectionButtonRefs.current.get(nextFocusId)?.focus();
    // Multi-capable drop-from-selection (#44); for today's 0/1 selection this
    // is exactly the old `if (selectedId === id) ctx.select(null)`.
    if (selectedIds.includes(id)) ctx.selectIds(selectedIds.filter((x) => x !== id));
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

  const moveSelectionFocus = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Keep the editor's window-level shortcut handler from turning Space
      // into temporary pan mode. Do not preventDefault: the button's native
      // Enter/Space click must remain the selection activation path.
      event.stopPropagation();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();

    const index = visibleLayers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = Math.min(Math.max(index + offset, 0), visibleLayers.length - 1);
    const nextId = visibleLayers[nextIndex]?.id;
    if (!nextId) return;

    setFocusedLayerId(nextId);
    selectionButtonRefs.current.get(nextId)?.focus();
  };

  return (
    <ul className="flex flex-col gap-0.5">
      {visibleLayers.map((layer) => (
        <li
          key={layer.id}
          className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
            selectedIds.includes(layer.id)
              ? 'bg-sky-500/20 text-sky-100'
              : 'text-neutral-300 hover:bg-neutral-800'
          }`}
        >
          <button
            ref={(node) => {
              if (node) selectionButtonRefs.current.set(layer.id, node);
              else selectionButtonRefs.current.delete(layer.id);
            }}
            type="button"
            aria-label={`Select layer ${layer.name || layer.type}`}
            aria-pressed={selectedIds.includes(layer.id)}
            tabIndex={currentFocusId === layer.id ? 0 : -1}
            onFocus={() => setFocusedLayerId(layer.id)}
            onKeyDown={(event) => moveSelectionFocus(layer.id, event)}
            onClick={(event) => handleRowClick(layer.id, event)}
            className="flex shrink-0 items-center gap-1.5 rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
          >
            <span className="w-4 text-center" aria-hidden="true">
              {TYPE_ICON[layer.type]}
            </span>
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm border border-neutral-600"
              style={{ background: PALETTE[layerColorIndex(layer)].hex }}
            />
          </button>
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
              className="min-w-0 flex-1 select-text rounded border border-sky-500 bg-neutral-950 px-1 text-neutral-100"
            />
          ) : (
            <span
              onDoubleClick={() => {
                startRename(layer);
              }}
              title="Double-click to rename"
              className={`flex-1 truncate ${layer.hidden ? 'italic opacity-50' : ''}`}
            >
              {layer.name || layer.type}
            </span>
          )}
          <span className="flex items-center gap-0.5 text-neutral-400">
            <button
              title="Bring forward"
              onClick={(e) => {
                e.stopPropagation();
                move(layer.id, 1);
              }}
            >
              ▲
            </button>
            <button
              title="Send backward"
              onClick={(e) => {
                e.stopPropagation();
                move(layer.id, -1);
              }}
            >
              ▼
            </button>
            <button
              title="Show / hide"
              onClick={(e) => {
                e.stopPropagation();
                toggle(layer.id);
              }}
            >
              {layer.hidden ? '🚫' : '👁'}
            </button>
            <button
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                remove(layer.id);
              }}
            >
              ✕
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
