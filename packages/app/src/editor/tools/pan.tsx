// Built-in pan tool (H). Also reached transiently by holding Space in any tool
// (the shell swaps to this tool while Space is down). Drag state is module-local
// — one gesture at a time — which is the same pattern a Wave-5 tool uses for
// its own draft state.
import { panBy, type Camera } from '../camera';
import { registerTool } from '../registry/tools';
import type { ToolContext, ToolPointerEvent } from '../types';

let drag: { startX: number; startY: number; origCam: Camera } | null = null;

registerTool({
  id: 'pan',
  label: 'Pan',
  shortcut: 'h',
  icon: '✋',
  cursor: 'grab',
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    drag = { startX: e.screen.x, startY: e.screen.y, origCam: ctx.camera };
  },
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    // No button held means the drag already ended (e.g. Space released
    // mid-drag swaps tools without an onPointerUp/onDeactivate). End it cleanly
    // so the next move doesn't pan from a stale origin and jump the camera.
    if (!drag || e.buttons === 0) {
      drag = null;
      return;
    }
    ctx.setCamera(panBy(drag.origCam, e.screen.x - drag.startX, e.screen.y - drag.startY));
  },
  onPointerUp() {
    drag = null;
  },
  onDeactivate() {
    drag = null;
  },
});
