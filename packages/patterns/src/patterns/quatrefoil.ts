import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `quatrefoil` (see .claude/skills/port-pgen-patterns/). A grid
// of four-lobe clover motifs (Gothic quatrefoil): four discs arranged N/E/S/W,
// filled as a single non-zero-winding path so the overlap unions into one crisp
// four-petal silhouette. Dropped from the source: bg fill and the fg-pool color
// cycling — one flat fill color per the zpd contract.
export const quatrefoil: PanelPatternGenerator = {
  name: 'quatrefoil',
  displayName: 'Quatrefoil',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 24, step: 0.5, defaultValue: 8 },
    { key: 'lobeRadius', label: 'Lobe radius (mm)', min: 0.5, max: 4, step: 0.05, defaultValue: 1.8 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lobe = resolveParam(params, this.paramDefs, 'lobeRadius');
    // source ratio: each lobe is offset 0.95×lobe from the motif center.
    const off = lobe * 0.95;
    const reach = lobe + off;
    const over = Math.ceil(reach / cell) * cell;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell) - over; y <= heightMm + cell + over; y += cell) {
      for (let x = centeredStart(widthMm, cell) - over; x <= widthMm + cell + over; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        // Four discs around the center; one non-zero fill unions them into the
        // clover (each moveTo re-anchors before its full-circle arc).
        ctx.beginPath();
        const centres: [number, number][] = [
          [cx, cy - off],
          [cx + off, cy],
          [cx, cy + off],
          [cx - off, cy],
        ];
        for (const [px, py] of centres) {
          ctx.moveTo(px + lobe, py);
          ctx.arc(px, py, lobe, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  },
};
