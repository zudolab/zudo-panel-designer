import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `circle-quarters` (see .claude/skills/port-pgen-patterns/).
// Bauhaus quarter-disc fills with a deterministic 4-way orientation cycle by
// (col + row) % 4, so adjacent discs interlock into circles and pinwheels.
// Dropped from the source: bg fill and the checkerboard color cycling — one flat
// fill color per the zpd contract; the orientation cycle carries the rhythm.
export const circleQuarters: PanelPatternGenerator = {
  name: 'circle-quarters',
  displayName: 'Circle Quarters',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 20, step: 0.5, defaultValue: 8 },
    { key: 'radiusRatio', label: 'Disc size', min: 0.5, max: 1, step: 0.02, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    // source ratio: quarter-disc radius = cell (arcs meet at the cell edges).
    // radiusRatio dials the disc in toward its corner for more negative space.
    const radiusRatio = resolveParam(params, this.paramDefs, 'radiusRatio');
    const radius = cell * radiusRatio;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      const iy = Math.round((y - heightMm / 2) / cell);
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const ix = Math.round((x - widthMm / 2) / cell);
        const orientation = (((ix + iy) % 4) + 4) % 4;
        ctx.beginPath();
        switch (orientation) {
          case 0: // corner at top-left
            ctx.arc(x, y, radius, 0, Math.PI / 2);
            ctx.lineTo(x, y);
            break;
          case 1: // corner at top-right
            ctx.arc(x + cell, y, radius, Math.PI / 2, Math.PI);
            ctx.lineTo(x + cell, y);
            break;
          case 2: // corner at bottom-right
            ctx.arc(x + cell, y + cell, radius, Math.PI, Math.PI * 1.5);
            ctx.lineTo(x + cell, y + cell);
            break;
          default: // corner at bottom-left
            ctx.arc(x, y + cell, radius, Math.PI * 1.5, Math.PI * 2);
            ctx.lineTo(x, y + cell);
            break;
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  },
};
