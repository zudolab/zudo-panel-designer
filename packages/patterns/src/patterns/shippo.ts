import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `shippo` (seven treasures). Interlocking full circles on an
// offset grid where the row/col step equals the radius — the quarter-overlaps
// carve the petal / four-point-star negative space. Dropped from the source: bg
// fill and per-circle fg-pool colour cycling (colorOffset) — one stroke colour.
// The inner accent circle is kept as the signature knob (0 = off).
export const shippo: PanelPatternGenerator = {
  name: 'shippo',
  displayName: 'Shippo',
  paramDefs: [
    { key: 'radius', label: 'Circle radius (mm)', min: 4, max: 16, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
    { key: 'innerRatio', label: 'Inner circle', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const radius = resolveParam(params, this.paramDefs, 'radius');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const innerRatio = resolveParam(params, this.paramDefs, 'innerRatio');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    const step = radius; // step == radius gives the canonical interlock
    for (let y = centeredStart(heightMm, step); y <= heightMm + step; y += step) {
      const iy = Math.round((y - heightMm / 2) / step);
      const rowOffset = (iy & 1) === 0 ? 0 : step / 2;
      for (let x = centeredStart(widthMm, step) - step; x <= widthMm + step; x += step) {
        const cx = x + rowOffset;
        ctx.beginPath();
        ctx.arc(cx, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        // Inner accent circle emphasises the central blossom (0 = off).
        if (innerRatio > 0) {
          ctx.beginPath();
          ctx.arc(cx, y, radius * innerRatio, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  },
};
