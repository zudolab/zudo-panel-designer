import {
  PALETTE,
  PANEL_THICKNESS_MM,
  PCB_SUBSTRATE,
  panelHeightMm,
  panelHoles,
  panelWidthMm,
  projectPcbLayerSlices,
  substrateForMaterial,
  type ColorIndex,
  type DocState,
  type Layer,
  type PanelHole,
  type PcbLayerSlices,
  type PcbMaterial,
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

// Per-material bare-substrate coefficients (#232). The alumi entry is the
// epic's "shining gray": full metalness with low roughness so exposed
// aluminum reads as polished panel metal next to the warm gold/HASL copper.
// Both hexes come from core's substrateForMaterial so 2D and 3D substrate
// can never drift apart.
export const PCB_SUBSTRATE_SURFACE_MATERIALS: Readonly<Record<PcbMaterial, PcbSurfaceMaterial>> =
  Object.freeze({
    fr4: PCB_SUBSTRATE_SURFACE_MATERIAL,
    alumi: Object.freeze({
      baseColor: substrateForMaterial('alumi').hex,
      metalness: 1,
      roughness: 0.2,
    }),
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

export function surfaceMapSubstrateColor(
  mapName: MaterialSurfaceMapName,
  material: PcbMaterial,
): string {
  return surfaceMapMaterialValue(mapName, PCB_SUBSTRATE_SURFACE_MATERIALS[material]);
}

export type PreviewCanvasFactory = (widthPx: number, heightPx: number) => PreviewCanvasSource;

export interface PreviewSurfaceMapGeneratorOptions {
  readonly canvasFactory?: PreviewCanvasFactory;
  readonly onFontReadyRevision?: (surfaceRevision: number) => void;
}

export interface PreviewSurfaceGenerationInput {
  readonly doc: Pick<DocState, 'panelHp' | 'format' | 'material' | 'layers' | 'backLayers'>;
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
  readonly material: PcbMaterial;
  readonly slices: PcbLayerSlices;
  readonly holes: readonly PanelHole[];
  readonly maskSheetFactory: MaskSheetFactory;
  // True only for the BACK face: its layer stack is authored in back-view doc
  // space and must cross into the canvas's canonical space (see
  // withArtworkSpace). Holes are canonical already and never take this path.
  readonly artworkIsBackView: boolean;
  readonly signal: AbortSignal;
}

// Screw-hole fabrication injected into every face's map set (#234, epic #226
// decisions 11/12): each catalog hole opens the solder mask with its
// `opening` stadium on both materials, and FR-4 additionally lays a copper
// stadium of the same shape under the punch so the exposed annular ring
// reads as the plated (PTH) gold barrel's ring; alumi's NPTH openings expose
// the shining substrate instead. Canonical catalog coordinates serve both
// faces unchanged — the back face's x mirror lives in the sampling contract
// (contracts.PREVIEW_BACK_FACE_ORIENTATION), never in the paint.
function fillHoleOpeningStadiums(ctx: CanvasRenderingContext2D, holes: readonly PanelHole[]): void {
  for (const hole of holes) {
    const radius = hole.opening.width / 2;
    // A round hole's square opening (width === length) collapses the flat
    // span to zero and the stadium degrades to a pure circle.
    const halfSpan = Math.max(0, (hole.opening.length - hole.opening.width) / 2);
    ctx.beginPath();
    ctx.arc(hole.cx + halfSpan, hole.cy, radius, -Math.PI / 2, Math.PI / 2, false);
    ctx.arc(hole.cx - halfSpan, hole.cy, radius, Math.PI / 2, (3 * Math.PI) / 2, false);
    ctx.closePath();
    ctx.fill();
  }
}

function paintHoleRingCopper(
  ctx: CanvasRenderingContext2D,
  holes: readonly PanelHole[],
  color: string,
): void {
  ctx.fillStyle = color;
  fillHoleOpeningStadiums(ctx, holes);
}

function punchHoleOpenings(ctx: CanvasRenderingContext2D, holes: readonly PanelHole[]): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  // Alpha is what punches (mask-sheet contract); the hue never lands.
  ctx.fillStyle = '#000000';
  fillHoleOpeningStadiums(ctx, holes);
  ctx.restore();
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

// Runs `paint` in the coordinate space the given face's LAYER STACK is
// authored in, leaving the canvas canonical.
//
// `doc.backLayers` is authored directly in BACK-VIEW doc space (#233: layer
// content is never mirrored for display, only template holes are), while
// these canvases are canonical fabrication space by contract
// (contracts.PREVIEW_BACK_FACE_ORIENTATION) — the two differ by exactly the
// `x → widthMm − x` reflection. Crossing it here is the paint-side twin of
// gerber/back-extract.ts's `mirrorInput`, which mirrors the same stack once at
// the export boundary; without it the preview's back artwork would land
// mirrored against both the composer's Back view and the exported `.GBL`.
//
// The reflection is applied to the whole artwork pass rather than to layer
// data, so shapes, paths, patterns, and glyph runs all cross identically —
// and back silkscreen text is mirrored in canonical space exactly as it is on
// a real board, reading correctly again once the back face is viewed from
// behind. Screw holes never come through here: `panelHoles()` is already
// canonical for both faces.
function withArtworkSpace(
  ctx: CanvasRenderingContext2D,
  target: SurfaceMapPaintTarget,
  paint: () => void,
): void {
  if (!target.artworkIsBackView) {
    paint();
    return;
  }
  ctx.save();
  ctx.translate(target.widthMm, 0);
  ctx.scale(-1, 1);
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

// Fills the shared scratch sheet with `fillStyle` and punches every visible
// mask leaf out of it. `punchColorFor` only needs opacity — alpha is what
// punches (see mask-sheet.ts).
function punchedMaskSheet(
  paintTarget: SurfaceMapPaintTarget,
  fillStyle: string,
  punchColorFor: (color: ColorIndex) => string,
): PreviewCanvasSource {
  const { canvas, widthMm, heightMm, slices, holes, maskSheetFactory } = paintTarget;
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
  withArtworkSpace(sheetCtx, paintTarget, () => {
    paintMaskPunches(sheetCtx, slices.solderMask, { colorFor: punchColorFor });
  });
  // The screw-hole openings are fabrication data, not artwork: they punch on
  // both faces and both materials, independent of what the user drew.
  punchHoleOpenings(sheetCtx, holes);
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
  const { canvas, widthMm, heightMm, material, slices, holes, signal } = paintTarget;
  const ctx = canvas2dContext(canvas);
  throwIfAborted(signal);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = surfaceMapSubstrateColor(mapName, material);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  enterPanelSpace(ctx, canvas, widthMm, heightMm);
  withArtworkSpace(ctx, paintTarget, () => {
    paintCopperCoverage(ctx, slices.copper, {
      color: surfaceMapColorForPalette(mapName, 1),
      signal,
    });
  });
  // FR-4 screw holes are PTH (epic decision 11): the copper ring under the
  // mask opening is what makes the exposed ring read gold. Alumi is NPTH —
  // no ring, its opening exposes bare substrate.
  if (material === 'fr4') {
    paintHoleRingCopper(ctx, holes, surfaceMapColorForPalette(mapName, 1));
  }
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
  withArtworkSpace(ctx, paintTarget, () => {
    paintSliceLayers(
      ctx,
      slices.silkscreen,
      {
        colorFor: (color) => surfaceMapColorForPalette(mapName, color),
        loadingTextAlpha: 1,
      },
      signal,
    );
  });
  ctx.restore();
}

// Combined top-surface height field: black substrate, copper coverage painted
// positively, then the punched mask sheet ADDED via 'lighter' so mask
// draping over copper stacks both thicknesses (epic #176). Silkscreen never
// paints here — its ink adds no meaningful height.
function paintHeightMap(paintTarget: SurfaceMapPaintTarget): void {
  const { canvas, widthMm, heightMm, material, slices, holes, signal } = paintTarget;
  const ctx = canvas2dContext(canvas);
  throwIfAborted(signal);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  enterPanelSpace(ctx, canvas, widthMm, heightMm);
  withArtworkSpace(ctx, paintTarget, () => {
    paintCopperCoverage(ctx, slices.copper, { color: PREVIEW_HEIGHT_COPPER_COLOR, signal });
  });
  // The FR-4 ring is real copper, so it raises the surface exactly like
  // artwork copper does (source-over: overlap with artwork stays one copper
  // thickness, never additive).
  if (material === 'fr4') paintHoleRingCopper(ctx, holes, PREVIEW_HEIGHT_COPPER_COLOR);
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
  // reconcileTextGeometry is a single-document reconciler: it evicts every
  // cached entry absent from the given array, so reconciling the two faces
  // as separate calls would evict the other face's pivots — including the
  // editor's live-face state — on every generation. Both faces therefore
  // reconcile as ONE combined snapshot, memoized by the pair of face
  // identities so a same-document regeneration (e.g. font readiness) reuses
  // the same array and never bumps the identity-keyed document incarnation.
  let combinedFaceCache: {
    readonly front: readonly Layer[];
    readonly back: readonly Layer[];
    readonly combined: readonly Layer[];
  } | null = null;
  const combineFaceLayers = (front: readonly Layer[], back: readonly Layer[]): readonly Layer[] => {
    if (combinedFaceCache?.front !== front || combinedFaceCache.back !== back) {
      combinedFaceCache = { front, back, combined: [...front, ...back] };
    }
    return combinedFaceCache.combined;
  };
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
      const heightMm = panelHeightMm(input.doc.format);
      // The golden screw-hole catalog, derived from (format, hp) — painted
      // into every face's maps below and carried on the snapshot for the
      // geometry cut.
      const holes = panelHoles(input.doc.format, input.doc.panelHp);
      const rasterSize = choosePreviewRasterSize({
        widthMm,
        heightMm,
        preferredPixelsPerMm: input.preferredPixelsPerMm ?? DEFAULT_PREVIEW_PIXELS_PER_MM,
        maximumTextureSizePx: input.maximumTextureSizePx,
      });

      // Reconcile the canonical text geometry without replacing the editor's
      // repaint callback. Preview readiness is observed independently below.
      // The role-aware slices share `flat` with the shared projection (#150),
      // not an ad-hoc flatten. A single reconcile covers BOTH faces via the
      // memoized combined array (see combineFaceLayers); for an alumi doc it
      // is the SAME array the editor canvas paints.
      const slices = projectPcbLayerSlices(input.doc.layers);
      // Alumi ignores the back stack entirely (schema v6): its back face is
      // untextured bare metal, so no back map set is painted at all.
      const backSlices =
        input.doc.material === 'alumi' ? null : projectPcbLayerSlices(input.doc.backLayers);
      const layers = slices.flat;
      const fontLayers = backSlices ? combineFaceLayers(layers, backSlices.flat) : layers;
      reconcileTextGeometry(fontLayers);
      const generationFontAttempts = new Set<FontLoadAttempt>();
      for (const layer of fontLayers) {
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

      const paintFaceMaps = (
        faceSlices: PcbLayerSlices,
        artworkIsBackView: boolean,
      ): Record<PreviewSurfaceMapName, PreviewCanvasSource> => {
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
            material: input.doc.material,
            slices: faceSlices,
            holes,
            maskSheetFactory,
            artworkIsBackView,
            signal: input.ticket.signal,
          };
          if (mapName === 'height') paintHeightMap(paintTarget);
          else paintSurfaceMap(paintTarget, mapName);
          canvases[mapName] = canvas;
        }
        return canvases;
      };

      // Both faces paint in canonical fabrication coordinates; the back
      // face's display-side x mirror lives in the texture sampling contract
      // (contracts.PREVIEW_BACK_FACE_ORIENTATION), never in the canvases.
      // Reaching canonical costs the back face one reflection of its own
      // artwork, because `doc.backLayers` is authored in back-view doc space
      // (see withArtworkSpace); its holes are canonical already.
      const canvases = paintFaceMaps(slices, false);
      const backCanvases = backSlices ? paintFaceMaps(backSlices, true) : null;

      throwIfAborted(input.ticket.signal);
      const snapshot = createPreviewSurfaceSnapshot({
        surfaceRevision: input.ticket.surfaceRevision,
        material: input.doc.material,
        widthMm,
        heightMm,
        thicknessMm: PANEL_THICKNESS_MM,
        holes,
        rasterSize,
        canvases,
        backCanvases,
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
