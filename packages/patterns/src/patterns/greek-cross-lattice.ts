import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `greek-cross-lattice` (see .claude/skills/port-pgen-patterns/).
// A dense lattice of equal-armed Greek crosses, each two overlapping fillRect
// bars. Dropped from the source: bg fill and the single rand() color pick — one
// flat fill. The arm thickness stays the source's 0.5×arm-span ratio.
export const greekCrossLattice: PanelPatternGenerator = {
  name: 'greek-cross-lattice',
  displayName: 'Greek Cross Lattice',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'armLength', label: 'Arm length', min: 0.3, max: 0.48, step: 0.01, defaultValue: 0.42 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const armLength = resolveParam(params, this.paramDefs, 'armLength');
    const span = cell * armLength; // arm half-length from cross center
    const thick = span * 0.5; // source ratio: arm thickness = 0.5×arm span
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell * 0.5;
        const cy = y + cell * 0.5;
        ctx.fillRect(cx - thick * 0.5, cy - span, thick, span * 2);
        ctx.fillRect(cx - span, cy - thick * 0.5, span * 2, thick);
      }
    }
  },
};
