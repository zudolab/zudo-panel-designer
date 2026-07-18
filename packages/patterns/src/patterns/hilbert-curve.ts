import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Classic d2xy Hilbert mapping: an order-o curve visits every cell of a
// 2^o x 2^o grid as one continuous non-crossing polyline. Computed once per
// draw (order-independent of panel size), then replayed into every tile.
function hilbertPoints(order: number): Array<[number, number]> {
  const n = 1 << order;
  const total = n * n;
  const pts: Array<[number, number]> = [];
  for (let d = 0; d < total; d++) {
    let t = d;
    let x = 0;
    let y = 0;
    for (let s = 1; s < n; s <<= 1) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (ry === 0) {
        if (rx === 1) {
          x = s - 1 - x;
          y = s - 1 - y;
        }
        const tmp = x;
        x = y;
        y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    pts.push([x, y]);
  }
  return pts;
}

// Ported from pgen `hilbert-curve`. pgen fits one curve to the whole canvas and
// cycles the fg-color pool per segment; here we tile square cells so the curve
// reads as a repeating pattern on tall panels, and stroke every cell in the one
// fg color (dropped: bg fill, per-segment color cycling, granularity nudging).
export const hilbertCurve: PanelPatternGenerator = {
  name: 'hilbert-curve',
  displayName: 'Hilbert Curve',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 18, max: 40, step: 0.5, defaultValue: 26 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
    // order sets 2^order cells per side per tile — the structure knob. Capped at
    // 4 (4^4 = 256 points per tile); default 3 (an 8x8 curve) keeps a tiled draw
    // light enough for the shared registry suite, order 4 available on demand.
    { key: 'order', label: 'Order', min: 2, max: 4, step: 1, defaultValue: 3 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const order = Math.round(resolveParam(params, this.paramDefs, 'order'));
    const n = 1 << order;
    const pts = hilbertPoints(order);
    const inset = cell * 0.08;
    const step = (cell - inset * 2) / (n - 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        // skip cells whose whole tile falls outside the panel (like the pgen
        // sources' off-canvas cull) — the motif never leaves its cell rect
        if (x + cell < 0 || x > widthMm || y + cell < 0 || y > heightMm) continue;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const px = x + inset + pts[i][0] * step;
          const py = y + inset + pts[i][1] * step;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
};
