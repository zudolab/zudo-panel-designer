// Layer list ops over a flat, bottom-to-top array. All functions return NEW
// arrays (immutable) so callers can diff/undo cheaply. Signatures take a
// caller-supplied id (rather than minting one) to stay pure — id generation
// is the document model's concern (#3's mintId).
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
