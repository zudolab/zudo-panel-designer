// Pattern generators draw in mm space: the ctx is pre-scaled so 1 unit = 1mm
// and pre-clipped to the panel rect. Same contract shape as pgen's
// PatternGenerator, shrunk: fixed palette color passed in, params in mm.

export interface PatternParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface DrawOptions {
  widthMm: number;
  heightMm: number;
  color: string;
  params: Record<string, number>;
}

export interface PanelPatternGenerator {
  name: string;
  displayName: string;
  paramDefs: PatternParamDef[];
  draw(ctx: CanvasRenderingContext2D, opts: DrawOptions): void;
}

function param(params: Record<string, number>, defs: PatternParamDef[], key: string): number {
  const def = defs.find((d) => d.key === key);
  const fallback = def ? def.defaultValue : 0;
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const dotGrid: PanelPatternGenerator = {
  name: 'dot-grid',
  displayName: 'Dot Grid',
  paramDefs: [
    { key: 'pitch', label: 'Pitch (mm)', min: 2, max: 15, step: 0.5, defaultValue: 5 },
    { key: 'radius', label: 'Dot radius (mm)', min: 0.2, max: 4, step: 0.1, defaultValue: 1 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = param(params, this.paramDefs, 'pitch');
    const radius = param(params, this.paramDefs, 'radius');
    ctx.fillStyle = color;
    for (let y = pitch / 2; y < heightMm + pitch; y += pitch) {
      for (let x = pitch / 2; x < widthMm + pitch; x += pitch) {
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
    const pitch = param(params, this.paramDefs, 'pitch');
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
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
    const pitch = param(params, this.paramDefs, 'pitch');
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let x = 0; x <= widthMm + pitch; x += pitch) {
      ctx.beginPath();
      ctx.moveTo(x, -1);
      ctx.lineTo(x, heightMm + 1);
      ctx.stroke();
    }
    for (let y = 0; y <= heightMm + pitch; y += pitch) {
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
    const pitch = param(params, this.paramDefs, 'pitch');
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * param(params, this.paramDefs, 'centerY');
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
    const r = param(params, this.paramDefs, 'cell') / 2;
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const w = Math.sqrt(3) * r;
    const vStep = 1.5 * r;
    let row = 0;
    for (let y = -r; y < heightMm + r * 2; y += vStep, row += 1) {
      const xOffset = row % 2 === 0 ? 0 : w / 2;
      for (let x = -w + xOffset; x < widthMm + w; x += w) {
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
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 1, max: 20, step: 0.5, defaultValue: 5 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = param(params, this.paramDefs, 'cell');
    ctx.fillStyle = color;
    for (let row = 0; row * cell < heightMm + cell; row += 1) {
      for (let col = 0; col * cell < widthMm + cell; col += 1) {
        if ((row + col) % 2 === 0) {
          ctx.fillRect(col * cell, row * cell, cell, cell);
        }
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
    const pitch = param(params, this.paramDefs, 'pitch');
    const amp = param(params, this.paramDefs, 'amplitude');
    const wl = param(params, this.paramDefs, 'wavelength');
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    for (let y = pitch / 2; y < heightMm + amp; y += pitch) {
      ctx.beginPath();
      for (let x = -wl; x <= widthMm + wl; x += 0.5) {
        const py = y + Math.sin((x / wl) * Math.PI * 2) * amp;
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
  draw(ctx, opts) {
    const { widthMm, heightMm, color, params } = opts;
    const pitch = param(params, this.paramDefs, 'pitch');
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
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
    const count = Math.round(param(params, this.paramDefs, 'count'));
    const lineWidth = param(params, this.paramDefs, 'lineWidth');
    const cy = heightMm * param(params, this.paramDefs, 'centerY');
    const inner = param(params, this.paramDefs, 'innerRadius');
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
];

export function patternByName(name: string): PanelPatternGenerator {
  return PATTERN_GENERATORS.find((g) => g.name === name) ?? PATTERN_GENERATORS[0];
}

export function defaultParams(gen: PanelPatternGenerator): Record<string, number> {
  return Object.fromEntries(gen.paramDefs.map((d) => [d.key, d.defaultValue]));
}
