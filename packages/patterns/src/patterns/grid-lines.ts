import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const gridLines: PanelPatternGenerator = {
  name: 'grid-lines',
  displayName: 'Grid Lines',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
      ctx.beginPath();
      ctx.moveTo(x, -1);
      ctx.lineTo(x, heightMm + 1);
      ctx.stroke();
    }
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      ctx.beginPath();
      ctx.moveTo(-1, y);
      ctx.lineTo(widthMm + 1, y);
      ctx.stroke();
    }
  },
};
