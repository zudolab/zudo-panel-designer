import {
  PALETTE,
  PANEL_HEIGHT_MM,
  PANEL_THICKNESS_MM,
  panelWidthMm,
  type ColorIndex,
  type DocState,
  type Layer,
} from '@zpd/core';
import { projectFlatLayers } from '../flat-projection';
import { ensureFontAttempt, type FontInitialResult, type FontLoadAttempt } from '../fonts';
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

type PreviewSurfaceMapName = keyof PreviewSurfaceMaps;

const PREVIEW_SURFACE_MAP_NAMES = [
  'baseColor',
  'metalness',
  'roughness',
] as const satisfies readonly PreviewSurfaceMapName[];

function scalarCanvasColor(value: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);
  const channel = byte.toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

export function surfaceMapColorForPalette(
  mapName: PreviewSurfaceMapName,
  color: ColorIndex,
): string {
  const material = PCB_SURFACE_MATERIALS[color];
  switch (mapName) {
    case 'baseColor':
      return material.baseColor;
    case 'metalness':
      return scalarCanvasColor(material.metalness);
    case 'roughness':
      return scalarCanvasColor(material.roughness);
  }
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

function paintSurfaceMap(options: {
  readonly canvas: PreviewCanvasSource;
  readonly mapName: PreviewSurfaceMapName;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly layers: readonly Layer[];
  readonly signal: AbortSignal;
}): void {
  const { canvas, mapName, widthMm, heightMm, layers, signal } = options;
  const ctx = canvas2dContext(canvas);
  throwIfAborted(signal);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = surfaceMapColorForPalette(mapName, 0);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(canvas.width / widthMm, 0, 0, canvas.height / heightMm, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, widthMm, heightMm);
  ctx.clip();

  const layerPaintOptions: LayerPaintOptions = {
    colorFor: (color) => surfaceMapColorForPalette(mapName, color),
    // Font fallback and loaded glyphs both represent fully opaque material.
    // Readiness schedules a fresh snapshot instead of dimming manufacture data.
    loadingTextAlpha: 1,
  };
  for (const layer of layers) {
    throwIfAborted(signal);
    if (layer.hidden || layer.type === 'image') continue;
    paintLayer(ctx, layer, layerPaintOptions);
    throwIfAborted(signal);
  }
  ctx.restore();
}

function shouldWatchInitialFontResult(result: FontInitialResult): boolean {
  return result === 'ready';
}

export function createPreviewSurfaceMapGenerator(
  options: PreviewSurfaceMapGeneratorOptions = {},
): PreviewSurfaceMapGenerator {
  const canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
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
      // The shared flat projection (#150), not an ad-hoc flatten: for the
      // editor's live doc this is the SAME array the canvas paints, so the
      // reconcile here never bumps text geometry's array-identity-keyed
      // document incarnation.
      const layers = projectFlatLayers(input.doc.layers);
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
        paintSurfaceMap({
          canvas,
          mapName,
          widthMm,
          heightMm,
          layers,
          signal: input.ticket.signal,
        });
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
