import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

export const radialBurst: PanelPatternGenerator = {
  name: 'radial-burst',
  displayName: 'Radial Burst',
  paramDefs: [
    { key: 'count', label: 'Ray count', min: 8, max: 96, step: 2, defaultValue: 36 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
    { key: 'centerY', label: 'Center Y (0-1)', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
    { key: 'innerRadius', label: 'Inner radius (mm)', min: 0, max: 30, step: 0.5, defaultValue: 4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const count = Math.round(resolveParam(params, this.paramDefs, 'count'));
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * resolveParam(params, this.paramDefs, 'centerY');
    const inner = resolveParam(params, this.paramDefs, 'innerRadius');
    const cx = widthMm / 2;
    const maxR = Math.hypot(widthMm, heightMm);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      ctx.beginPath();
      ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
      ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
      ctx.stroke();
    }
  },
};
