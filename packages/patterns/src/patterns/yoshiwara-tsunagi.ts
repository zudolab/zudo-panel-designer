import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `yoshiwara-tsunagi` (linked Yoshiwara rings). Square rings
// drawn as four corner-brackets that leave notched gaps, so neighbours
// interlock into a continuous chain lattice. Dropped from the source: bg fill
// and per-cell fg-pool colour cycling (colorOffset). notch kept as a source
// constant (0.18 x cell).
const NOTCH_RATIO = 0.18; // source default: corner gap so neighbours interlock

export const yoshiwaraTsunagi: PanelPatternGenerator = {
  name: 'yoshiwara-tsunagi',
  displayName: 'Yoshiwara Tsunagi',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.7 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'miter';

    const half = cell * 0.5;
    const notch = cell * NOTCH_RATIO;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const corners: Array<[number, number]> = [
          [x - half, y - half],
          [x + half, y - half],
          [x + half, y + half],
          [x - half, y + half],
        ];
        // Square ring as four corner-brackets: from the notch along the previous
        // edge, into the corner, back out along the next edge.
        for (let i = 0; i < 4; i++) {
          const [cx, cy] = corners[i];
          const [nx, ny] = corners[(i + 1) % 4];
          const [px, py] = corners[(i + 3) % 4];
          const dirNx = Math.sign(nx - cx);
          const dirNy = Math.sign(ny - cy);
          const dirPx = Math.sign(px - cx);
          const dirPy = Math.sign(py - cy);
          ctx.beginPath();
          ctx.moveTo(cx + dirPx * notch, cy + dirPy * notch);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + dirNx * notch, cy + dirNy * notch);
          ctx.stroke();
        }
      }
    }
  },
};
