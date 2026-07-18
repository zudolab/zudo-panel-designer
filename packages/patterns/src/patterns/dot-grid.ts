import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const dotGrid: PanelPatternGenerator = {
  name: 'dot-grid',
  displayName: 'Dot Grid',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'radius', label: 'Dot radius (mm)', min: 0.2, max: 4, step: 0.1, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const radius = resolveParam(params, this.paramDefs, 'radius');
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
