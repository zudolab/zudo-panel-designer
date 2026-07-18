// Shared image-file -> ImageLayer plumbing (#69): FileReader -> dataURL,
// natural-size probe, scale-to-fit (max 80% width / 50% height of the
// panel), ONE commit, select the new layer. Extracted from add-actions/
// add-image.ts (behavior-identical) so the clipboard-paste and drop-import
// subs can share it instead of re-deriving the scale-to-fit math.
import { mintId, snapToGrid, type ImageLayer } from '@zpd/core';
import type { ToolContext } from './types';

export function importImageFile(file: File, ctx: ToolContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const probe = new Image();
      probe.onload = () => {
        const maxW = ctx.panel.widthMm * 0.8;
        const maxH = ctx.panel.heightMm * 0.5;
        const scale = Math.min(maxW / probe.naturalWidth, maxH / probe.naturalHeight, 1);
        const layer: ImageLayer = {
          id: mintId('image'),
          name: file.name,
          type: 'image',
          src,
          x: snapToGrid(ctx.panel.widthMm * 0.1),
          y: snapToGrid(ctx.panel.heightMm * 0.15),
          width: snapToGrid(probe.naturalWidth * scale),
          height: snapToGrid(probe.naturalHeight * scale),
        };
        ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
        ctx.select(layer.id);
        resolve();
      };
      probe.onerror = () => reject(new Error(`could not decode image: ${file.name}`));
      probe.src = src;
    };
    reader.onerror = () => reject(reader.error ?? new Error(`could not read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
