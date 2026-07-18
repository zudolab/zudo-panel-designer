import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// source ratio: inner bounding circle is 0.4 x the outer radius (pgen default,
// hardcoded to keep the param count at three).
const INNER_RATIO = 0.4;

// Ported from pgen `steiner-chain`. Per cell: an outer and inner bounding circle
// plus n equally-spaced circles of the Steiner necklace between them (closed-form
// placement — orbit radius = innerR + chainR, chainR = (outerR - innerR)/2).
// pgen's rand() rotation offset is fixed to 0 for determinism; the chain circles
// are stroked in the one fg colour instead of multi-colour fills.
export const steinerChain: PanelPatternGenerator = {
  name: 'steiner-chain',
  displayName: 'Steiner Chain Ring',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 10, max: 45, step: 0.5, defaultValue: 16 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 2, step: 0.05, defaultValue: 0.4 },
    // Number of circles in the necklace.
    { key: 'chainCount', label: 'Chain count', min: 3, max: 12, step: 1, defaultValue: 6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const n = Math.round(resolveParam(params, this.paramDefs, 'chainCount'));
    const outerR = cell * 0.48;
    const innerR = outerR * INNER_RATIO;
    const chainR = (outerR - innerR) / 2;
    const orbitR = innerR + chainR;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < n; i++) {
          const angle = (i / n) * Math.PI * 2;
          const px = cx + Math.cos(angle) * orbitR;
          const py = cy + Math.sin(angle) * orbitR;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.05, chainR), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  },
};
