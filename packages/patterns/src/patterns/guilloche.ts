import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `guilloche`. Hypotrochoid engraving:
//   x = (R-r)*cos t + d*cos(t*(R-r)/r),  y = (R-r)*sin t - d*sin(t*(R-r)/r).
// pgen randomises R, r and the pen distance and extends one curve past the
// canvas for a cropped-crossing look; here we fix them as params and draw a
// woven medallion per cell. Choosing r = R/(lobes+1) makes (R-r)/r an integer,
// so each curve closes in exactly one revolution. The guilloche's dense
// banknote-engraving look comes from OVERLAYING several copies of the curve
// with the epicyclic (pen) term rotated by an even phase spread — the cusps
// interweave into a rosette band instead of a single sparse outline. Dropped:
// withAlpha, granularity, crop-beyond-bounds. Single stroke colour.
export const guilloche: PanelPatternGenerator = {
  name: 'guilloche',
  displayName: 'Guilloche',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 24, max: 50, step: 0.5, defaultValue: 32 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 2, step: 0.05, defaultValue: 0.3 },
    // Rosette lobe count — sets r = R/(lobes+1), i.e. (R-r)/r = lobes cusps.
    { key: 'lobes', label: 'Lobes', min: 2, max: 9, step: 1, defaultValue: 5 },
    // Pen distance as a fraction of the inner radius r: <1 rounded petals,
    // ~1 sharp cusps, >1 looping crossings.
    { key: 'penDistance', label: 'Pen distance', min: 0.2, max: 1.2, step: 0.05, defaultValue: 0.8 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const lobes = Math.round(resolveParam(params, this.paramDefs, 'lobes'));
    const penDistance = resolveParam(params, this.paramDefs, 'penDistance');
    const R = cell * 0.42; // keep loops within the cell even at penDistance max
    const rDivisor = lobes + 1;
    const r = R / rDivisor;
    const d = r * penDistance;
    const Rr = R - r;
    const ratio = Rr / r; // integer (= lobes) → curve closes in one revolution
    // Overlaid phase-rotated copies weave the rosette band. 10 reads as a dense
    // guilloche; step count grows with lobe density, both capped so the busiest
    // cell (small cell on a tall panel) stays well under the primitive budget.
    const copies = 10;
    const steps = Math.min(200, Math.max(140, rDivisor * 26));
    const dt = (Math.PI * 2) / steps;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        for (let c = 0; c < copies; c++) {
          const phase = (c / copies) * Math.PI * 2;
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const t = i * dt;
            const px = cx + Rr * Math.cos(t) + d * Math.cos(t * ratio + phase);
            const py = cy + Rr * Math.sin(t) - d * Math.sin(t * ratio + phase);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
    }
  },
};
