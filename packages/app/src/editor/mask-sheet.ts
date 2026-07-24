// Shared punch primitive for BOTH render paths (2D editor canvas, 3D preview
// surface maps) so inverted solder-mask semantics — a visible mask leaf
// carves an opening instead of painting positive black — live in exactly one
// place and the two surfaces cannot drift (issue #178, epic #176).
// `paintLayer` itself stays the shared positive painter; callers punch onto
// their own offscreen sheet under destination-out, never the main canvas.
import type { ColorIndex, Layer } from '@zpd/core';
import { paintLayer, type LayerPaintOptions } from './renderer';

export type MaskSheetSource = HTMLCanvasElement | OffscreenCanvas;

export type MaskSheetFactory = (widthPx: number, heightPx: number) => MaskSheetSource;

export interface PaintMaskPunchesOptions {
  readonly colorFor: (color: ColorIndex) => string;
}

// Punches every visible, non-image mask leaf into the caller-filled sheet by
// erasing pixels (destination-out) rather than painting positive color, so
// the hole geometry matches paintLayer's own fill exactly. colorFor only
// needs to be opaque — its actual hue never reaches a canvas, alpha is what
// punches. Even-odd path holes need no special handling here: a hole drawn
// inside an already-punched opening erases from the punch itself, which
// re-masks that area — physically correct with no extra code.
export function paintMaskPunches(
  ctx: CanvasRenderingContext2D,
  maskLayers: readonly Layer[],
  options: PaintMaskPunchesOptions,
): void {
  const punchOptions: LayerPaintOptions = {
    colorFor: options.colorFor,
    // Font fallback and loaded glyphs must punch identically opaque; a
    // fonts-loading alpha would carve a semi-transparent, unmanufacturable
    // hole (same precedent as preview/surface-maps.ts's loadingTextAlpha: 1).
    loadingTextAlpha: 1,
  };
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const layer of maskLayers) {
    if (layer.hidden || layer.type === 'image') continue;
    paintLayer(ctx, layer, punchOptions);
  }
  ctx.restore();
}

interface MaskSheetAllocation {
  readonly canvas: MaskSheetSource;
  readonly ctx: CanvasRenderingContext2D;
}

interface CachedMaskSheet extends MaskSheetAllocation {
  readonly widthPx: number;
  readonly heightPx: number;
}

// Keyed by factory identity rather than a caller-threaded handle: independent
// render paths (the persistent 2D editor, each 3D preview generator
// instance) get independent scratch buffers just by using their own
// canvasFactory closure, with nothing extra to allocate or pass around.
const sheetsByFactory = new WeakMap<MaskSheetFactory, CachedMaskSheet>();

function maskSheetContext(canvas: MaskSheetSource): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Mask sheet canvas did not provide a 2D context');
  // OffscreenCanvasRenderingContext2D implements the painting surface
  // paintLayer needs; DOM's lib types don't model it as a subtype of
  // CanvasRenderingContext2D (same cast as preview/surface-maps.ts).
  return ctx as unknown as CanvasRenderingContext2D;
}

// Caches the canvas ALLOCATION only, never its pixels: callers re-fill and
// re-punch the sheet on every use. A pixel cache invalidated only by
// dpr/panel/zoom would show stale mask edits, so this resizes/reallocates
// whenever the requested dimensions differ from what's cached.
export function acquireMaskSheet(
  factory: MaskSheetFactory,
  widthPx: number,
  heightPx: number,
): MaskSheetAllocation {
  const cached = sheetsByFactory.get(factory);
  if (cached && cached.widthPx === widthPx && cached.heightPx === heightPx) return cached;
  const canvas = factory(widthPx, heightPx);
  const allocation: CachedMaskSheet = {
    canvas,
    ctx: maskSheetContext(canvas),
    widthPx,
    heightPx,
  };
  sheetsByFactory.set(factory, allocation);
  return allocation;
}
