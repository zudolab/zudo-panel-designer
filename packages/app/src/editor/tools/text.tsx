// Built-in text tool (T). Click on the canvas to drop a new TextLayer at that
// point, then hand off to select so the freshly placed text is immediately
// draggable/resizable/editable — same "create, select, done" shape as
// add-rect.ts's toolbar action, just driven by a canvas click instead.
import { mintId, pcbLayerDefinition, type TextLayer } from '@zpd/core';
import { registerTool } from '../registry/tools';
import { Text } from '../components/icons';
import { DEFAULT_FONT_FAMILY, ensureFont } from '../fonts';
import { insertNewNodeRelativeToSelection } from '../insert-relative';
import type { ToolContext, ToolPointerEvent } from '../types';

const DEFAULT_CONTENT = 'TEXT';
const DEFAULT_SIZE_MM = 6;
const DEFAULT_ROLE = 'silkscreen';

registerTool({
  id: 'text',
  label: 'Text',
  shortcut: 't',
  icon: <Text className="h-4 w-4" />,
  cursor: 'text',
  description:
    'Click anywhere on the canvas to place a new text layer at that point, then hand off to the ' +
    'Select tool so it can be repositioned and styled right away. Shortcut: T.',
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    const layer: TextLayer = {
      id: mintId('text'),
      name: 'Text',
      type: 'text',
      content: DEFAULT_CONTENT,
      fontFamily: DEFAULT_FONT_FAMILY,
      sizeMm: DEFAULT_SIZE_MM,
      x: e.mm.x,
      y: e.mm.y,
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
    ctx.setActiveTool('select');
    ctx.select(layer.id);
    // The renderer's canonical geometry owns readiness invalidation.
    void ensureFont(layer.fontFamily, layer.content);
  },
});
