// Static thumbnail renderer that powers the pattern picker's previews: a fixed
// 30mm square of the pattern drawn at its default params, gold on black.

import { defaultParams } from './patterns';
import type { PanelPatternGenerator } from './types';

// PCB finish colors (mirror of @zpd/core's palette: black soldermask, gold
// exposed ENIG copper). Kept as literals so this package stays self-contained.
const THUMB_BG = '#151515';
const THUMB_FG = '#d4af37';
const THUMB_SPAN_MM = 30; // every thumbnail frames the same 30mm window

function currentDpr(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof dpr === 'number' && dpr > 0 ? dpr : 1;
}

export function renderPatternThumb(
  canvas: HTMLCanvasElement,
  gen: PanelPatternGenerator,
  sizePx: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = currentDpr();
  // size the backing store for the device, but keep the CSS box at sizePx
  const backingPx = Math.round(sizePx * dpr);
  canvas.width = backingPx;
  canvas.height = backingPx;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // derive scale from the rounded backing size so the 30mm window fills it exactly
  const scale = backingPx / THUMB_SPAN_MM;
  ctx.scale(scale, scale);
  ctx.fillStyle = THUMB_BG;
  ctx.fillRect(0, 0, THUMB_SPAN_MM, THUMB_SPAN_MM);
  gen.draw(ctx, {
    widthMm: THUMB_SPAN_MM,
    heightMm: THUMB_SPAN_MM,
    color: THUMB_FG,
    params: defaultParams(gen.name),
  });
}
