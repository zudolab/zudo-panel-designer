import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const diamondLattice: PanelPatternGenerator = {
  name: 'diamond-lattice',
  displayName: 'Diamond Lattice',
  paramDefs: [
    { key: 'size', label: 'Diamond size (mm)', min: 3, max: 30, step: 0.5, defaultValue: 8 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const size = resolveParam(params, this.paramDefs, 'size');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    // Diamonds (half-diagonal = size/2) on a checkerboard of centers stepped by
    // size/2: base + interstitial sublattices share edges, so the field
    // tessellates seamlessly (argyle) instead of leaving corner-touching holes.
    const h = size / 2;
    let row = 0;
    for (let cy = centeredStart(heightMm, h); cy <= heightMm + h; cy += h, row += 1) {
      let col = 0;
      for (let cx = centeredStart(widthMm, h); cx <= widthMm + h; cx += h, col += 1) {
        if ((row + col) % 2 !== 0) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx + h, cy);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx - h, cy);
        ctx.closePath();
        ctx.stroke();
      }
    }
  },
};
