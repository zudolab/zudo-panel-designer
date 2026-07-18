import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

// Ported from pgen `kolam-sikku`. A single unbroken loop woven around a grid of
// pulli (dots), built constructively as a Hamiltonian cycle over the cell grid
// (boustrophedon serpentine + a return column) so it is deterministic and
// self-avoiding by construction — no random walk. pgen used separate line/dot
// color indices; per the port rules the loop and the dots share the one color.
export const kolamSikku: PanelPatternGenerator = {
  name: 'kolam-sikku',
  displayName: 'Kolam Sikku',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 20, step: 0.5, defaultValue: 8 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 1.2 },
    { key: 'dotRadius', label: 'Dot radius (mm)', min: 0, max: 3, step: 0.1, defaultValue: 0.7 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const dotRadius = resolveParam(params, this.paramDefs, 'dotRadius');

    let rows = Math.max(2, Math.ceil(heightMm / cell) + 1);
    if (rows % 2 !== 0) rows += 1; // even rows → serpentine cycle closes cleanly
    const cols = Math.max(2, Math.ceil(widthMm / cell) + 1);

    // center the dot grid in the draw region
    const ox = (widthMm - (cols - 1) * cell) / 2;
    const oy = (heightMm - (rows - 1) * cell) / 2;
    const gx = (c: number): number => ox + c * cell;
    const gy = (r: number): number => oy + r * cell;

    // Hamiltonian cycle: top row L→R, serpentine the body in columns 1..cols-1,
    // then run up column 0 back to the start — one closed loop.
    const path: [number, number][] = [];
    for (let c = 0; c < cols; c++) path.push([0, c]);
    for (let r = 1; r < rows; r++) {
      if (r % 2 === 1) for (let c = cols - 1; c >= 1; c--) path.push([r, c]);
      else for (let c = 1; c < cols; c++) path.push([r, c]);
    }
    for (let r = rows - 1; r >= 1; r--) path.push([r, 0]);

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const n = path.length;
    ctx.beginPath();
    // start at the midpoint of the closing edge so the rounded path is seamless
    ctx.moveTo(
      (gx(path[n - 1][1]) + gx(path[0][1])) / 2,
      (gy(path[n - 1][0]) + gy(path[0][0])) / 2,
    );
    for (let i = 0; i < n; i++) {
      const cur = path[i];
      const nxt = path[(i + 1) % n];
      const mx = (gx(cur[1]) + gx(nxt[1])) / 2;
      const my = (gy(cur[0]) + gy(nxt[0])) / 2;
      ctx.quadraticCurveTo(gx(cur[1]), gy(cur[0]), mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    if (dotRadius > 0.05) {
      ctx.fillStyle = color;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.beginPath();
          ctx.arc(gx(c), gy(r), dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },
};
