import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

export const concentricCircles: PanelPatternGenerator = {
  name: 'concentric-circles',
  displayName: 'Concentric Circles',
  paramDefs: [
    { key: 'pitch', label: 'Ring pitch (mm)', min: 1, max: 15, step: 0.5, defaultValue: 4 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 4, step: 0.05, defaultValue: 0.6 },
    { key: 'centerY', label: 'Center Y (0-1)', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * resolveParam(params, this.paramDefs, 'centerY');
    const cx = widthMm / 2;
    const maxR = Math.hypot(Math.max(cx, widthMm - cx), Math.max(cy, heightMm - cy));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let r = pitch; r <= maxR; r += pitch) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};
