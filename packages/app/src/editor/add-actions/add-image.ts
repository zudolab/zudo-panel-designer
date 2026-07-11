// Adds a design-time reference image (raster) via a transient file picker. The
// Editor's asset-loading effect is what actually decodes/caches the <img> from
// the layer's src, so this handler only needs to append the layer.
import { mintId, snapToGrid, type ImageLayer } from '@zpd/core';
import { registerAddAction } from '../registry/add-actions';
import type { ToolContext } from '../types';

function addImageFromFile(ctx: ToolContext, file: File): void {
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
    };
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

registerAddAction({
  id: 'add-image',
  label: 'Add image…',
  icon: '🖼',
  run(ctx) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) addImageFromFile(ctx, file);
    });
    input.click();
  },
});
