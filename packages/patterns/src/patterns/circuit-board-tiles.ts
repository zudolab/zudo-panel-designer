import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart, hash01 } from '../param-utils';

// Ported from pgen `circuit-board-tiles` (see .claude/skills/port-pgen-patterns/).
// Wang-style trace tiles: each cell routes copper from its center out to a
// deterministic subset of its four edge midpoints, so adjacent tiles join into
// continuous PCB traces, with a solder pad at junctions. Dropped from the
// source: bg fill and the fg-pool color cycling — one flat color. The per-cell
// rand() edge mask and pad roll became hash01 on panel-center-origin cell
// indices (stable under panel resize).
export const circuitBoardTiles: PanelPatternGenerator = {
  name: 'circuit-board-tiles',
  displayName: 'Circuit Board Tiles',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 18, step: 0.5, defaultValue: 6 },
    { key: 'traceWidth', label: 'Trace width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.8 },
    { key: 'padChance', label: 'Pad chance', min: 0, max: 1, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const traceWidth = resolveParam(params, this.paramDefs, 'traceWidth');
    const padChance = resolveParam(params, this.paramDefs, 'padChance');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = traceWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const half = cell / 2;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + half;
        const cy = y + half;
        const ix = Math.round((cx - widthMm / 2) / cell);
        const iy = Math.round((cy - heightMm / 2) / cell);
        // source threshold: an edge connects when its hash < 0.6.
        const edges: [number, number][] = [
          [cx, y], // top
          [x + cell, cy], // right
          [cx, y + cell], // bottom
          [x, cy], // left
        ];
        let connected = 0;
        for (let e = 0; e < 4; e++) {
          if (hash01(ix, iy, e) >= 0.6) continue;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(edges[e][0], edges[e][1]);
          ctx.stroke();
          connected++;
        }
        // Pad at the center when this is a junction or by chance.
        if (connected >= 3 || hash01(ix, iy, 4) < padChance) {
          ctx.beginPath();
          ctx.arc(cx, cy, traceWidth * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },
};
