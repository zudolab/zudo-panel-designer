// Shared image-file -> ImageLayer plumbing (#69): FileReader -> dataURL,
// natural-size probe, scale-to-fit (max 80% width / 50% height of the
// panel), ONE commit, select the new layer. Extracted from add-actions/
// add-image.ts (behavior-identical) so the clipboard-paste and drop-import
// subs can share it instead of re-deriving the scale-to-fit math.
import { mintId, snapToGrid, withStackForSide, type ImageLayer } from '@zpd/core';
import { insertNewNodeRelativeToSelection } from './insert-relative';
import type { ToolContext } from './types';

// Shared by every raster-image entry point (#191): toolbar Add Image,
// clipboard raster paste, file drag/drop, the oversized-SVG fallback, and
// "import as image instead" from the SVG import dialog — all funnel through
// routeImportFile() (and svg-import.tsx's fallback) to this one function, so
// every one of them lands the new layer relative to the live selection.
const DEFAULT_ROLE = 'copper';

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
        const nextLayers = insertNewNodeRelativeToSelection(
          ctx.activeStack,
          ctx.selectedIds,
          layer,
          DEFAULT_ROLE,
        );
        if (nextLayers === ctx.activeStack) {
          resolve(); // refused: commit/select nothing (#191)
          return;
        }
        ctx.commit(withStackForSide(ctx.doc, ctx.activeSide, nextLayers));
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
