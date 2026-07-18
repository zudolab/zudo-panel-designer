import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

// Ported from pgen `deco-chevron-gold` (see .claude/skills/port-pgen-patterns/).
// Bold Art-Deco chevron ribbons: each row fills a V-shaped band, and the
// unpainted slice between consecutive bands (rowH − bandH) is the negative-space
// "gap" — since every ribbon shares one V profile the gap stays constant at all
// x. Dropped from the source: bg fill, the cycling fg palette (2-color alternation
// collapses to band-vs-gap presence/absence) and the thin accent stroke line.
export const decoChevronGold: PanelPatternGenerator = {
  name: 'deco-chevron-gold',
  displayName: 'Deco Chevron Gold',
  paramDefs: [
    { key: 'pitch', label: 'Row pitch (mm)', min: 2, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'amplitude', label: 'Chevron height (mm)', min: 1, max: 16, step: 0.5, defaultValue: 6 },
    { key: 'thickness', label: 'Band thickness', min: 0.3, max: 0.9, step: 0.05, defaultValue: 0.6 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const pitch = resolveParam(params, this.paramDefs, 'pitch');
    const amp = resolveParam(params, this.paramDefs, 'amplitude');
    const thickness = resolveParam(params, this.paramDefs, 'thickness');
    const bandH = pitch * thickness;
    const midX = widthMm / 2; // chevron apex anchored to the panel center
    ctx.fillStyle = color;
    for (let yTop = centeredStart(heightMm, pitch) - amp - pitch; yTop <= heightMm + amp + pitch; yTop += pitch) {
      ctx.beginPath();
      ctx.moveTo(0, yTop);
      ctx.lineTo(midX, yTop - amp);
      ctx.lineTo(widthMm, yTop);
      ctx.lineTo(widthMm, yTop + bandH);
      ctx.lineTo(midX, yTop + bandH - amp);
      ctx.lineTo(0, yTop + bandH);
      ctx.closePath();
      ctx.fill();
    }
  },
};
