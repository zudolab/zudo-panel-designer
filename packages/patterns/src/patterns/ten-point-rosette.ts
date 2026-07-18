import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `ten-point-rosette`. A grid of ten-point star rosettes. pgen
// stacked concentric multi-color rings with alpha-darkened strokes; per the port
// rules that reduces to a single OUTLINED ten-point star per cell in one color
// (rings, hub and alpha passes dropped — the linework itself is the hierarchy).
// All stars share one stroke width, so they batch into a single path + stroke.
export const tenPointRosette: PanelPatternGenerator = {
  name: 'ten-point-rosette',
  displayName: 'Ten-Point Rosette',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 8, max: 24, step: 0.5, defaultValue: 9 },
    { key: 'pointDepth', label: 'Point depth', min: 0.3, max: 0.75, step: 0.01, defaultValue: 0.5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const pointDepth = resolveParam(params, this.paramDefs, 'pointDepth');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const outer = cell * 0.5;
    const inner = outer * pointDepth;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        for (let i = 0; i < 20; i++) {
          const r = i % 2 === 0 ? outer : inner;
          const a = (Math.PI * i) / 10 - Math.PI / 2;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  },
};
