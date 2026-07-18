import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `yagasuri` / yabane (arrow feather). Vertical columns of
// filled fletching chevrons; alternate columns mirror their slant so the barbs
// read as opposing arrow rows. The chevron bands are solid fills — the gaps
// between them are the negative space (no bg paint). Dropped from the source:
// bg fill and fg-pool colour cycling (colorOffset). slant kept as a source
// constant (0.7); barb height is its own mm param.
const SLANT = 0.7; // source default: how far the barb tip leans up the column

export const yagasuri: PanelPatternGenerator = {
  name: 'yagasuri',
  displayName: 'Yagasuri',
  paramDefs: [
    { key: 'columnWidth', label: 'Column width (mm)', min: 4, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'barbHeight', label: 'Barb height (mm)', min: 4, max: 24, step: 0.5, defaultValue: 6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const colW = resolveParam(params, this.paramDefs, 'columnWidth');
    const barbH = resolveParam(params, this.paramDefs, 'barbHeight');
    ctx.fillStyle = color;

    for (let x0 = centeredStart(widthMm, colW); x0 <= widthMm + colW; x0 += colW) {
      const ix = Math.round((x0 - widthMm / 2) / colW);
      const up = (ix & 1) === 0 ? 1 : -1; // mirror slant per alternate column
      const x1 = x0 + colW;
      const xMid = (x0 + x1) / 2;
      for (let y0 = centeredStart(heightMm, barbH) - barbH; y0 <= heightMm + barbH; y0 += barbH) {
        // A single fletching barb: a chevron band built from two angled edges.
        const tip = up > 0 ? y0 : y0 + barbH;
        const baseY = up > 0 ? y0 + barbH : y0;
        const peak = baseY + (tip - baseY) * SLANT;
        ctx.beginPath();
        ctx.moveTo(x0, baseY);
        ctx.lineTo(xMid, peak);
        ctx.lineTo(x1, baseY);
        ctx.lineTo(x1, baseY + (tip - baseY) * (SLANT * 0.5));
        ctx.lineTo(xMid, peak + (tip - peak) * 0.5);
        ctx.lineTo(x0, baseY + (tip - baseY) * (SLANT * 0.5));
        ctx.closePath();
        ctx.fill();
      }
    }
  },
};
