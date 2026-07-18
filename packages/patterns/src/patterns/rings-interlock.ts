import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `rings-interlock` (see .claude/skills/port-pgen-patterns/).
// Thick ring outlines in a chainmail lattice: rings link at their edges with
// open centers (background shows through). Dropped from the source: bg fill and
// the fg-pool color cycling — one flat stroke color per the zpd contract. The
// ring band thickness became an independent mm param.
export const ringsInterlock: PanelPatternGenerator = {
  name: 'rings-interlock',
  displayName: 'Rings Interlock',
  paramDefs: [
    { key: 'radius', label: 'Ring radius (mm)', min: 2, max: 12, step: 0.5, defaultValue: 4 },
    { key: 'bandWidth', label: 'Band width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 1.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const radius = resolveParam(params, this.paramDefs, 'radius');
    const bandWidth = resolveParam(params, this.paramDefs, 'bandWidth');
    // source ratio: step = radius × 1.42 (the chainmail interlock constant —
    // rings just touch at neighbour midpoints, centers stay open).
    const step = radius * 1.42;
    ctx.strokeStyle = color;
    ctx.lineWidth = bandWidth;
    // Rings reach ~0.7 pitch + half a band past their center — under one pitch —
    // so the base centeredStart overscan already covers the edges.
    for (let y = centeredStart(heightMm, step); y <= heightMm + step; y += step) {
      const iy = Math.round((y - heightMm / 2) / step);
      const rowShift = iy % 2 !== 0 ? step / 2 : 0;
      for (let x = centeredStart(widthMm, step); x <= widthMm + step; x += step) {
        ctx.beginPath();
        ctx.arc(x + rowShift, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
};
