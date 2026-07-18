import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `star-and-cross-field`. Eight-point stars on the lattice
// nodes with plus-crosses at the interstitial (half-offset) positions — the
// classic Islamic star-and-cross tessellation. pgen used two color families and
// an alpha-darkened outline pass; per the port rules that collapses to a single
// color — both the stars and the interstitial crosses are FILLED in that color.
// They sit in the alleys between star rows/columns so they read as distinct
// motifs; the random per-cell palette picks and the darkened stroke are dropped.
// Everything is one flat fill, so it batches into a single path + fill.
export const starAndCrossField: PanelPatternGenerator = {
  name: 'star-and-cross-field',
  displayName: 'Star and Cross Field',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 8, max: 20, step: 0.5, defaultValue: 8 },
    { key: 'starRatio', label: 'Star size', min: 0.45, max: 0.85, step: 0.02, defaultValue: 0.62 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const starRatio = resolveParam(params, this.paramDefs, 'starRatio');
    // source ratios: star outer radius 0.5×cell×starRatio, inner-notch 0.46×outer;
    // cross arm span 0.84×cell long, 0.30×cell wide
    const outer = cell * 0.5 * starRatio;
    const inner = outer * 0.46;
    const armHalf = cell * 0.42;
    const armT = cell * 0.15;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        // eight-point star at the node
        for (let i = 0; i < 16; i++) {
          const rr = i % 2 === 0 ? outer : inner;
          const a = (Math.PI * i) / 8 - Math.PI / 2;
          const px = x + Math.cos(a) * rr;
          const py = y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        // filled plus-cross at the cell corner (two overlapping bars)
        const ccx = x + cell / 2;
        const ccy = y + cell / 2;
        ctx.rect(ccx - armHalf, ccy - armT, armHalf * 2, armT * 2);
        ctx.rect(ccx - armT, ccy - armHalf, armT * 2, armHalf * 2);
      }
    }
    ctx.fill();
  },
};
