import type { PanelPatternGenerator } from '../types';
import { resolveParam } from '../param-utils';

// Ported from pgen `ammann-bars` (see .claude/skills/port-pgen-patterns/). Four
// families of straight ruling lines at 0/45/90/135°, each walked with an
// alternating Fibonacci long/short gap (short/long ≈ 1/φ) — the aperiodic
// "musical sequence" that underlies octagonal quasicrystal order. Already a
// single-color line pattern in the source; the pgen rand was consumed only for
// PRNG stability, so it is dropped and the walk is fully deterministic. The
// panel clip owns the line extents (source ratios kept: line width 0.07×spacing).
export const ammannBars: PanelPatternGenerator = {
  name: 'ammann-bars',
  displayName: 'Ammann Bar Grid',
  paramDefs: [
    { key: 'spacing', label: 'Bar spacing (mm)', min: 2, max: 12, step: 0.5, defaultValue: 3.5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const spacing = resolveParam(params, this.paramDefs, 'spacing');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const phi = (1 + Math.sqrt(5)) / 2;
    const shortGap = spacing;
    const longGap = spacing * phi;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const cxc = widthMm / 2;
    const cyc = heightMm / 2;
    const diagonal = Math.sqrt(widthMm * widthMm + heightMm * heightMm);
    const extent = diagonal / 2 + longGap * 2;
    const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
    for (const angle of angles) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const perpCos = Math.cos(angle + Math.PI / 2);
      const perpSin = Math.sin(angle + Math.PI / 2);
      let offset = -extent;
      let step = 0;
      while (offset <= extent) {
        const lx = cxc + offset * perpCos;
        const ly = cyc + offset * perpSin;
        ctx.beginPath();
        ctx.moveTo(lx - diagonal * cos, ly - diagonal * sin);
        ctx.lineTo(lx + diagonal * cos, ly + diagonal * sin);
        ctx.stroke();
        offset += step % 2 === 0 ? longGap : shortGap;
        step++;
      }
    }
  },
};
