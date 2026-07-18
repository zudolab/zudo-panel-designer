import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart, hash01 } from '../param-utils';

// Ported from pgen `smith-truchet` (see .claude/skills/port-pgen-patterns/).
// Two quarter-circle arcs per square tile in one of two orientations, joining
// into meandering loops. The source's per-tile rand() became hash01 on
// panel-center-origin cell indices (stable under panel resize); dropped: bg
// fill, px-relative line width (now a mm param).
export const smithTruchet: PanelPatternGenerator = {
  name: 'smith-truchet',
  displayName: 'Smith Truchet',
  paramDefs: [
    { key: 'tile', label: 'Tile size (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const tile = resolveParam(params, this.paramDefs, 'tile');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    const r = tile / 2;
    for (let y = centeredStart(heightMm, tile); y <= heightMm + tile; y += tile) {
      const iy = Math.round((y - heightMm / 2) / tile);
      for (let x = centeredStart(widthMm, tile); x <= widthMm + tile; x += tile) {
        const ix = Math.round((x - widthMm / 2) / tile);
        if (hash01(ix, iy) < 0.5) {
          // arcs join top-left and bottom-right corners
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + tile, y + tile, r, Math.PI, Math.PI * 1.5);
          ctx.stroke();
        } else {
          // arcs join top-right and bottom-left corners
          ctx.beginPath();
          ctx.arc(x + tile, y, r, Math.PI / 2, Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y + tile, r, Math.PI * 1.5, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  },
};
