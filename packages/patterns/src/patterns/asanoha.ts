import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `asanoha` (hemp-leaf). Flat-top hex lattice; each hex
// carries its outline, six centre-to-vertex spokes, and six radiating kite
// diamonds — the classic six-point hemp-leaf star, pure stroke linework.
// Dropped from the source: bg fill, per-cluster fg-pool colour cycling
// (colorOffset), and the advanced hexRadiusFactor (kept at its 0.9 default,
// folded into the exposed star radius).
export const asanoha: PanelPatternGenerator = {
  name: 'asanoha',
  displayName: 'Asanoha',
  paramDefs: [
    { key: 'radius', label: 'Star radius (mm)', min: 4, max: 14, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'radius');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Flat-top hex lattice: X pitch (colW = 1.5·r) != Y pitch (rowH = √3·r);
    // alternate columns drop by half a row (rowH/2) so the hexes share edges.
    const colW = r * 1.5;
    const rowH = r * Math.sqrt(3);

    // Hex vertex k, flat-top: first vertex points right (0 rad). Flat-top verts
    // are what the colW/rowH/column-offset pitches above tessellate cleanly.
    const vx = (cx: number, k: number): number => cx + r * Math.cos((Math.PI / 3) * k);
    const vy = (cy: number, k: number): number => cy + r * Math.sin((Math.PI / 3) * k);

    for (let x = centeredStart(widthMm, colW); x <= widthMm + colW; x += colW) {
      const ix = Math.round((x - widthMm / 2) / colW);
      const colOffset = (ix & 1) === 0 ? 0 : rowH / 2;
      for (let y = centeredStart(heightMm, rowH) - rowH; y <= heightMm + rowH * 2; y += rowH) {
        const cx = x;
        const cy = y + colOffset;
        const px: number[] = [];
        const py: number[] = [];
        for (let k = 0; k < 6; k++) {
          px.push(vx(cx, k));
          py.push(vy(cy, k));
        }

        // Hex outline.
        ctx.beginPath();
        ctx.moveTo(px[0], py[0]);
        for (let k = 1; k < 6; k++) ctx.lineTo(px[k], py[k]);
        ctx.closePath();
        ctx.stroke();

        // Six spokes: centre to each vertex.
        for (let k = 0; k < 6; k++) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(px[k], py[k]);
          ctx.stroke();
        }

        // Radiating kite diamonds between adjacent spokes.
        for (let k = 0; k < 6; k++) {
          const next = (k + 1) % 6;
          const mx = (cx + px[k]) / 2;
          const my = (cy + py[k]) / 2;
          const nx = (cx + px[next]) / 2;
          const ny = (cy + py[next]) / 2;
          ctx.beginPath();
          ctx.moveTo(px[k], py[k]);
          ctx.lineTo(nx, ny);
          ctx.lineTo(px[next], py[next]);
          ctx.lineTo(mx, my);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  },
};
