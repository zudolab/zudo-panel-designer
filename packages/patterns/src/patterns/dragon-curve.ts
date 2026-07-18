import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Heighway dragon turn sequence via the bit-reversal fold rule: turn(n) is a
// left when (n & (lowestBit<<1)) === 0, else a right. Length 2^iter - 1.
function dragonTurns(iter: number): number[] {
  const count = (1 << iter) - 1;
  const turns: number[] = new Array(count);
  for (let n = 1; n <= count; n++) {
    const lowestBit = n & -n;
    turns[n - 1] = (n & (lowestBit << 1)) === 0 ? 1 : -1;
  }
  return turns;
}

// Walk the turtle to collect the dragon polyline plus its bounding box (for
// per-cell auto-fit). Computed once per draw, replayed into every tile.
function dragonPolyline(iter: number): {
  xs: number[];
  ys: number[];
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
} {
  const turns = dragonTurns(iter);
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  let dir = 0;
  let x = 0;
  let y = 0;
  const xs = [x];
  const ys = [y];
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  const step = (turn: number): void => {
    x += dx[dir];
    y += dy[dir];
    xs.push(x);
    ys.push(y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (turn === 1) dir = (dir + 3) % 4;
    else if (turn === -1) dir = (dir + 1) % 4;
  };
  for (let i = 0; i < turns.length; i++) step(turns[i]);
  step(0); // final segment, no turn
  return {
    xs,
    ys,
    minX,
    minY,
    spanX: Math.max(1, maxX - minX),
    spanY: Math.max(1, maxY - minY),
  };
}

// Ported from pgen `dragon-curve`. pgen auto-fits one dragon to the whole canvas
// and cycles the fg pool in colour bands; here we tile the auto-fit dragon into
// square cells so it reads as a pattern on tall panels, in one stroke colour.
// Dropped: bg fill, colour banding, granularity. iterations capped for mm-scale
// line density.
export const dragonCurve: PanelPatternGenerator = {
  name: 'dragon-curve',
  displayName: 'Dragon Curve',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 22, max: 45, step: 0.5, defaultValue: 30 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
    // Fold depth: 2^iter segments. Capped at 8 (256 segments); default 7 (128
    // segments) keeps a tiled draw light for the shared registry suite while
    // still reading as a dragon.
    { key: 'iterations', label: 'Iterations', min: 6, max: 8, step: 1, defaultValue: 7 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const iter = Math.round(resolveParam(params, this.paramDefs, 'iterations'));
    const { xs, ys, minX, minY, spanX, spanY } = dragonPolyline(iter);
    const inner = cell * 0.84;
    const scale = Math.min(inner / spanX, inner / spanY);
    const drawW = spanX * scale;
    const drawH = spanY * scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        // centre the dragon's own bounding box inside the cell
        const baseX = x + (cell - drawW) / 2 - minX * scale;
        const baseY = y + (cell - drawH) / 2 - minY * scale;
        ctx.beginPath();
        for (let i = 0; i < xs.length; i++) {
          const px = baseX + xs[i] * scale;
          const py = baseY + ys[i] * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
};
