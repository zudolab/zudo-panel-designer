import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Plus-shape cell set: centre + four edge midpoints (source ratio, the classic
// Vicsek variant — X-mode/saltire dropped). The mid-edge cells let neighbouring
// tiles connect into one continuous fractal lattice, so no inset is used.
const KEEP: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [0, 1],
  [1, 0],
  [1, 2],
  [2, 1],
];

// Ported from pgen `vicsek-fractal`. pgen centres one fractal on the canvas and
// tints each recursion depth from a shuffled fg pool; here we tile it and fill
// every depth in the one fg colour (dropped: bg fill, per-depth palette
// shuffle, granularity). Negative space is unpainted — real geometry, no bg.
export const vicsekFractal: PanelPatternGenerator = {
  name: 'vicsek-fractal',
  displayName: 'Vicsek Fractal',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 18, max: 40, step: 0.5, defaultValue: 24 },
    // Recursion depth: 5^depth filled squares per tile. Capped at 3 (125 squares)
    // — the iconic plus-of-pluses-of-pluses — so a tiled draw stays light for the
    // shared registry suite; depth 4 would quintuple the fill count per tile.
    { key: 'depth', label: 'Depth', min: 2, max: 3, step: 1, defaultValue: 3 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const depth = Math.round(resolveParam(params, this.paramDefs, 'depth'));
    ctx.fillStyle = color;
    const drawVicsek = (x: number, y: number, s: number, d: number): void => {
      if (d <= 0 || s < 0.3) {
        ctx.fillRect(x, y, s, s);
        return;
      }
      const third = s / 3;
      for (const [col, row] of KEEP) {
        drawVicsek(x + col * third, y + row * third, third, d - 1);
      }
    };
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        drawVicsek(x, y, cell, depth);
      }
    }
  },
};
