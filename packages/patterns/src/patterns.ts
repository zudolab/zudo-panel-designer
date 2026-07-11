// The ~dozen built-in panel patterns plus the hand-listed registry. Each draws
// in panel-mm space (see types.ts). Lattices are centered on the panel and
// overscan past its edges so they read as intentional at any panel size, and
// every draw is deterministic (no Math.random).

import type { PanelPatternGenerator, PatternParamDef } from './types';

// Resolve a param: fall back to the def's default when missing/non-finite, then
// clamp into [min,max]. Clamping is not just cosmetic — it guarantees positive
// pitches/counts, which keeps the draw loops below finite even if a caller
// passes a stale, zero, or negative value.
function resolveParam(
  params: Record<string, number>,
  defs: PatternParamDef[],
  key: string,
): number {
  const def = defs.find((d) => d.key === key);
  if (!def) return 0;
  const raw = params[key];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : def.defaultValue;
  return Math.min(def.max, Math.max(def.min, value));
}

// Lowest lattice coordinate to start iterating from so the tiling is centered on
// the panel (one tick lands on span/2) and overscans below 0. Pair with a loop
// bound of `span + pitch` to also overscan the far edge.
function centeredStart(span: number, pitch: number): number {
  const half = span / 2;
  return half - Math.ceil(half / pitch + 1) * pitch;
}

const dotGrid: PanelPatternGenerator = {
  name: 'dot-grid',
  displayName: 'Dot Grid',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'radius', label: 'Dot radius (mm)', min: 0.2, max: 4, step: 0.1, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const radius = resolveParam(params, this.paramDefs, 'radius');
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};

const diagStripes: PanelPatternGenerator = {
  name: 'diag-stripes',
  displayName: 'Diagonal Stripes',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Stripe width (mm)', min: 0.3, max: 10, step: 0.1, defaultValue: 2 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const diag = widthMm + heightMm;
    for (let offset = -diag; offset < diag * 2; offset += pitch) {
      ctx.beginPath();
      ctx.moveTo(offset, -1);
      ctx.lineTo(offset - heightMm - 2, heightMm + 1);
      ctx.stroke();
    }
  },
};

const gridLines: PanelPatternGenerator = {
  name: 'grid-lines',
  displayName: 'Grid Lines',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
      ctx.beginPath();
      ctx.moveTo(x, -1);
      ctx.lineTo(x, heightMm + 1);
      ctx.stroke();
    }
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      ctx.beginPath();
      ctx.moveTo(-1, y);
      ctx.lineTo(widthMm + 1, y);
      ctx.stroke();
    }
  },
};

const concentricCircles: PanelPatternGenerator = {
  name: 'concentric-circles',
  displayName: 'Concentric Circles',
  paramDefs: [
    { key: 'pitch', label: 'Ring pitch (mm)', min: 1, max: 15, step: 0.5, defaultValue: 4 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 4, step: 0.05, defaultValue: 0.6 },
    { key: 'centerY', label: 'Center Y (0-1)', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * resolveParam(params, this.paramDefs, 'centerY');
    const cx = widthMm / 2;
    const maxR = Math.hypot(Math.max(cx, widthMm - cx), Math.max(cy, heightMm - cy));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let r = pitch; r <= maxR; r += pitch) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};

const hexLattice: PanelPatternGenerator = {
  name: 'hex-lattice',
  displayName: 'Hex Lattice',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 2, max: 20, step: 0.5, defaultValue: 6 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const r = resolveParam(params, this.paramDefs, 'cell') / 2;
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const w = Math.sqrt(3) * r; // flat-to-flat width of a pointy-top hexagon
    const vStep = 1.5 * r;
    let row = 0;
    for (let y = centeredStart(heightMm, vStep); y <= heightMm + vStep; y += vStep, row += 1) {
      const xOffset = row % 2 === 0 ? 0 : w / 2;
      for (let x = centeredStart(widthMm, w) + xOffset; x <= widthMm + w; x += w) {
        ctx.beginPath();
        for (let i = 0; i <= 6; i += 1) {
          const angle = (Math.PI / 3) * i + Math.PI / 6;
          const px = x + r * Math.cos(angle);
          const py = y + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  },
};

const checker: PanelPatternGenerator = {
  name: 'checker',
  displayName: 'Checker',
  paramDefs: [{ key: 'cell', label: 'Cell size (mm)', min: 1, max: 20, step: 0.5, defaultValue: 5 }],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    ctx.fillStyle = color;
    let row = 0;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell, row += 1) {
      let col = 0;
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell, col += 1) {
        if ((row + col) % 2 === 0) ctx.fillRect(x, y, cell, cell);
      }
    }
  },
};

