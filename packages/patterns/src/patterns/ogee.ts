import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `ogee` (see .claude/skills/port-pgen-patterns/). The onion-dome
// ornamental lattice: each cell is a four-sided ogival tile whose left/right
// edges are mirrored cubic-bezier S-curves meeting at sharp top/bottom points,
// brick-offset by half a tile so the domes nest. Per the porting note the
// two-color tilework becomes a single stroked outline lattice (no painted bg).
// Dropped: bg fill, the alternating fg colors and the colorOffset rotation.
export const ogee: PanelPatternGenerator = {
  name: 'ogee',
  displayName: 'Ogee',
  paramDefs: [
    { key: 'tileWidth', label: 'Tile width (mm)', min: 6, max: 20, step: 0.5, defaultValue: 8 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
    { key: 'domeHeight', label: 'Dome height', min: 0.8, max: 2, step: 0.05, defaultValue: 1.25 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const tileW = resolveParam(params, this.paramDefs, 'tileWidth');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const aspect = resolveParam(params, this.paramDefs, 'domeHeight');
    const tileH = tileW * aspect;
    const halfW = tileW / 2;
    const shoulder = 0.55; // source const: S-curve shoulder as a fraction of half-width
    const sx = halfW * shoulder;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const drawCell = (cx: number, top: number): void => {
      const bottom = top + tileH;
      const midY = top + tileH / 2;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.bezierCurveTo(cx + sx, top, cx + halfW, midY - tileH * 0.18, cx + halfW, midY);
      ctx.bezierCurveTo(cx + halfW, midY + tileH * 0.18, cx + sx, bottom, cx, bottom);
      ctx.bezierCurveTo(cx - sx, bottom, cx - halfW, midY + tileH * 0.18, cx - halfW, midY);
      ctx.bezierCurveTo(cx - halfW, midY - tileH * 0.18, cx - sx, top, cx, top);
      ctx.closePath();
      ctx.stroke();
    };
    let row = 0;
    for (let top = centeredStart(heightMm, tileH) - tileH; top <= heightMm + tileH; top += tileH, row += 1) {
      const xShift = row % 2 ? halfW : 0; // alternate rows nest between the domes above
      for (let cx = centeredStart(widthMm, tileW) - tileW + xShift; cx <= widthMm + tileW; cx += tileW) {
        drawCell(cx, top);
      }
    }
  },
};
