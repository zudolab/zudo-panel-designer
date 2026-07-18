import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `uroko-scales` (fish/dragon scales). A triangle tessellation
// read as scales. The source alternated two palette colours on the up/down
// triangles; under the single-colour contract that would flood-fill the panel,
// so only the up-pointing triangles are filled — the empty down-pointing gaps
// ARE the negative space (real geometry, no bg paint). Dropped from the source:
// bg fill, colorCount/colorOffset palette cycling. aspect kept as the signature
// knob.
export const urokoScales: PanelPatternGenerator = {
  name: 'uroko-scales',
  displayName: 'Uroko Scales',
  paramDefs: [
    { key: 'width', label: 'Scale width (mm)', min: 4, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'aspect', label: 'Scale aspect', min: 0.6, max: 1.6, step: 0.05, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const triW = resolveParam(params, this.paramDefs, 'width');
    const aspect = resolveParam(params, this.paramDefs, 'aspect');
    const triH = triW * aspect;
    ctx.fillStyle = color;

    for (let y = centeredStart(heightMm, triH); y <= heightMm + triH; y += triH) {
      for (let x = centeredStart(widthMm, triW) - triW; x <= widthMm + triW; x += triW) {
        // Up-pointing triangle: apex at top centre, base along the row bottom.
        // The down-pointing gaps between/below are left unpainted.
        ctx.beginPath();
        ctx.moveTo(x + triW / 2, y);
        ctx.lineTo(x + triW, y + triH);
        ctx.lineTo(x, y + triH);
        ctx.closePath();
        ctx.fill();
      }
    }
  },
};
