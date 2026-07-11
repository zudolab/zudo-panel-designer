// Built-in zoom tool (Z). Click = zoom in anchored at the click point,
// Alt-click = zoom out. Anchoring is entirely camera.zoomAt's job.
import { zoomAt } from '../camera';
import { registerTool } from '../registry/tools';
import type { ToolContext, ToolPointerEvent } from '../types';

const ZOOM_IN = 1.5;
const ZOOM_OUT = 1 / 1.5;

registerTool({
  id: 'zoom',
  label: 'Zoom',
  shortcut: 'z',
  icon: '🔍',
  cursor: 'zoom-in',
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    ctx.setCamera(zoomAt(ctx.camera, e.screen, e.altKey ? ZOOM_OUT : ZOOM_IN));
  },
});
