import { mintId, pcbLayerDefinition, snapToGrid, withStackForSide, type ShapeLayer } from '@zpd/core';
import { Ellipse } from '../components/icons';
import { registerAddAction } from '../registry/add-actions';
import { insertNewNodeRelativeToSelection } from '../insert-relative';

const DEFAULT_ROLE = 'copper';

registerAddAction({
  id: 'add-ellipse',
  label: 'Add ellipse',
  icon: <Ellipse className="h-4 w-4" />,
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
      ctx.activeStack,
      ctx.selectedIds,
      layer,
      DEFAULT_ROLE,
    );
    if (nextLayers === ctx.activeStack) return; // refused: commit/select nothing (#191)
    ctx.commit(withStackForSide(ctx.doc, ctx.activeSide, nextLayers));
    ctx.select(layer.id);
  },
});
