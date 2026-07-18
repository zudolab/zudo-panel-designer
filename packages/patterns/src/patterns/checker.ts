import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const checker: PanelPatternGenerator = {
  name: 'checker',
  displayName: 'Checker',
  paramDefs: [{ key: 'cell', label: 'Cell size (mm)', min: 1, max: 20, step: 0.5, defaultValue: 5 }],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    ctx.fillStyle = color;
    let row = 0;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell, row += 1) {
      let col = 0;
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell, col += 1) {
        if ((row + col) % 2 === 0) ctx.fillRect(x, y, cell, cell);
      }
    }
  },
};
