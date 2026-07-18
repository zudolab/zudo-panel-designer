import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `raimon` (thunder fret). A square-spiral Greek-key fret per
// cell; alternate cells mirror their winding so the frets chain into the
// continuous rai-mon band. Dropped from the source: bg fill and fg-pool colour
// cycling (colorOffset). turns kept as the signature knob.
export const raimon: PanelPatternGenerator = {
  name: 'raimon',
  displayName: 'Raimon',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 24, step: 0.5, defaultValue: 9 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.7 },
    { key: 'turns', label: 'Spiral turns', min: 2, max: 5, step: 1, defaultValue: 3 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const turns = Math.round(resolveParam(params, this.paramDefs, 'turns'));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    const gap = cell / (turns * 2 + 1); // spacing between spiral arms

    // Square spiral winding inward inside the cell [x0,y0]..[x0+cell,y0+cell];
    // mirror flips it horizontally for the alternating-cell chain.
    const spiral = (x0: number, y0: number, mirror: boolean): void => {
      ctx.beginPath();
      let left = x0 + gap;
      let right = x0 + cell - gap;
      let top = y0 + gap;
      let bottom = y0 + cell - gap;
      const sx = (xx: number): number => (mirror ? x0 + cell - (xx - x0) : xx);
      let started = false;
      for (let t = 0; t < turns; t++) {
        const pts: Array<[number, number]> = [
          [left, bottom],
          [left, top],
          [right, top],
          [right, bottom - gap],
        ];
        for (const [px, py] of pts) {
          const X = sx(px);
          if (!started) {
            ctx.moveTo(X, py);
            started = true;
          } else {
            ctx.lineTo(X, py);
          }
        }
        left += gap;
        right -= gap;
        top += gap;
        bottom -= gap;
        if (right - left < gap || bottom - top < gap) break;
      }
      ctx.stroke();
    };

    for (let y0 = centeredStart(heightMm, cell); y0 <= heightMm + cell; y0 += cell) {
      const iy = Math.round((y0 - heightMm / 2) / cell);
      for (let x0 = centeredStart(widthMm, cell); x0 <= widthMm + cell; x0 += cell) {
        const ix = Math.round((x0 - widthMm / 2) / cell);
        spiral(x0, y0, ((ix + iy) & 1) === 1);
      }
    }
  },
};
