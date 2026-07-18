import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const brick: PanelPatternGenerator = {
  name: 'brick',
  displayName: 'Brick',
  paramDefs: [
    { key: 'brickW', label: 'Brick width (mm)', min: 3, max: 30, step: 0.5, defaultValue: 12 },
    { key: 'brickH', label: 'Brick height (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const bw = resolveParam(params, this.paramDefs, 'brickW');
    const bh = resolveParam(params, this.paramDefs, 'brickH');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    let row = 0;
    for (let y = centeredStart(heightMm, bh); y <= heightMm + bh; y += bh, row += 1) {
      // running-bond: alternate rows shift by half a brick
      const offset = row % 2 === 0 ? 0 : bw / 2;
      ctx.beginPath();
      ctx.moveTo(-1, y);
      ctx.lineTo(widthMm + 1, y);
      ctx.stroke();
      for (let x = centeredStart(widthMm, bw) + offset; x <= widthMm + bw; x += bw) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + bh);
        ctx.stroke();
      }
    }
  },
};
