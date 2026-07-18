import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `astroid-grid`. Four-cusped astroid stars drawn as the
// envelope of a sliding ladder of straight chords: each chord joins
// (cx + r*cos t, cy) to (cx, cy + r*sin t); as t sweeps 0..2pi the chords trace
// all four concave arms. Single stroke colour (dropped: bg fill, per-cell fg
// pool cycling, granularity). r ratio 0.48 kept from source.
export const astroidGrid: PanelPatternGenerator = {
  name: 'astroid-grid',
  displayName: 'Astroid Star Grid',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 10, max: 25, step: 0.5, defaultValue: 13 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 2, step: 0.05, defaultValue: 0.3 },
    // Chords per star — the string-art density knob.
    { key: 'lineCount', label: 'Chord count', min: 8, max: 28, step: 1, defaultValue: 18 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const count = Math.round(resolveParam(params, this.paramDefs, 'lineCount'));
    const r = cell * 0.48; // source ratio: star radius 0.48 x cell
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.beginPath();
        for (let i = 0; i <= count; i++) {
          const t = (i / count) * Math.PI * 2;
          ctx.moveTo(cx + r * Math.cos(t), cy);
          ctx.lineTo(cx, cy + r * Math.sin(t));
        }
        ctx.stroke();
      }
    }
  },
};
