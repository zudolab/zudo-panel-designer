import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const scallops: PanelPatternGenerator = {
  name: 'scallops',
  displayName: 'Scallops',
  paramDefs: [
    { key: 'width', label: 'Scallop width (mm)', min: 3, max: 30, step: 0.5, defaultValue: 10 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const scallopW = resolveParam(params, this.paramDefs, 'width');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const r = scallopW / 2;
    const rowStep = r; // rows nest at half the arc span like fish scales
    let row = 0;
    for (let y = centeredStart(heightMm, rowStep); y <= heightMm + rowStep; y += rowStep, row += 1) {
      const offset = row % 2 === 0 ? 0 : r;
      for (let x = centeredStart(widthMm, scallopW) + offset; x <= widthMm + scallopW; x += scallopW) {
        ctx.beginPath();
        ctx.arc(x + r, y, r, 0, Math.PI); // lower semicircle
        ctx.stroke();
      }
    }
  },
};
