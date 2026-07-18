import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `eight-point-compass-star-grid` (see .claude/skills/port-pgen-patterns/).
// A lattice of 8-pointed compass stars, each a filled polygon of 16 vertices
// alternating between the outer (long) and inner (short) ray radii. Dropped from
// the source: bg fill and the fg-pool color cycling — one flat fill color. The
// long/short ray ratio stays a param.
export const eightPointCompassStarGrid: PanelPatternGenerator = {
  name: 'eight-point-compass-star-grid',
  displayName: 'Eight Point Compass Star Grid',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'innerRatio', label: 'Short ray ratio', min: 0.2, max: 0.6, step: 0.01, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const innerRatio = resolveParam(params, this.paramDefs, 'innerRatio');
    // source ratio: outer (long ray) radius = 0.46×cell.
    const outer = cell * 0.46;
    const inner = outer * innerRatio;
    const points = 8;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
          const r = i % 2 === 0 ? outer : inner;
          const a = (Math.PI * i) / points - Math.PI / 2;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  },
};
