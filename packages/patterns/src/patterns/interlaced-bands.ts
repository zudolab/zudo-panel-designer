import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `interlaced-bands`. A plain-weave lattice of horizontal and
// vertical bands whose over/under parity flips like a checkerboard. pgen faked
// the "under" crossings by punching bg-colored gaps; per the port rules there is
// no bg paint — each UNDER band is split with a REAL gap at the crossing so the
// perpendicular OVER band shows through, in the single foreground color.
export const interlacedBands: PanelPatternGenerator = {
  name: 'interlaced-bands',
  displayName: 'Interlaced Bands',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'bandWidth', label: 'Band width (mm)', min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const bandW = resolveParam(params, this.paramDefs, 'bandWidth');
    // real gap around each under-crossing so the over band reads as passing over
    const halfCross = bandW / 2 + bandW * 0.35;
    ctx.fillStyle = color;

    const xs: number[] = [];
    for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) xs.push(x);
    const ys: number[] = [];
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) ys.push(y);

    // Horizontal bands (one per y tick). Between crossings the strip is solid; at
    // each crossing the square is drawn only where the horizontal passes OVER.
    for (let r = 0; r < ys.length; r++) {
      const y = ys[r];
      for (let c = 0; c < xs.length; c++) {
        const x = xs[c];
        const next = c + 1 < xs.length ? xs[c + 1] : x + cell;
        const segStart = x + halfCross;
        const segEnd = next - halfCross;
        if (segEnd > segStart) ctx.fillRect(segStart, y - bandW / 2, segEnd - segStart, bandW);
        if ((r + c) % 2 === 0) ctx.fillRect(x - halfCross, y - bandW / 2, halfCross * 2, bandW);
      }
    }
    // Vertical bands (one per x tick), over when (r + c) is odd.
    for (let c = 0; c < xs.length; c++) {
      const x = xs[c];
      for (let r = 0; r < ys.length; r++) {
        const y = ys[r];
        const next = r + 1 < ys.length ? ys[r + 1] : y + cell;
        const segStart = y + halfCross;
        const segEnd = next - halfCross;
        if (segEnd > segStart) ctx.fillRect(x - bandW / 2, segStart, bandW, segEnd - segStart);
        if ((r + c) % 2 === 1) ctx.fillRect(x - bandW / 2, y - halfCross, bandW, halfCross * 2);
      }
    }
  },
};