const waveLines: PanelPatternGenerator = {
  name: 'wave-lines',
  displayName: 'Wave Lines',
  paramDefs: [
    { key: 'pitch', label: 'Row pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'amplitude', label: 'Amplitude (mm)', min: 0.5, max: 8, step: 0.25, defaultValue: 1.5 },
    { key: 'wavelength', label: 'Wavelength (mm)', min: 3, max: 30, step: 1, defaultValue: 12 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const amp = resolveParam(params, this.paramDefs, 'amplitude');
    const wl = resolveParam(params, this.paramDefs, 'wavelength');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const cx = widthMm / 2; // anchor the sine phase to the panel center
    for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
      ctx.beginPath();
      for (let x = -wl; x <= widthMm + wl; x += 0.5) {
        const py = y + Math.sin(((x - cx) / wl) * Math.PI * 2) * amp;
        if (x === -wl) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
  },
};

const crosshatch: PanelPatternGenerator = {
  name: 'crosshatch',
  displayName: 'Crosshatch',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 4, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const diag = widthMm + heightMm;
    for (let offset = -diag; offset < diag * 2; offset += pitch) {
      ctx.beginPath();
      ctx.moveTo(offset, -1);
      ctx.lineTo(offset - heightMm - 2, heightMm + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset - heightMm - 2, -1);
      ctx.lineTo(offset, heightMm + 1);
      ctx.stroke();
    }
  },
};

const radialBurst: PanelPatternGenerator = {
  name: 'radial-burst',
  displayName: 'Radial Burst',
  paramDefs: [
    { key: 'count', label: 'Ray count', min: 8, max: 96, step: 2, defaultValue: 36 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
    { key: 'centerY', label: 'Center Y (0-1)', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
    { key: 'innerRadius', label: 'Inner radius (mm)', min: 0, max: 30, step: 0.5, defaultValue: 4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const count = Math.round(resolveParam(params, this.paramDefs, 'count'));
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * resolveParam(params, this.paramDefs, 'centerY');
    const inner = resolveParam(params, this.paramDefs, 'innerRadius');
    const cx = widthMm / 2;
    const maxR = Math.hypot(widthMm, heightMm);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      ctx.beginPath();
      ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
      ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
      ctx.stroke();
    }
  },
};

const brick: PanelPatternGenerator = {
  name: 'brick',
  displayName: 'Brick',
  paramDefs: [
    { key: 'brickW', label: 'Brick width (mm)', min: 3, max: 30, step: 0.5, defaultValue: 12 },
    { key: 'brickH', label: 'Brick height (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.4 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const bw = resolveParam(params, this.paramDefs, 'brickW');
    const bh = resolveParam(params, this.paramDefs, 'brickH');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    let row = 0;
    for (let y = centeredStart(heightMm, bh); y <= heightMm + bh; y += bh, row += 1) {
      // running-bond: alternate rows shift by half a brick
      const offset = row % 2 === 0 ? 0 : bw / 2;
      ctx.beginPath();
      ctx.moveTo(-1, y);
      ctx.lineTo(widthMm + 1, y);
      ctx.stroke();
      for (let x = centeredStart(widthMm, bw) + offset; x <= widthMm + bw; x += bw) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + bh);
        ctx.stroke();
      }
    }
  },
};

const diamondLattice: PanelPatternGenerator = {
  name: 'diamond-lattice',
  displayName: 'Diamond Lattice',
  paramDefs: [
    { key: 'size', label: 'Diamond size (mm)', min: 3, max: 30, step: 0.5, defaultValue: 8 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const size = resolveParam(params, this.paramDefs, 'size');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    // Diamonds (half-diagonal = size/2) on a checkerboard of centers stepped by
    // size/2: base + interstitial sublattices share edges, so the field
    // tessellates seamlessly (argyle) instead of leaving corner-touching holes.
    const h = size / 2;
    let row = 0;
    for (let cy = centeredStart(heightMm, h); cy <= heightMm + h; cy += h, row += 1) {
      let col = 0;
      for (let cx = centeredStart(widthMm, h); cx <= widthMm + h; cx += h, col += 1) {
        if ((row + col) % 2 !== 0) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy - h);
        ctx.lineTo(cx + h, cy);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx - h, cy);
        ctx.closePath();
        ctx.stroke();
      }
    }
  },
};

const scallops: PanelPatternGenerator = {
  name: 'scallops',
  displayName: 'Scallops',
  paramDefs: [
    { key: 'width', label: 'Scallop width (mm)', min: 3, max: 30, step: 0.5, defaultValue: 10 },
    { key: 'lineWidth', label: 'Line width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 0.5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const scallopW = resolveParam(params, this.paramDefs, 'width');
    const lineWidth = resolveParam(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const r = scallopW / 2;
    const rowStep = r; // rows nest at half the arc span like fish scales
    let row = 0;
    for (let y = centeredStart(heightMm, rowStep); y <= heightMm + rowStep; y += rowStep, row += 1) {
      const offset = row % 2 === 0 ? 0 : r;
      for (let x = centeredStart(widthMm, scallopW) + offset; x <= widthMm + scallopW; x += scallopW) {
        ctx.beginPath();
        ctx.arc(x + r, y, r, 0, Math.PI); // lower semicircle
        ctx.stroke();
      }
    }
  },
};

// Hand-listed registry — no codegen. 'dot-grid' MUST stay first / by that exact
// name (the core default document references it).
export const PATTERN_GENERATORS: PanelPatternGenerator[] = [
  dotGrid,
  diagStripes,
  gridLines,
  concentricCircles,
  hexLattice,
  checker,
  waveLines,
  crosshatch,
  radialBurst,
  brick,
  diamondLattice,
  scallops,
];

export function patternByName(name: string): PanelPatternGenerator | undefined {
  return PATTERN_GENERATORS.find((g) => g.name === name);
}

export function defaultParams(name: string): Record<string, number> {
  const gen = patternByName(name);
  if (!gen) return {};
  return Object.fromEntries(gen.paramDefs.map((d) => [d.key, d.defaultValue]));
}
