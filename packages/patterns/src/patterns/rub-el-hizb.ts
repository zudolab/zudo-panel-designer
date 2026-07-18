import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `rub-el-hizb`. Each cell holds two concentric squares — one
// upright, one rotated 45° — whose overlap forms the eight-point khatim seal,
// plus a small center dot. The pgen source filled each square with the bg color
// to occlude the other (a composite trick); per the port rules that bg-fill is
// dropped and both squares are simply STROKED, so the crossings read as plain
// overlaps in the single foreground color (no assumed background painted). All
// squares share one width and all dots one fill, so each is a single batched
// path (keeps the primitive count lean on large panels).
export const rubElHizb: PanelPatternGenerator = {
  name: 'rub-el-hizb',
  displayName: 'Rub el Hizb',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 7, max: 24, step: 0.5, defaultValue: 8 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    // source ratios: square corner radius 0.44×cell; center dot 0.06×cell
    const r = cell * 0.44;
    const dotR = cell * 0.06;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    const addSquare = (cx: number, cy: number, rot: number): void => {
      for (let i = 0; i < 4; i++) {
        const a = rot + (i / 4) * Math.PI * 2 - Math.PI / 4;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    ctx.beginPath();
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        addSquare(x, y, 0);
        addSquare(x, y, Math.PI / 4);
      }
    }
    ctx.stroke();
    ctx.beginPath();
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  },
};
