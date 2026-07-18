import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `mughal-jali`. A pierced stone jali: an octagram void at each
// cell plus plus-shaped voids at the grid intersections. pgen filled the panel
// with stone then re-painted the voids in the bg color; per the port rules the
// whole screen is ONE even-odd path — the draw region as the solid outer contour
// with every void as an inner sub-path — so the pierced openings are REAL holes
// that show the layers below (no bg re-paint). The stone screen itself is the
// motif here, not an assumed background.
export const mughalJali: PanelPatternGenerator = {
  name: 'mughal-jali',
  displayName: 'Mughal Jali',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 8, max: 24, step: 0.5, defaultValue: 10 },
    { key: 'web', label: 'Web width (mm)', min: 0.5, max: 4, step: 0.1, defaultValue: 1.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const web = resolveParam(params, this.paramDefs, 'web');
    // octagram outer radius = half-cell minus half the web strut; inner radius
    // 0.414×outer = tan(π/8) for a true octagram (source ratio)
    const outerR = Math.max(0.05, cell * 0.5 - web / 2);
    const innerR = outerR * 0.414;
    const armLen = outerR; // plus-void arm reach at each intersection
    const armT = web * 0.6; // plus-void arm half is armT (full width 2×armT×...)

    ctx.fillStyle = color;
    ctx.beginPath();
    // outer contour: the whole draw region (solid stone)
    ctx.rect(0, 0, widthMm, heightMm);

    // octagram voids, one per cell
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        for (let i = 0; i < 16; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const a = (i / 16) * Math.PI * 2 - Math.PI / 8;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
    // plus-shaped cross voids at the grid intersections (cell corners), drawn as
    // a single 12-vertex polygon each so the void is a clean hole (no self-XOR)
    const t = armT / 2;
    const plus: [number, number][] = [
      [-t, -armLen], [t, -armLen], [t, -t], [armLen, -t],
      [armLen, t], [t, t], [t, armLen], [-t, armLen],
      [-t, t], [-armLen, t], [-armLen, -t], [-t, -t],
    ];
    for (let y = centeredStart(heightMm, cell) + cell / 2; y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell) + cell / 2; x <= widthMm + cell; x += cell) {
        plus.forEach(([dx, dy], i) => {
          if (i === 0) ctx.moveTo(x + dx, y + dy);
          else ctx.lineTo(x + dx, y + dy);
        });
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
  },
};
