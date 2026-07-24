import {
  PALETTE,
  PANEL_HEIGHT_MM,
  PANEL_THICKNESS_MM,
  PCB_SUBSTRATE,
  panelWidthMm,
  projectPcbLayerSlices,
  type ColorIndex,
  type DocState,
  type Layer,
  type PcbLayerSlices,
} from '@zpd/core';
import { ensureFontAttempt, type FontInitialResult, type FontLoadAttempt } from '../fonts';
import { acquireMaskSheet, paintMaskPunches, type MaskSheetFactory } from '../mask-sheet';
import { paintLayer, type LayerPaintOptions } from '../renderer';
import { reconcileTextGeometry } from '../text-geometry';
import {
  choosePreviewRasterSize,
  createPreviewSurfaceSnapshot,
  type PreviewCanvasSource,
  type PreviewGenerationTicket,
  type PreviewSurfaceMaps,
  type PreviewSurfaceSnapshot,
} from './contracts';

export const DEFAULT_PREVIEW_PIXELS_PER_MM = 8;

export interface PcbSurfaceMaterial {
  readonly baseColor: string;
  readonly metalness: number;
  readonly roughness: number;
}

// Canvas scalar maps store one byte in every RGB channel. The WebGL consumer
// tags these maps as linear scalar data (see contracts.ts), so these values are
// material coefficients rather than display colors.
export const PCB_SURFACE_MATERIALS: Readonly<Record<ColorIndex, PcbSurfaceMaterial>> =
  Object.freeze({
    0: Object.freeze({ baseColor: PALETTE[0].hex, metalness: 0, roughness: 0.64 }),
    1: Object.freeze({ baseColor: PALETTE[1].hex, metalness: 1, roughness: 0.24 }),
    2: Object.freeze({ baseColor: PALETTE[2].hex, metalness: 0, roughness: 0.84 }),
  });

// Bare FR4 laminate visible through a solder-mask opening with no copper
// beneath it. Coefficients pinned by epic #176; the hex references
// PCB_SUBSTRATE so 2D and 3D substrate can never drift apart.
export const PCB_SUBSTRATE_SURFACE_MATERIAL: PcbSurfaceMaterial = Object.freeze({
  baseColor: PCB_SUBSTRATE.hex,
  metalness: 0,
  roughness: 0.55,
});

type PreviewSurfaceMapName = keyof PreviewSurfaceMaps;

// The height map is not a per-material coefficient lookup like the other
// maps — it is an additive composite of physical layer thicknesses — so the
// material-value helpers below exclude it.
type MaterialSurfaceMapName = Exclude<PreviewSurfaceMapName, 'height'>;

const PREVIEW_SURFACE_MAP_NAMES = [
  'baseColor',
  'metalness',
  'roughness',
  'height',
] as const satisfies readonly PreviewSurfaceMapName[];

// Height field coefficients pinned by epic #176: black substrate is 0, copper
// coverage adds ~0.66, and the punched mask sheet adds ~0.33 under additive
// 'lighter' compositing, ordering the four physical levels as
// substrate 0 < mask-only ~0.33 < open copper ~0.66 < mask-over-copper ~1.0.
// Silkscreen ink is negligibly thin and never contributes height.
export const PREVIEW_HEIGHT_COPPER_COLOR = '#a8a8a8';
export const PREVIEW_HEIGHT_MASK_COLOR = '#545454';

