import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `sayagata` (interlocking Buddhist key-fret / manji lattice).
// Each cell carries an L-armed manji glyph, drawn as continuous polylines whose
// arms reach toward neighbours to read as the woven key-fret band. Dropped from
// the source: bg fill and fg-pool colour cycling (colorOffset). armReach kept
// as a source constant (0.7).
const ARM_REACH = 0.7; // source default: fret arm length relative to the cell

export const sayagata: PanelPatternGenerator = {
  name: 'sayagata',
  displayName: 'Sayagata',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 4, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    const a = cell * ARM_REACH * 0.5; // half-arm length
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      const cy = y + cell / 2;
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        // Manji glyph: a plus with each arm bent 90 degrees, drawn as continuous
        // polylines so neighbouring cells visually link.
        ctx.beginPath();
        ctx.moveTo(cx + a, cy - a); // up arm bent right
        ctx.lineTo(cx, cy - a);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + a, cy); // right arm bent down
        ctx.lineTo(cx + a, cy + a);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - a, cy); // left arm bent up
        ctx.lineTo(cx - a, cy - a);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + a); // down arm bent left
        ctx.lineTo(cx - a, cy + a);
        ctx.stroke();
      }
    }
  },
};
