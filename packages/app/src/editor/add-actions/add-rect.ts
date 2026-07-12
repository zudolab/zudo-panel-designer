import { mintId, snapToGrid, type ShapeLayer } from '@zpd/core';
import { registerAddAction } from '../registry/add-actions';

registerAddAction({
  id: 'add-rect',
  label: 'Add rectangle',
  icon: '▭',
  run(ctx) {
    const layer: ShapeLayer = {
      id: mintId('shape'),
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: snapToGrid(ctx.panel.widthMm / 4),
      y: snapToGrid(ctx.panel.heightMm / 3),
      width: Math.min(20, snapToGrid(ctx.panel.widthMm / 2)),
      height: 16,
      color: 1,
    };
    ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
    ctx.select(layer.id);
  },
});