function scalarCanvasColor(value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
  const channel = byte.toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

function surfaceMapMaterialValue(
  mapName: MaterialSurfaceMapName,
  material: PcbSurfaceMaterial,
): string {
  switch (mapName) {
    case 'baseColor':
      return material.baseColor;
    case 'metalness':
      return scalarCanvasColor(material.metalness);
    case 'roughness':
      return scalarCanvasColor(material.roughness);
  }
}

export function surfaceMapColorForPalette(
  mapName: MaterialSurfaceMapName,
  color: ColorIndex,
): string {
  return surfaceMapMaterialValue(mapName, PCB_SURFACE_MATERIALS[color]);
}

export function surfaceMapSubstrateColor(mapName: MaterialSurfaceMapName): string {
  return surfaceMapMaterialValue(mapName, PCB_SUBSTRATE_SURFACE_MATERIAL);
}

export type PreviewCanvasFactory = (widthPx: number, heightPx: number) => PreviewCanvasSource;

export interface PreviewSurfaceMapGeneratorOptions {
  readonly canvasFactory?: PreviewCanvasFactory;
  readonly onFontReadyRevision?: (surfaceRevision: number) => void;
}

export interface PreviewSurfaceGenerationInput {
  readonly doc: Pick<DocState, 'panelHp' | 'layers'>;
  readonly ticket: PreviewGenerationTicket;
  readonly maximumTextureSizePx: number;
  readonly preferredPixelsPerMm?: number;
}

export interface PreviewSurfaceMapGenerator {
  generate(input: PreviewSurfaceGenerationInput): PreviewSurfaceSnapshot;
  close(): void;
}

function defaultCanvasFactory(widthPx: number, heightPx: number): PreviewCanvasSource {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(widthPx, heightPx);
  throw new Error('Preview surface generation requires a Canvas2D implementation');
}

function canvas2dContext(canvas: PreviewCanvasSource): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preview surface canvas did not provide a 2D context');
  // OffscreenCanvasRenderingContext2D implements the painting surface used by
  // the canonical painter and by every registered pattern generator. DOM's
  // declarations do not model it as a subtype of CanvasRenderingContext2D.
  return context as unknown as CanvasRenderingContext2D;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Preview surface generation was aborted');
  error.name = 'AbortError';
  throw error;
}

function paintSliceLayers(
  ctx: CanvasRenderingContext2D,
  layers: readonly Layer[],
  paintOptions: LayerPaintOptions,
  signal?: AbortSignal,
): void {
  for (const layer of layers) {
    if (signal) throwIfAborted(signal);
    if (layer.hidden || layer.type === 'image') continue;
    paintLayer(ctx, layer, paintOptions);
    if (signal) throwIfAborted(signal);
  }
}

// The copper occupancy pass, exported on its own rather than inlined in
// paintSurfaceMap: the height/emboss map (#181) reuses this exact pass as its
// height source (copper raises the top surface) with its own flat value and
// composite mode. The caller owns the mm-space transform and panel clip.
export function paintCopperCoverage(
  ctx: CanvasRenderingContext2D,
  copperLayers: readonly Layer[],
  options: { readonly color: string; readonly signal?: AbortSignal },
): void {
  paintSliceLayers(
    ctx,
    copperLayers,
    {
      colorFor: () => options.color,
      // Font fallback and loaded glyphs both represent fully opaque material.
      // Readiness schedules a fresh snapshot instead of dimming manufacture
      // data.
      loadingTextAlpha: 1,
    },
    options.signal,
  );
}

interface SurfaceMapPaintTarget {
  readonly canvas: PreviewCanvasSource;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly slices: PcbLayerSlices;
  readonly maskSheetFactory: MaskSheetFactory;
  readonly signal: AbortSignal;
}

function enterPanelSpace(
  target: CanvasRenderingContext2D,
  canvas: PreviewCanvasSource,
  widthMm: number,
  heightMm: number,
): void {
  target.save();
  target.setTransform(canvas.width / widthMm, 0, 0, canvas.height / heightMm, 0, 0);
  target.beginPath();
  target.rect(0, 0, widthMm, heightMm);
  target.clip();
}

// Fills the shared scratch sheet with `fillStyle` and punches every visible
// mask leaf out of it. `punchColorFor` only needs opacity — alpha is what
// punches (see mask-sheet.ts).
function punchedMaskSheet(
  paintTarget: SurfaceMapPaintTarget,
  fillStyle: string,
  punchColorFor: (color: ColorIndex) => string,
): PreviewCanvasSource {
  const { canvas, widthMm, heightMm, slices, maskSheetFactory } = paintTarget;
  const sheet = acquireMaskSheet(maskSheetFactory, canvas.width, canvas.height);
  const sheetCtx = sheet.ctx;
  sheetCtx.setTransform(1, 0, 0, 1, 0, 0);
  sheetCtx.globalAlpha = 1;
  sheetCtx.globalCompositeOperation = 'source-over';
  // The sheet is filled in THIS map's soldermask value before punching —
  // never recolored via bare drawImage, which would preserve source RGB.
  sheetCtx.fillStyle = fillStyle;
  sheetCtx.fillRect(0, 0, canvas.width, canvas.height);
  sheetCtx.save();
  sheetCtx.setTransform(canvas.width / widthMm, 0, 0, canvas.height / heightMm, 0, 0);
  paintMaskPunches(sheetCtx, slices.solderMask, { colorFor: punchColorFor });
  sheetCtx.restore();
  return sheet.canvas;
}

