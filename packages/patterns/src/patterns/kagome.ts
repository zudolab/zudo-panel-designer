import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `kagome` (woven-bamboo trihexagonal lattice). Up- and
// down-pointing triangles interlace into the Star-of-David weave with hexagonal
// holes. Dropped from the source: bg fill, per-cell fg-pool colour cycling
// (colorOffset), and the advanced triScale knob (kept at its 1.0 default).
export const kagome: PanelPatternGenerator = {
  name: 'kagome',
  displayName: 'Kagome',
  paramDefs: [
    { key: 'side', label: 'Triangle side (mm)', min: 4, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const s = resolveParam(params, this.paramDefs, 'side');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const h = (s * Math.sqrt(3)) / 2; // triangle height
    const stepX = s;
    const stepY = h;

    for (let y = centeredStart(heightMm, stepY); y <= heightMm + stepY; y += stepY) {
      const iy = Math.round((y - heightMm / 2) / stepY);
      // Offset alternate rows by half a side for the trihexagonal interlace.
      const rowOffset = (iy & 1) === 0 ? 0 : s / 2;
      for (let x = centeredStart(widthMm, stepX) - stepX; x <= widthMm + stepX; x += stepX) {
        const cx = x + rowOffset;
        // Up-pointing triangle: apex at (cx, y), base along y + h.
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx + s / 2, y + h);
        ctx.lineTo(cx - s / 2, y + h);
        ctx.closePath();
        ctx.stroke();
        // Down-pointing triangle, offset half a side: apex at (cx + s/2, y + h).
        ctx.beginPath();
        ctx.moveTo(cx + s / 2, y + h);
        ctx.lineTo(cx, y);
        ctx.lineTo(cx + s, y);
        ctx.closePath();
        ctx.stroke();
      }
    }
  },
};
