// Cascade-clone a layer selection with fresh ids (copy/paste, alt-drag-group
// duplicate). REUSES cloneLayer for the deep-clone (path points/handles,
// pattern params) — this module only adds id minting + the cascade offset on
// top. offsetMm is mm (this is doc space; the reference app's paste offset is
// +20px in its px doc-space — see pgen's use-composer-clipboard.ts).
//
// Pattern layers are position-pinned backgrounds (there is exactly one per
// doc, tiling the panel) and must be EXCLUDED BY THE CALLER before calling
// this — passing one through is a no-op here (id is still refreshed, but a
// pattern layer has no x/y to offset).
import { cloneLayer } from './layer-ops';
import { translatePathLayer } from './path-geometry';
import type { Layer } from './types';

export interface CloneLayersWithFreshIdsOptions {
  makeId: (source: Layer) => string;
  offsetMm: number;
}

export function cloneLayersWithFreshIds(
  layers: readonly Layer[],
  { makeId, offsetMm }: CloneLayersWithFreshIdsOptions,
): Layer[] {
  return layers.map((layer) => {
    const clone = cloneLayer(layer, makeId(layer));
    switch (clone.type) {
      case 'shape':
      case 'text':
      case 'image':
        return { ...clone, x: clone.x + offsetMm, y: clone.y + offsetMm };
      case 'path':
        return { ...clone, ...translatePathLayer(clone, offsetMm, offsetMm) };
      case 'pattern':
        return clone;
    }
  });
}
