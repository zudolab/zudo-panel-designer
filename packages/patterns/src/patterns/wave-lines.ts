import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const waveLines: PanelPatternGenerator = {
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
