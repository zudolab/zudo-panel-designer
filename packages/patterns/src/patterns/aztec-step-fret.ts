import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `aztec-step-fret`. Interlocking stepped spirals
// (xicalcoliuhqui) built from filled blocks; bands alternate orientation row to
// row. pgen drew banded backgrounds and cycled per-band/per-cell palette colors;
// per the port rules the banded bg and color cycling are dropped — every fret is
// the single foreground color, the alternating up/down orientation alone giving
// the interlock. The pgen flip used ctx.scale(1,-1); here it is folded into the
// coordinate math (generators must not transform the ctx themselves).
export const aztecStepFret: PanelPatternGenerator = {
  name: 'aztec-step-fret',
  displayName: 'Aztec Step Fret',
  paramDefs: [
    { key: 'stepUnit', label: 'Step unit (mm)', min: 1.3, max: 4, step: 0.1, defaultValue: 1.5 },
    { key: 'steps', label: 'Spiral steps', min: 2, max: 5, step: 1, defaultValue: 3 },
    { key: 'armThickness', label: 'Arm thickness (mm)', min: 0.3, max: 2.5, step: 0.05, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const u = resolveParam(params, this.paramDefs, 'stepUnit');
    const steps = Math.round(resolveParam(params, this.paramDefs, 'steps'));
    const t = resolveParam(params, this.paramDefs, 'armThickness');
    const block = u * (steps * 2 + 1); // motif occupies a square block of this side
    ctx.fillStyle = color;

    const fret = (bx: number, by: number, flip: boolean): void => {
      // emit a fillRect in block-local coords, mirroring vertically when flipped
      const emit = (lx: number, ly: number, w: number, h: number): void => {
        const ay = flip ? block - (ly + h) : ly;
        ctx.fillRect(bx + lx, by + ay, w, h);
      };
      // ascending staircase: a horizontal tread + a vertical riser per step
      for (let s = 0; s < steps; s++) {
        const x = s * 2 * u;
        emit(x, block - 2 * u - s * 2 * u, 2 * u + t, t);
        emit(x, block - (s + 1) * 2 * u, t, 2 * u);
      }
      // the inward hook (spiral terminus) at the top of the staircase
      const hx = steps * 2 * u;
      const hy = block - steps * 2 * u;
      emit(hx, hy, u + t, t);
      emit(hx + u, hy, t, u + t);
      emit(hx, hy + u, u + t, t);
    };

    for (let by = centeredStart(heightMm, block); by <= heightMm + block; by += block) {
      const r = Math.round((by - heightMm / 2) / block);
      const flip = (((r % 2) + 2) % 2) === 1;
      for (let bx = centeredStart(widthMm, block); bx <= widthMm + block; bx += block) {
        fret(bx, by, flip);
      }
    }
  },
};
