import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `wachigai` (linked-rings crest). Rows of equal circles
// overlapping neighbours into a chain-mail of interlocked loops; alternate rows
// are brick-offset so each ring threads four diagonal partners. Dropped from
// the source: bg fill, fg-pool colour cycling (colorOffset), and the no-op
// rand() wobble (it only kept the pgen PRNG in step — meaningless here).
export const wachigai: PanelPatternGenerator = {
  name: 'wachigai',
  displayName: 'Wachigai',
  paramDefs: [
    { key: 'radius', label: 'Ring radius (mm)', min: 4, max: 16, step: 0.5, defaultValue: 6 },
    { key: 'overlap', label: 'Overlap', min: 0.2, max: 0.7, step: 0.02, defaultValue: 0.45 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'radius');
    const overlap = resolveParam(params, this.paramDefs, 'overlap');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    // Horizontal step overlaps neighbours by `overlap`; rows sit closer still
    // (source ratios preserved) so every ring threads four diagonal partners.
    const stepX = r * 2 * (1 - overlap);
    const stepY = r * (1 - overlap) * 1.6;

    for (let y = centeredStart(heightMm, stepY); y <= heightMm + stepY; y += stepY) {
      const iy = Math.round((y - heightMm / 2) / stepY);
      const rowOffset = (iy & 1) === 0 ? 0 : stepX / 2;
      for (let x = centeredStart(widthMm, stepX) - stepX; x <= widthMm + stepX; x += stepX) {
        const cx = x + rowOffset;
        ctx.beginPath();
        ctx.arc(cx, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
};
