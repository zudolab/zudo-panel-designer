import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `via-grid-array` (see .claude/skills/port-pgen-patterns/). A
// regular grid of plated through-hole vias: each is a copper annulus with a
// drilled center hole. Dropped from the source: bg fill and the fg-pool color
// cycling — one flat fill color. The hole is REAL negative space: the annulus is
// an even-odd fill (outer disc minus inner disc), never a bg-colored disc, so
// the layers below show through the drilled center.
export const viaGridArray: PanelPatternGenerator = {
  name: 'via-grid-array',
  displayName: 'Via Grid Array',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 3, max: 16, step: 0.5, defaultValue: 5 },
    { key: 'ringRadius', label: 'Ring radius (mm)', min: 0.3, max: 4, step: 0.05, defaultValue: 1.8 },
    { key: 'holeRatio', label: 'Hole ratio', min: 0.1, max: 0.7, step: 0.02, defaultValue: 0.45 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const ringR = resolveParam(params, this.paramDefs, 'ringRadius');
    const holeRatio = resolveParam(params, this.paramDefs, 'holeRatio');
    const holeR = ringR * holeRatio;
    const over = Math.ceil(ringR / cell) * cell;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell) - over; y <= heightMm + cell + over; y += cell) {
      for (let x = centeredStart(widthMm, cell) - over; x <= widthMm + cell + over; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        // Even-odd annulus: outer disc filled, concentric inner disc punched out
        // as real negative space.
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
        ctx.fill('evenodd');
      }
    }
  },
};
