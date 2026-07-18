import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// pgen default: half-angle of the meander gap left in each ring (radians). The
// gap side alternates per ring so the concentric arcs read as one winding route.
const GAP_ANGLE = 0.35;

// Ported from pgen `labyrinth-classical`. Concentric gap-alternating ring arcs
// plus a central seed cross — the Cretan meander motif, tiled per unit cell.
// Single stroke colour (dropped: per-tile random fg pick, colorOffset,
// granularity). The dropped per-tile rand() only chose a colour, so there is no
// orientation/state to reproduce — nothing to hash.
export const labyrinthClassical: PanelPatternGenerator = {
  name: 'labyrinth-classical',
  displayName: 'Classical Labyrinth',
  paramDefs: [
    { key: 'unit', label: 'Unit size (mm)', min: 10, max: 45, step: 0.5, defaultValue: 18 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
    // Concentric wall count per labyrinth — the meander density knob.
    { key: 'circuits', label: 'Circuits', min: 3, max: 12, step: 1, defaultValue: 7 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const unit = resolveParam(params, this.paramDefs, 'unit');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const circuits = Math.round(resolveParam(params, this.paramDefs, 'circuits'));
    const ringStep = (unit * 0.5) / (circuits + 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let y = centeredStart(heightMm, unit); y <= heightMm + unit; y += unit) {
      for (let x = centeredStart(widthMm, unit); x <= widthMm + unit; x += unit) {
        const cx = x + unit / 2;
        const cy = y + unit / 2;
        for (let k = 1; k <= circuits; k++) {
          const rr = ringStep * k;
          if (rr < 0.05) continue;
          // alternate the gap side per ring so the meander reads as one path
          const gap = k % 2 === 0 ? Math.PI * 0.5 : Math.PI * 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, gap + GAP_ANGLE, gap - GAP_ANGLE + Math.PI * 2);
          ctx.stroke();
        }
        // central seed cross
        ctx.beginPath();
        ctx.moveTo(cx, cy - ringStep * 0.6);
        ctx.lineTo(cx, cy + ringStep * 0.6);
        ctx.moveTo(cx - ringStep * 0.6, cy);
        ctx.lineTo(cx + ringStep * 0.6, cy);
        ctx.stroke();
      }
    }
  },
};
