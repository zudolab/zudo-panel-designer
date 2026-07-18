import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `endless-knot` (Tibetan ashtamangala). An orthogonal weave
// per tile: a gridN×gridN lattice of strand segments with alternating over/under
// crossings. pgen drew the over/under by stroking bg-colored gaps; on zpd's
// shared layer there is no bg to paint, so each UNDER segment is retracted to
// leave a REAL gap at its crossings — the over segment passes through solid and
// the gap shows the panel base, giving the same over-under reading in one color.
// Every strand shares one width, so all segments accumulate into a single path
// and are stroked once (keeps the primitive count lean on large panels).
function addKnotSegments(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  tile: number,
  gridN: number,
  gap: number,
): void {
  const step = tile / gridN;
  // horizontal strands: over when (row + col) is even
  for (let row = 0; row <= gridN; row++) {
    const y = oy + row * step;
    for (let col = 0; col < gridN; col++) {
      const over = (row + col) % 2 === 0;
      const x1 = ox + col * step;
      const x2 = ox + (col + 1) * step;
      ctx.moveTo(over ? x1 : x1 + gap, y);
      ctx.lineTo(over ? x2 : x2 - gap, y);
    }
  }
  // vertical strands: over when (row + col) is odd (complement of horizontal)
  for (let col = 0; col <= gridN; col++) {
    const x = ox + col * step;
    for (let row = 0; row < gridN; row++) {
      const over = (row + col) % 2 === 1;
      const y1 = oy + row * step;
      const y2 = oy + (row + 1) * step;
      ctx.moveTo(x, over ? y1 : y1 + gap);
      ctx.lineTo(x, over ? y2 : y2 - gap);
    }
  }
}

export const endlessKnot: PanelPatternGenerator = {
  name: 'endless-knot',
  displayName: 'Endless Knot',
  paramDefs: [
    { key: 'tile', label: 'Knot size (mm)', min: 15, max: 40, step: 0.5, defaultValue: 16 },
    { key: 'strandWidth', label: 'Strand width (mm)', min: 0.3, max: 5, step: 0.1, defaultValue: 2 },
    { key: 'gridN', label: 'Weave grid', min: 2, max: 4, step: 1, defaultValue: 4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const tile = resolveParam(params, this.paramDefs, 'tile');
    const strandWidth = resolveParam(params, this.paramDefs, 'strandWidth');
    const gridN = Math.max(2, Math.round(resolveParam(params, this.paramDefs, 'gridN')));
    const step = tile / gridN;
    // retract under-strands by this much at each end (crossing); capped so a
    // visible stub always remains even when the sub-cell is small
    const gap = Math.min(strandWidth * 0.75, step * 0.35);
    ctx.strokeStyle = color;
    ctx.lineWidth = strandWidth;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let y = centeredStart(heightMm, tile); y <= heightMm + tile; y += tile) {
      for (let x = centeredStart(widthMm, tile); x <= widthMm + tile; x += tile) {
        addKnotSegments(ctx, x, y, tile, gridN, gap);
      }
    }
    ctx.stroke();
  },
};
