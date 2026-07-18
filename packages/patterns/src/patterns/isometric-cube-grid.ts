import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `isometric-cube-grid` (see .claude/skills/port-pgen-patterns/).
// Three rule families — +30°, −30° and vertical — weaving the classic isometric
// cube lattice. Dropped from the source: bg fill and the three separate seeded
// family colors (collapsed to one flat stroke). Each family is centred on the
// panel center and spans a range wide enough to cover the whole rect.
export const isometricCubeGrid: PanelPatternGenerator = {
  name: 'isometric-cube-grid',
  displayName: 'Isometric Cube Grid',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 3, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const slope = Math.tan((30 * Math.PI) / 180); // isometric 30° rise
    // Diagonal families are indexed by their y-intercept b (at x=0); iterate b
    // symmetrically about the panel-center line so a resize re-centres cleanly.
    const half = Math.ceil((heightMm + slope * widthMm) / (2 * cell)) + 2;
    const bMidA = heightMm / 2 - slope * (widthMm / 2);
    const bMidB = heightMm / 2 + slope * (widthMm / 2);
    for (let i = -half; i <= half; i++) {
      const bA = bMidA + i * cell;
      ctx.beginPath();
      ctx.moveTo(0, bA);
      ctx.lineTo(widthMm, slope * widthMm + bA);
      ctx.stroke();
      const bB = bMidB + i * cell;
      ctx.beginPath();
      ctx.moveTo(0, bB);
      ctx.lineTo(widthMm, -slope * widthMm + bB);
      ctx.stroke();
    }
    for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightMm);
      ctx.stroke();
    }
  },
};
