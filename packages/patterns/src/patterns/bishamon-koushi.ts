import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `bishamon-koushi` (Bishamon armour-scale lattice). A hex
// lattice where each cell is an outer hexagon with a smaller nested hexagon
// punched out. pgen filled the inner hex with a second palette color to fake the
// punch and cycled colors per cell; per the port rules each cell is a hex ring
// (outer hex minus inner hex) in one color, so the nested void is real geometry
// and the color cycling / tint jitter are dropped. Hexes tile without overlap,
// so every ring accumulates into a single even-odd fill.
export const bishamonKoushi: PanelPatternGenerator = {
  name: 'bishamon-koushi',
  displayName: 'Bishamon Koushi',
  paramDefs: [
    { key: 'radius', label: 'Hex radius (mm)', min: 4, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'innerScale', label: 'Inner scale', min: 0.3, max: 0.85, step: 0.05, defaultValue: 0.62 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'radius');
    const innerScale = resolveParam(params, this.paramDefs, 'innerScale');
    // source lattice spacing for this hex orientation
    const colW = r * Math.sqrt(3);
    const rowH = r * 1.5;
    ctx.fillStyle = color;
    const addHex = (cx: number, cy: number, rad: number): void => {
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    ctx.beginPath();
    for (let cy = centeredStart(heightMm, rowH); cy <= heightMm + rowH; cy += rowH) {
      const row = Math.round((cy - heightMm / 2) / rowH);
      const offset = (((row % 2) + 2) % 2) === 0 ? 0 : colW / 2;
      for (let cx = centeredStart(widthMm, colW) + offset; cx <= widthMm + colW; cx += colW) {
        addHex(cx, cy, r); // outer hexagon
        addHex(cx, cy, r * innerScale); // inner hexagon → even-odd hole
      }
    }
    ctx.fill('evenodd');
  },
};
