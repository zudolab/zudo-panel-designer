import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `cairo-pentagonal` (see .claude/skills/port-pgen-patterns/).
// The Cairo street paving: a square super-cell holding four irregular convex
// pentagons in two perpendicular pairs around the cell center. Per the porting
// note the four-color fills become stroked pentagon outlines (no painted bg).
// Dropped: bg fill, the four fg colors and the colorOffset; the source's per-cell
// rand() was only consumed for PRNG stability, so it is gone entirely.
export const cairoPentagonal: PanelPatternGenerator = {
  name: 'cairo-pentagonal',
  displayName: 'Cairo Pentagonal',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 7, max: 30, step: 0.5, defaultValue: 10 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const P = resolveParam(params, this.paramDefs, 'cell');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const h = P / 2;
    const a = P * 0.28; // source ratio: inner apex offset from the cell center
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    const poly = (pts: [number, number][]): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();
    };
    for (let oy = centeredStart(heightMm, P); oy <= heightMm + P; oy += P) {
      for (let ox = centeredStart(widthMm, P); ox <= widthMm + P; ox += P) {
        const cx = ox + h;
        const cy = oy + h;
        const top: [number, number] = [cx, oy];
        const bot: [number, number] = [cx, oy + P];
        const lef: [number, number] = [ox, cy];
        const rig: [number, number] = [ox + P, cy];
        const apN: [number, number] = [cx, cy - a];
        const apS: [number, number] = [cx, cy + a];
        const apW: [number, number] = [cx - a, cy];
        const apE: [number, number] = [cx + a, cy];
        poly([[ox, oy], top, [ox + P, oy], apE, apN]); // north
        poly([[ox + P, oy], rig, [ox + P, oy + P], apS, apE]); // east
        poly([[ox + P, oy + P], bot, [ox, oy + P], apW, apS]); // south
        poly([[ox, oy + P], lef, [ox, oy], apN, apW]); // west
      }
    }
  },
};
