import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `houndstooth-tooth-grid` (see .claude/skills/port-pgen-patterns/).
// The broken-check dogtooth: solid blocks on the checker "on" cells, each
// growing two triangular tooth tabs toward its +x/+y neighbours so the field
// reads as the four-pointed houndstooth silhouette. Dropped from the source:
// bg fill and the seeded fg color pick — one flat fill. Checker parity is keyed
// on center-origin cell indices so a panel resize re-centres without reshuffling.
export const houndstoothToothGrid: PanelPatternGenerator = {
  name: 'houndstooth-tooth-grid',
  displayName: 'Houndstooth Tooth Grid',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'notch', label: 'Notch length', min: 0.25, max: 0.6, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const notch = resolveParam(params, this.paramDefs, 'notch');
    const n = cell * notch; // tooth-tab length (source ratio)
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      const iy = Math.round((y - heightMm / 2) / cell);
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const ix = Math.round((x - widthMm / 2) / cell);
        if ((ix + iy) % 2 !== 0) continue;
        ctx.fillRect(x, y, cell, cell);
        ctx.beginPath();
        ctx.moveTo(x + cell, y);
        ctx.lineTo(x + cell + n, y);
        ctx.lineTo(x + cell, y + n);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y + cell);
        ctx.lineTo(x, y + cell + n);
        ctx.lineTo(x + n, y + cell);
        ctx.closePath();
        ctx.fill();
      }
    }
  },
};
