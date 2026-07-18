import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Re-authored from pgen `meander` (Greek key). The pgen source was a large
// multi-style / multi-fill frame composer; per the port rules only the classic
// key is kept — a single squared-spiral key polyline tiled across the panel and
// stroked in one color. Adjacent columns mirror so the keys interlock into the
// running meander. All the style/fill/decoration selects and color pools are
// dropped. Every key shares one stroke width, so they batch into one path.
export const meander: PanelPatternGenerator = {
  name: 'meander',
  displayName: 'Meander',
  paramDefs: [
    { key: 'cell', label: 'Key size (mm)', min: 7, max: 24, step: 0.5, defaultValue: 10 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.8 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const inset = cell * 0.25; // source ratio: classic key inset 0.25×cell
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    // one classic Greek key motif spanning (x,y)-(x+cell,y+cell); `flipped`
    // mirrors it horizontally so neighbours interlock into the meander run
    const addKey = (x: number, y: number, flipped: boolean): void => {
      const w = cell;
      const h = cell;
      if (flipped) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + inset, y + h);
        ctx.lineTo(x + inset, y + inset);
        ctx.lineTo(x + w - inset, y + inset);
        ctx.lineTo(x + w - inset, y + h - inset);
        ctx.lineTo(x, y + h - inset);
      } else {
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x + w - inset, y + h);
        ctx.lineTo(x + w - inset, y + inset);
        ctx.lineTo(x + inset, y + inset);
        ctx.lineTo(x + inset, y + h - inset);
        ctx.lineTo(x + w, y + h - inset);
      }
    };
    ctx.beginPath();
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const c = Math.round((x - widthMm / 2) / cell);
        addKey(x, y, (((c % 2) + 2) % 2) === 1);
      }
    }
    ctx.stroke();
  },
};
