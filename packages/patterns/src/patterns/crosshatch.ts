import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

export const crosshatch: PanelPatternGenerator = {
  name: 'crosshatch',
  displayName: 'Crosshatch',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 4, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const diag = widthMm + heightMm;
    for (let offset = -diag; offset < diag * 2; offset += pitch) {
      ctx.beginPath();
      ctx.moveTo(offset, -1);
      ctx.lineTo(offset - heightMm - 2, heightMm + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset - heightMm - 2, -1);
      ctx.lineTo(offset, heightMm + 1);
      ctx.stroke();
    }
  },
};
