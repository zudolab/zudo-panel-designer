import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `herringbone` (see .claude/skills/port-pgen-patterns/). The
// V-zigzag parquet of interlocking bricks: each unit lays two horizontal + two
// vertical bricks whose neighbours nest into the gaps. Dropped from the source:
// bg fill, per-brick color variation and the highlight/shadow edge strokes —
// one flat fill, with the inter-brick gap left as real negative space (the
// "bg gap lines" of the source read as unpainted space here, never a painted bg).
export const herringbone: PanelPatternGenerator = {
  name: 'herringbone',
  displayName: 'Herringbone',
  paramDefs: [
    { key: 'brickLength', label: 'Brick length (mm)', min: 4, max: 30, step: 0.5, defaultValue: 7 },
    { key: 'brickWidth', label: 'Brick width (mm)', min: 2, max: 12, step: 0.5, defaultValue: 2.5 },
    { key: 'gap', label: 'Gap (mm)', min: 0, max: 2, step: 0.1, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const L = resolveParam(params, this.paramDefs, 'brickLength');
    const W = resolveParam(params, this.paramDefs, 'brickWidth');
    const gap = resolveParam(params, this.paramDefs, 'gap');
    ctx.fillStyle = color;
    // Unit tile: one V of four bricks. unitW/unitH are the source's repeat steps;
    // bricks reach past their own unit into neighbours (that overlap is what
    // interlocks the weave), so the loop overscans generously in both axes.
    const unitW = L + W;
    const unitH = 2 * W;
    const g = gap / 2;
    const brick = (bx: number, by: number, bw: number, bh: number): void => {
      const w = bw - gap;
      const h = bh - gap;
      if (w > 0 && h > 0) ctx.fillRect(bx + g, by + g, w, h);
    };
    for (let y = centeredStart(heightMm, unitH) - unitH; y <= heightMm + unitH; y += unitH) {
      for (let x = centeredStart(widthMm, unitW) - unitW; x <= widthMm + unitW; x += unitW) {
        brick(x, y, L, W); // horizontal, top of the V
        brick(x + L, y, W, L); // vertical, right of the horizontal
        brick(x + W, y + W, L, W); // horizontal, shifted V below
        brick(x + W + L, y + W, W, L); // vertical, below-right
      }
    }
  },
};
