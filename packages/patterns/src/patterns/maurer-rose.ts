import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

const DEG = Math.PI / 180;
// Maurer rose is defined over the 360 integer angles theta = d*i degrees; the
// walk closes back on itself at i = 360.
const SAMPLES = 360;

// Ported from pgen `maurer-rose`. Sample the rose r = sin(n*theta) at the
// discrete angles theta = d*i degrees (i = 0..360) and join successive samples
// with straight chords — the chords weave the signature web. Tiled as a
// medallion grid so it reads on tall panels. Dropped: webAlpha (thin
// full-opacity strokes instead), rose-outline pass, layer/degree-step
// randomisation, granularity; n and d are now params.
export const maurerRose: PanelPatternGenerator = {
  name: 'maurer-rose',
  displayName: 'Maurer Rose',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 32, max: 64, step: 0.5, defaultValue: 44 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 2, step: 0.05, defaultValue: 0.3 },
    // n — the rose petal parameter (sin(n*theta)).
    { key: 'petals', label: 'Petal param (n)', min: 2, max: 9, step: 1, defaultValue: 6 },
    // d — chord step in degrees; coprime-ish to 360 makes the dense web.
    { key: 'degreeStep', label: 'Degree step (d)', min: 11, max: 99, step: 2, defaultValue: 29 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const n = Math.round(resolveParam(params, this.paramDefs, 'petals'));
    const d = Math.round(resolveParam(params, this.paramDefs, 'degreeStep'));
    const radius = cell * 0.46; // keep the web inside the cell
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.beginPath();
        for (let i = 0; i <= SAMPLES; i++) {
          const theta = d * i * DEG;
          const r = radius * Math.sin(n * theta);
          const px = cx + r * Math.cos(theta);
          const py = cy + r * Math.sin(theta);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
};
