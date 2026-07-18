// Built-in text tool (T). Click on the canvas to drop a new TextLayer at that
// point, then hand off to select so the freshly placed text is immediately
// draggable/resizable/editable — same "create, select, done" shape as
// add-rect.ts's toolbar action, just driven by a canvas click instead.
import { mintId, type TextLayer } from '@zpd/core';
import { registerTool } from '../registry/tools';
import { DEFAULT_FONT_FAMILY, ensureFont } from '../fonts';
import type { ToolContext, ToolPointerEvent } from '../types';

const DEFAULT_CONTENT = 'TEXT';
const DEFAULT_SIZE_MM = 6;

registerTool({
  id: 'text',
  label: 'Text',
  shortcut: 't',
  icon: 'T',
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
      color: 2, // white — the silkscreen layer this tool is meant for
    };
    ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
    ctx.setActiveTool('select');
    ctx.select(layer.id);
    // The renderer's canonical geometry owns readiness invalidation.
    void ensureFont(layer.fontFamily, layer.content);
  },
});
