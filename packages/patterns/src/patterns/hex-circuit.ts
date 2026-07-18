import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart, hash01 } from '../param-utils';

// Ported from pgen `hex-circuit` (see .claude/skills/port-pgen-patterns/). Copper
// traces routed along the edges of a pointy-top hex lattice with a node dot at
// each center; each hex lights a deterministic subset of its six edges. Dropped
// from the source: bg fill, the fg-pool color cycling, and the lighten() on the
// node dots — one flat color. The seeded per-edge rand() became hash01 on
// panel-center-origin cell indices (stable under panel resize).
export const hexCircuit: PanelPatternGenerator = {
  name: 'hex-circuit',
  displayName: 'Hex Circuit',
  paramDefs: [
    { key: 'hexRadius', label: 'Hex radius (mm)', min: 3, max: 16, step: 0.5, defaultValue: 5 },
    { key: 'traceWidth', label: 'Trace width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
    { key: 'traceCoverage', label: 'Trace coverage', min: 0.3, max: 1, step: 0.05, defaultValue: 0.7 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'hexRadius');
    const traceWidth = resolveParam(params, this.paramDefs, 'traceWidth');
    const traceCoverage = resolveParam(params, this.paramDefs, 'traceCoverage');
    const hexW = Math.sqrt(3) * r;
    const vSpacing = 1.5 * r; // 0.75 × hexH, the pointy-top row pitch
    // source ratio: node dot radius = 0.16×r.
    const nodeR = Math.max(0.3, r * 0.16);

    // Pointy-top hexagon vertex offsets.
    const verts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 90);
      verts.push([r * Math.cos(ang), r * Math.sin(ang)]);
    }

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = traceWidth;
    ctx.lineCap = 'round';

    for (let y = centeredStart(heightMm, vSpacing); y <= heightMm + vSpacing; y += vSpacing) {
      const iy = Math.round((y - heightMm / 2) / vSpacing);
      const rowShift = iy & 1 ? hexW / 2 : 0;
      for (let x = centeredStart(widthMm, hexW); x <= widthMm + hexW; x += hexW) {
        const ix = Math.round((x - widthMm / 2) / hexW);
        const cx = x + rowShift;
        const cy = y;
        for (let e = 0; e < 6; e++) {
          if (hash01(ix, iy, e) >= traceCoverage) continue;
          const a = verts[e];
          const b = verts[(e + 1) % 6];
          ctx.beginPath();
          ctx.moveTo(cx + a[0], cy + a[1]);
          ctx.lineTo(cx + b[0], cy + b[1]);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, nodeR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
