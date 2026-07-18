import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart, hash01 } from '../param-utils';

// Ported from pgen `truchet-quarter-arc`. Each square tile carries two
// quarter-disc lens fills centred on opposite corners; orientation joins the
// lenses across edges into continuous ribbons. The source's per-tile rand()
// orientation became hash01 on panel-centre cell indices (stable under resize).
// Dropped, per the no-bg-paint rule: the background field fill and the
// outline/darken pass — the unpainted tile area is real negative space showing
// the layers below. Lens fills in the one fg colour.
export const truchetQuarterArc: PanelPatternGenerator = {
  name: 'truchet-quarter-arc',
  displayName: 'Truchet Quarter Arc',
  paramDefs: [
    { key: 'tile', label: 'Tile size (mm)', min: 5, max: 20, step: 0.5, defaultValue: 8 },
    // Gap between tiles (mm) — trims each lens pair inward, opening negative
    // space between ribbons without painting any background.
    { key: 'gap', label: 'Tile gap (mm)', min: 0, max: 4, step: 0.1, defaultValue: 0 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const tile = resolveParam(params, this.paramDefs, 'tile');
    const gap = Math.min(resolveParam(params, this.paramDefs, 'gap'), tile * 0.9);
    const size = tile - gap;
    const r = size / 2;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, tile); y <= heightMm + tile; y += tile) {
      const iy = Math.round((y - heightMm / 2) / tile);
      for (let x = centeredStart(widthMm, tile); x <= widthMm + tile; x += tile) {
        const ix = Math.round((x - widthMm / 2) / tile);
        const gx = x + gap / 2;
        const gy = y + gap / 2;
        if (hash01(ix, iy) < 0.5) {
          // quarter discs on the top-left and bottom-right corners
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.arc(gx, gy, r, 0, Math.PI / 2);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(gx + size, gy + size);
          ctx.arc(gx + size, gy + size, r, Math.PI, Math.PI * 1.5);
          ctx.closePath();
          ctx.fill();
        } else {
          // quarter discs on the top-right and bottom-left corners
          ctx.beginPath();
          ctx.moveTo(gx + size, gy);
          ctx.arc(gx + size, gy, r, Math.PI / 2, Math.PI);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(gx, gy + size);
          ctx.arc(gx, gy + size, r, Math.PI * 1.5, Math.PI * 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  },
};
