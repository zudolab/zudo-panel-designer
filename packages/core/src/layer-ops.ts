// Layer list ops over a flat, bottom-to-top array. All functions return NEW
// arrays (immutable) so callers can diff/undo cheaply. Signatures take a
// caller-supplied id (rather than minting one) to stay pure — id generation
// is the document model's concern (#3's mintId).
import type { Layer, PathPoint } from './types';

export interface LayerListItem {
  id: string;
  name: string;
  hidden?: boolean;
}

export function addLayer<T extends LayerListItem>(layers: T[], layer: T, index?: number): T[] {
  const at = index === undefined ? layers.length : Math.max(0, Math.min(index, layers.length));
  return [...layers.slice(0, at), layer, ...layers.slice(at)];
}

export function removeLayer<T extends LayerListItem>(layers: T[], id: string): T[] {
  return layers.filter((l) => l.id !== id);
}

export function duplicateLayer<T extends LayerListItem>(
  layers: T[],
  id: string,
  newId: string,
  nameSuffix = ' copy',
): T[] {
  const index = layers.findIndex((l) => l.id === id);
  if (index === -1) return layers;
  const source = layers[index];
  const copy: T = { ...source, id: newId, name: `${source.name}${nameSuffix}` };
  return [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)];
}

export function reorderLayer<T extends LayerListItem>(layers: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= layers.length ||
    toIndex < 0 ||
    toIndex >= layers.length ||
    fromIndex === toIndex
  ) {
    return layers;
  }
  const next = [...layers];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function toggleLayerHidden<T extends LayerListItem>(layers: T[], id: string): T[] {
  return layers.map((l) => (l.id === id ? { ...l, hidden: !l.hidden } : l));
}

export function renameLayer<T extends LayerListItem>(layers: T[], id: string, name: string): T[] {
  return layers.map((l) => (l.id === id ? { ...l, name } : l));
}

function clonePoints(points: readonly PathPoint[]): PathPoint[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    ...(p.hin ? { hin: { ...p.hin } } : {}),
    ...(p.hout ? { hout: { ...p.hout } } : {}),
  }));
}

// Deep clone of one layer under a caller-supplied fresh id. A spread alone is
// NOT enough for path layers: points / bezier handles / extraSubpaths are
// nested objects, and a shallow copy would let a later node edit on the clone
// mutate the source (and vice versa). Same for a pattern's params record.
export function cloneLayer(layer: Layer, newId: string): Layer {
  switch (layer.type) {
    case 'path':
      return {
        ...layer,
        id: newId,
        points: clonePoints(layer.points),
        ...(layer.extraSubpaths ? { extraSubpaths: layer.extraSubpaths.map(clonePoints) } : {}),
      };
    case 'pattern':
      return { ...layer, id: newId, params: { ...layer.params } };
    default:
      return { ...layer, id: newId };
  }
}

export interface DuplicateAboveResult {
  layers: Layer[];
  // sourceId -> cloneId, so a caller can re-target something (e.g. an
  // in-flight drag, #49) at the clones.
  idMap: Map<string, string>;
}

// Alt-drag duplicate (#49): deep-clone each listed layer and insert the clone
// DIRECTLY ABOVE its source in the bottom-to-top flat list. Ids not present in
// `layers` are ignored. `makeId` keeps this pure — the caller brings mintId.
// Clones keep the source name unchanged (drag-duplicate convention); the
// explicit duplicateLayer action above is the one that appends " copy".
export function duplicateLayersAbove(
  layers: readonly Layer[],
  ids: readonly string[],
  makeId: (source: Layer) => string,
): DuplicateAboveResult {
  const wanted = new Set(ids);
  const next: Layer[] = [];
  const idMap = new Map<string, string>();
  for (const layer of layers) {
    next.push(layer);
    if (wanted.has(layer.id)) {
      const clone = cloneLayer(layer, makeId(layer));
      idMap.set(layer.id, clone.id);
      next.push(clone);
    }
  }
  return { layers: next, idMap };
}
