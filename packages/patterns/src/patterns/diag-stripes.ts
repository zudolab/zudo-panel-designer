import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

export const diagStripes: PanelPatternGenerator = {
  name: 'diag-stripes',
  displayName: 'Diagonal Stripes',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Stripe width (mm)', min: 0.3, max: 10, step: 0.1, defaultValue: 2 },
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
    }
  },
};
