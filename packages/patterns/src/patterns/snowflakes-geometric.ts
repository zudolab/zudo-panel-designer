import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Stroke one 6-fold geometric snowflake centered at (cx, cy) with arm length
// `len`: six radial spines, each carrying one symmetric side-branch pair.
// Branch position/length are fixed constants (the source's per-seed
// randomization is dropped), kept crisp with straight segments at tile scale.
function snowflakePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  len: number,
): void {
  ctx.beginPath();
  // source-style ratios: branch pair at 0.55 of the spine, length 0.3×spine.
  const t = 0.55;
  const b = 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const px = -uy; // perpendicular unit vector for the side branches
    const py = ux;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ux * len, cy + uy * len);
    const bx = cx + ux * len * t;
    const by = cy + uy * len * t;
    const bl = len * b;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (ux + px) * bl * 0.7071, by + (uy + py) * bl * 0.7071);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (ux - px) * bl * 0.7071, by + (uy - py) * bl * 0.7071);
  }
}

// Ported from pgen `snowflakes-geometric` (see .claude/skills/port-pgen-patterns/).
// A brick-offset grid of 6-fold line-art snowflakes. Dropped from the source: bg
// fill, the fg-pool color cycling, and the seed-randomized param defaults — one
// flat stroke color and fixed frond geometry per the zpd contract.
export const snowflakesGeometric: PanelPatternGenerator = {
  name: 'snowflakes-geometric',
  displayName: 'Snowflakes Geometric',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 8, max: 24, step: 0.5, defaultValue: 9 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 2, step: 0.05, defaultValue: 0.4 },
    { key: 'flakeSize', label: 'Flake size', min: 0.2, max: 0.6, step: 0.01, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const flakeSize = resolveParam(params, this.paramDefs, 'flakeSize');
    const len = cell * flakeSize;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Flakes reach `len` (≤ 0.6 pitch) past their center, so the base
    // centeredStart overscan already covers the edges (brick rows included).
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      const iy = Math.round((y - heightMm / 2) / cell);
      const rowShift = iy & 1 ? cell / 2 : 0;
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        snowflakePath(ctx, x + cell / 2 + rowShift, y + cell / 2, len);
        ctx.stroke();
      }
    }
  },
};