// Negative solder-mask composite (epic #176): every pixel starts as bare
// substrate, copper is painted positively, then a punched, map-valued mask
// sheet is composited ABOVE copper — a mask leaf is an opening, and the map
// stays fully opaque so WebGL always reads a real material coefficient.
function paintSurfaceMap(
  paintTarget: SurfaceMapPaintTarget,
  mapName: MaterialSurfaceMapName,
): void {
  const { canvas, widthMm, heightMm, slices, signal } = paintTarget;
  const ctx = canvas2dContext(canvas);
  throwIfAborted(signal);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = surfaceMapSubstrateColor(mapName);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  enterPanelSpace(ctx, canvas, widthMm, heightMm);
  paintCopperCoverage(ctx, slices.copper, {
    color: surfaceMapColorForPalette(mapName, 1),
    signal,
  });
  ctx.restore();

  // Hidden mask container means NO sheet at all — bare copper on substrate —
  // while an empty visible container still composites a full covering sheet.
  if (!slices.solderMaskHidden) {
    const sheet = punchedMaskSheet(paintTarget, surfaceMapColorForPalette(mapName, 0), (color) =>
      surfaceMapColorForPalette(mapName, color),
    );
    throwIfAborted(signal);
    ctx.drawImage(sheet, 0, 0);
  }

  enterPanelSpace(ctx, canvas, widthMm, heightMm);
  paintSliceLayers(
    ctx,
    slices.silkscreen,
    {
      colorFor: (color) => surfaceMapColorForPalette(mapName, color),
      loadingTextAlpha: 1,
    },
    signal,
  );
  ctx.restore();
}

