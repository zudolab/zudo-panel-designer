import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `valknut-grid` (see .claude/skills/port-pgen-patterns/). A
// grid of Norse valknut motifs — three interlinked equilateral triangles per
// tile. The source faked the over-under weave with a bg-halo pass; that is
// forbidden here (no painted bg), so per the porting note the strands cross
// plainly: three stroked triangle outlines in one flat color. Dropped: bg fill,
// the bg-halo pass, per-cell rand() color and the darken() accent triangle.
export const valknutGrid: PanelPatternGenerator = {
  name: 'valknut-grid',
  displayName: 'Valknut Grid',
  paramDefs: [
    { key: 'tile', label: 'Tile size (mm)', min: 7, max: 20, step: 0.5, defaultValue: 10 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.8 },
    { key: 'spread', label: 'Triangle spread', min: 0.1, max: 0.35, step: 0.01, defaultValue: 0.2 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const tile = resolveParam(params, this.paramDefs, 'tile');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const spread = resolveParam(params, this.paramDefs, 'spread');
    const radius = tile * 0.42; // source ratio: triangle circumradius
    const offset = tile * spread; // source ratio: how far the three triangles fan out
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Vertices of an upright equilateral triangle centred at (cx, cy).
    const strokeTri = (cx: number, cy: number): void => {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
        const px = cx + Math.cos(a) * radius;
        const py = cy + Math.sin(a) * radius;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    };
    for (let y = centeredStart(heightMm, tile) - tile; y <= heightMm + tile; y += tile) {
      for (let x = centeredStart(widthMm, tile) - tile; x <= widthMm + tile; x += tile) {
        const cx = x + tile / 2;
        const cy = y + tile / 2;
        // three triangle centres fanned around the tile center (source layout)
        strokeTri(cx, cy - offset);
        strokeTri(cx - offset * 0.87, cy + offset * 0.5);
        strokeTri(cx + offset * 0.87, cy + offset * 0.5);
      }
    }
  },
};
