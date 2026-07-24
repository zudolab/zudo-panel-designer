import { mintId, pcbLayerDefinition, snapToGrid, type ShapeLayer } from '@zpd/core';
import { registerAddAction } from '../registry/add-actions';
import { insertNewNodeRelativeToSelection } from '../insert-relative';

const DEFAULT_ROLE = 'copper';

registerAddAction({
  id: 'add-ellipse',
  label: 'Add ellipse',
  icon: '◯',
  run(ctx) {
    const layer: ShapeLayer = {
      id: mintId('shape'),
      name: 'Ellipse',
      type: 'shape',
      shape: 'ellipse',
      x: snapToGrid(ctx.panel.widthMm / 4),
      y: snapToGrid(ctx.panel.heightMm / 3),
      width: Math.min(20, snapToGrid(ctx.panel.widthMm / 2)),
      height: 16,
      // Placeholder only -- normalizeLayerNodeMaterial (@zpd/core) always
      // overwrites this to match wherever the node actually lands (#191:
      // that destination now follows the selection, not always DEFAULT_ROLE).
      color: pcbLayerDefinition(DEFAULT_ROLE).color,
    };
    const nextLayers = insertNewNodeRelativeToSelection(
      ctx.doc.layers,
      ctx.selectedIds,
      layer,
      DEFAULT_ROLE,
    );
    if (nextLayers === ctx.doc.layers) return; // refused: commit/select nothing (#191)
    ctx.commit({ ...ctx.doc, layers: nextLayers });
    ctx.select(layer.id);
  },
});
