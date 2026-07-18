import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `masu-tsunagi` (see .claude/skills/port-pgen-patterns/). Linked
// measuring boxes: each grid cell holds a stack of concentric strokeRect squares,
// tiling edge-to-edge into an interlocking box lattice. Dropped from the source:
// bg fill and the per-ring fg color cycling / colorOffset — one flat stroke.
export const masuTsunagi: PanelPatternGenerator = {
  name: 'masu-tsunagi',
  displayName: 'Masu Tsunagi',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 5, max: 30, step: 0.5, defaultValue: 8 },
    { key: 'nestCount', label: 'Nested squares', min: 2, max: 6, step: 1, defaultValue: 3 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const nestCount = Math.round(resolveParam(params, this.paramDefs, 'nestCount'));
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'miter';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        for (let k = 0; k < nestCount; k++) {
          // source ratio: rings shrink to 0.95×half at the outer edge, stepped inward
          const half = (cell / 2) * (1 - k / nestCount) * 0.95;
          if (half < lineWidth) break;
          ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        }
      }
    }
  },
};