// Combined top-surface height field: black substrate, copper coverage painted
// positively, then the punched mask sheet ADDED via 'lighter' so mask
// draping over copper stacks both thicknesses (epic #176). Silkscreen never
// paints here — its ink adds no meaningful height.
function paintHeightMap(paintTarget: SurfaceMapPaintTarget): void {
  const { canvas, widthMm, heightMm, slices, signal } = paintTarget;
  const ctx = canvas2dContext(canvas);
  throwIfAborted(signal);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  enterPanelSpace(ctx, canvas, widthMm, heightMm);
  paintCopperCoverage(ctx, slices.copper, { color: PREVIEW_HEIGHT_COPPER_COLOR, signal });
  ctx.restore();

  // Hidden mask container adds no mask thickness anywhere; an empty visible
  // container still adds the full covering sheet's thickness.
  if (!slices.solderMaskHidden) {
    const sheet = punchedMaskSheet(
      paintTarget,
      PREVIEW_HEIGHT_MASK_COLOR,
      () => PREVIEW_HEIGHT_MASK_COLOR,
    );
    throwIfAborted(signal);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sheet, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function shouldWatchInitialFontResult(result: FontInitialResult): boolean {
  return result === 'ready';
}

export function createPreviewSurfaceMapGenerator(
  options: PreviewSurfaceMapGeneratorOptions = {},
): PreviewSurfaceMapGenerator {
  const canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
  // Mask-sheet allocation is cached per factory identity (mask-sheet.ts), so
  // one stable closure per generator gives it its own reusable scratch sheet.
  const maskSheetFactory: MaskSheetFactory = (widthPx, heightPx) =>
    canvasFactory(widthPx, heightPx);
  const watchedAttempts = new WeakSet<FontLoadAttempt>();
  const latestRevisionByAttempt = new WeakMap<FontLoadAttempt, number>();
  const lateReadyUnsubscribers = new Set<() => void>();
  let currentFontAttempts = new Set<FontLoadAttempt>();
  let currentSurfaceRevision: number | null = null;
  let pendingFontRevision: number | null = null;
  let fontNotificationScheduled = false;
  let closed = false;

  const queueFontReady = (attempt: FontLoadAttempt): void => {
    if (closed || !options.onFontReadyRevision || !currentFontAttempts.has(attempt)) return;
    const surfaceRevision = latestRevisionByAttempt.get(attempt);
    if (surfaceRevision === undefined) return;
    pendingFontRevision = Math.max(pendingFontRevision ?? surfaceRevision, surfaceRevision);
    if (fontNotificationScheduled) return;
    fontNotificationScheduled = true;
    queueMicrotask(() => {
      fontNotificationScheduled = false;
      const revision = pendingFontRevision;
      pendingFontRevision = null;
      if (!closed && revision !== null && revision === currentSurfaceRevision) {
        options.onFontReadyRevision?.(revision);
      }
    });
  };

  const watchFontAttempt = (attempt: FontLoadAttempt): void => {
    if (watchedAttempts.has(attempt) || !options.onFontReadyRevision) return;
    watchedAttempts.add(attempt);

    const status = attempt.getStatus();
    if (status === 'pending') {
      void attempt.initial.then((result) => {
        if (shouldWatchInitialFontResult(result)) queueFontReady(attempt);
      });
    }
    if (status === 'pending' || status === 'timed-out') {
      const unsubscribe = attempt.onLateReady(() => queueFontReady(attempt));
      lateReadyUnsubscribers.add(unsubscribe);
    }
  };

  return Object.freeze({
    generate(input: PreviewSurfaceGenerationInput): PreviewSurfaceSnapshot {
      if (closed) throw new Error('Preview surface map generator is closed');
      throwIfAborted(input.ticket.signal);

      const widthMm = panelWidthMm(input.doc.panelHp);
      const heightMm = PANEL_HEIGHT_MM;
      const rasterSize = choosePreviewRasterSize({
        widthMm,
        heightMm,
        preferredPixelsPerMm: input.preferredPixelsPerMm ?? DEFAULT_PREVIEW_PIXELS_PER_MM,
        maximumTextureSizePx: input.maximumTextureSizePx,
      });

      // Reconcile the canonical text geometry without replacing the editor's
      // repaint callback. Preview readiness is observed independently below.
      // The role-aware slices share `flat` with the shared projection (#150),
      // not an ad-hoc flatten: for the editor's live doc this is the SAME
      // array the canvas paints, so the reconcile here never bumps text
      // geometry's array-identity-keyed document incarnation.
      const slices = projectPcbLayerSlices(input.doc.layers);
      const layers = slices.flat;
      reconcileTextGeometry(layers);
      const generationFontAttempts = new Set<FontLoadAttempt>();
      for (const layer of layers) {
        if (
          layer.hidden ||
          layer.type !== 'text' ||
          !Number.isFinite(layer.sizeMm) ||
          layer.sizeMm <= 0
        ) {
          continue;
        }
        const attempt = ensureFontAttempt(layer.fontFamily, layer.content);
        generationFontAttempts.add(attempt);
        watchFontAttempt(attempt);
      }

      const canvases = {} as Record<PreviewSurfaceMapName, PreviewCanvasSource>;
      for (const mapName of PREVIEW_SURFACE_MAP_NAMES) {
        throwIfAborted(input.ticket.signal);
        const canvas = canvasFactory(rasterSize.widthPx, rasterSize.heightPx);
        if (canvas.width !== rasterSize.widthPx || canvas.height !== rasterSize.heightPx) {
          throw new Error('Preview canvas factory returned an incorrectly sized canvas');
        }
        const paintTarget: SurfaceMapPaintTarget = {
          canvas,
          widthMm,
          heightMm,
          slices,
          maskSheetFactory,
          signal: input.ticket.signal,
        };
        if (mapName === 'height') paintHeightMap(paintTarget);
        else paintSurfaceMap(paintTarget, mapName);
        canvases[mapName] = canvas;
      }

      throwIfAborted(input.ticket.signal);
      const snapshot = createPreviewSurfaceSnapshot({
        surfaceRevision: input.ticket.surfaceRevision,
        widthMm,
        heightMm,
        thicknessMm: PANEL_THICKNESS_MM,
        rasterSize,
        canvases,
      });
      for (const attempt of generationFontAttempts) {
        latestRevisionByAttempt.set(attempt, input.ticket.surfaceRevision);
      }
      currentFontAttempts = generationFontAttempts;
      currentSurfaceRevision = input.ticket.surfaceRevision;
      return snapshot;
    },
    close() {
      if (closed) return;
      closed = true;
      pendingFontRevision = null;
      currentFontAttempts.clear();
      currentSurfaceRevision = null;
      for (const unsubscribe of lateReadyUnsubscribers) unsubscribe();
      lateReadyUnsubscribers.clear();
    },
  });
}
