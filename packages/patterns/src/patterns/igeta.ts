import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `igeta` (see .claude/skills/port-pgen-patterns/). Well-crib
// motif: two vertical + two horizontal bars per cell forming a tiled "#"
// lattice. Dropped from the source: bg fill and fg-pool color cycling — one
// flat color per the zpd contract.
export const igeta: PanelPatternGenerator = {
  name: 'igeta',
  displayName: 'Igeta',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 3, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'barWidth', label: 'Bar width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 1.8 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const barWidth = resolveParam(params, this.paramDefs, 'barWidth');
    // source ratios: bars inset 0.28×cell from the cell edges; bars over-extend
    // 0.9×barWidth past the crossings (seamless joints between adjacent cells)
    const inset = cell * 0.28;
    const over = barWidth * 0.9;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        ctx.fillRect(x + inset - barWidth / 2, y - over, barWidth, cell + over * 2);
        ctx.fillRect(x + cell - inset - barWidth / 2, y - over, barWidth, cell + over * 2);
        ctx.fillRect(x - over, y + inset - barWidth / 2, cell + over * 2, barWidth);
        ctx.fillRect(x - over, y + cell - inset - barWidth / 2, cell + over * 2, barWidth);
      }
    }
  },
};
