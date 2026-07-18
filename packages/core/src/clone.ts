// Cascade-clone a layer selection with fresh ids (copy/paste, alt-drag-group
// duplicate). REUSES cloneLayer for the deep-clone (path points/handles,
// pattern params) — this module only adds id minting + the cascade offset on
// top. offsetMm is mm (this is doc space; the reference app's paste offset is
// +20px in its px doc-space — see pgen's use-composer-clipboard.ts).
//
// Pattern layers clone like any other positioned object since #97: the
// cascade offset shifts the square's x/y (size untouched) so a pasted or
// duplicated pattern never lands exactly on top of its source.
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
      case 'pattern':
        return { ...clone, x: clone.x + offsetMm, y: clone.y + offsetMm };
      case 'path':
        return { ...clone, ...translatePathLayer(clone, offsetMm, offsetMm) };
    }
  });
}
