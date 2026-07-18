import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const hexLattice: PanelPatternGenerator = {
  name: 'hex-lattice',
  displayName: 'Hex Lattice',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 2, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'cell') / 2;
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const w = Math.sqrt(3) * r; // flat-to-flat width of a pointy-top hexagon
    const vStep = 1.5 * r;
    let row = 0;
    for (let y = centeredStart(heightMm, vStep); y <= heightMm + vStep; y += vStep, row += 1) {
      const xOffset = row % 2 === 0 ? 0 : w / 2;
      for (let x = centeredStart(widthMm, w) + xOffset; x <= widthMm + w; x += w) {
        ctx.beginPath();
        for (let i = 0; i <= 6; i += 1) {
          const angle = (Math.PI / 3) * i + Math.PI / 6;
          const px = x + r * Math.cos(angle);
          const py = y + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
};
