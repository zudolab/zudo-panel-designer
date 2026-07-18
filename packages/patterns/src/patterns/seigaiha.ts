import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `seigaiha` (blue-ocean-wave). Rows of overlapping fish-scale
// fans, each a stack of nested concentric upper-semicircle arcs; adjacent fans
// overlap by half and alternate rows interlock at half spacing. Dropped from
// the source: bg fill and per-ring fg-pool colour cycling (colorOffset) — one
// stroke colour. arcRings kept as the signature knob.
export const seigaiha: PanelPatternGenerator = {
  name: 'seigaiha',
  displayName: 'Seigaiha',
  paramDefs: [
    { key: 'radius', label: 'Fan radius (mm)', min: 4, max: 18, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
    { key: 'rings', label: 'Arc rings', min: 2, max: 7, step: 1, defaultValue: 4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const baseR = resolveParam(params, this.paramDefs, 'radius');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const rings = Math.round(resolveParam(params, this.paramDefs, 'rings'));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    const stepX = baseR; // fans overlap by half
    const stepY = baseR * 0.6; // rows interlock at a fraction of the radius

    for (let y = centeredStart(heightMm, stepY); y <= heightMm + stepY; y += stepY) {
      const iy = Math.round((y - heightMm / 2) / stepY);
      const rowOffset = (iy & 1) === 0 ? 0 : stepX / 2;
      for (let x = centeredStart(widthMm, stepX) - stepX; x <= widthMm + stepX; x += stepX) {
        const cx = x + rowOffset;
        // Nested arcs outer -> inner; each a concentric upper semicircle.
        for (let k = 0; k < rings; k++) {
          const r = baseR * (1 - k / rings);
          if (r < lineWidth) break;
          ctx.beginPath();
          ctx.arc(cx, y, r, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  },
};
