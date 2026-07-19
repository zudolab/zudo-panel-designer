export const PCB_PREVIEW_THICKNESS_MM = 2.5;

export type PreviewSurfaceRevision = number;
export type PreviewCanvasSource = HTMLCanvasElement | OffscreenCanvas;
export type PreviewMapColorSpace = 'srgb' | 'linear-scalar';

export interface PreviewPhysicalDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly thicknessMm: number;
}

export interface PreviewRasterSize {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly effectivePixelsPerMm: number;
}

export interface PreviewSurfaceMap<ColorSpace extends PreviewMapColorSpace> {
  readonly source: PreviewCanvasSource;
  readonly colorSpace: ColorSpace;
}

export interface PreviewSurfaceMaps {
  readonly baseColor: PreviewSurfaceMap<'srgb'>;
  readonly metalness: PreviewSurfaceMap<'linear-scalar'>;
  readonly roughness: PreviewSurfaceMap<'linear-scalar'>;
}

export const PREVIEW_MAP_COLOR_SPACES = Object.freeze({
  baseColor: 'srgb',
  metalness: 'linear-scalar',
  roughness: 'linear-scalar',
} as const satisfies Record<keyof PreviewSurfaceMaps, PreviewMapColorSpace>);

// Document millimeters use a top-left origin with +x right and +y down. The
// preview model is centered, with +x right, +y up, and the front facing +z.
export const PREVIEW_FRONT_FACE_ORIENTATION = Object.freeze({
  documentOrigin: 'top-left',
  documentXAxis: 'right',
  documentYAxis: 'down',
  modelOrigin: 'board-center',
  modelXAxis: 'right',
  modelYAxis: 'up',
  outwardNormal: '+z',
  canvasOrigin: 'top-left',
  documentTopLeftUv: Object.freeze({ u: 0, v: 1 }),
} as const);

export interface PreviewSurfaceSnapshot {
  readonly surfaceRevision: PreviewSurfaceRevision;
  readonly physicalDimensions: PreviewPhysicalDimensions;
  readonly rasterSize: PreviewRasterSize;
  readonly orientation: typeof PREVIEW_FRONT_FACE_ORIENTATION;
  readonly maps: PreviewSurfaceMaps;
}

export interface PreviewSurfaceSnapshotInput {
  readonly surfaceRevision: PreviewSurfaceRevision;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly rasterSize: PreviewRasterSize;
  readonly canvases: Readonly<Record<keyof PreviewSurfaceMaps, PreviewCanvasSource>>;
}

export interface PreviewFrontFacePoint {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
  readonly u: number;
  readonly v: number;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function requireSurfaceRevision(surfaceRevision: PreviewSurfaceRevision): void {
  if (!Number.isSafeInteger(surfaceRevision) || surfaceRevision < 0) {
    throw new RangeError('surfaceRevision must be a non-negative safe integer');
  }
}

export function choosePreviewRasterSize(options: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly preferredPixelsPerMm: number;
  readonly maximumTextureSizePx: number;
}): PreviewRasterSize {
  const { widthMm, heightMm, preferredPixelsPerMm, maximumTextureSizePx } = options;
  requirePositiveFinite(widthMm, 'widthMm');
  requirePositiveFinite(heightMm, 'heightMm');
  requirePositiveFinite(preferredPixelsPerMm, 'preferredPixelsPerMm');
  if (!Number.isSafeInteger(maximumTextureSizePx) || maximumTextureSizePx < 1) {
    throw new RangeError('maximumTextureSizePx must be a positive safe integer');
  }

  const limit = maximumTextureSizePx;
  const scale = Math.min(preferredPixelsPerMm, limit / Math.max(widthMm, heightMm));
  const widthPx = Math.max(1, Math.min(limit, Math.round(widthMm * scale)));
  const heightPx = Math.max(1, Math.min(limit, Math.round(heightMm * scale)));

  return Object.freeze({
    widthPx,
    heightPx,
    effectivePixelsPerMm: Math.min(widthPx / widthMm, heightPx / heightMm),
  });
}

export function mapDocumentPointToPreviewFront(
  point: { readonly xMm: number; readonly yMm: number },
  dimensions: PreviewPhysicalDimensions,
): PreviewFrontFacePoint {
  requirePositiveFinite(dimensions.widthMm, 'widthMm');
  requirePositiveFinite(dimensions.heightMm, 'heightMm');
  requirePositiveFinite(dimensions.thicknessMm, 'thicknessMm');

  return Object.freeze({
    xMm: point.xMm - dimensions.widthMm / 2,
    yMm: dimensions.heightMm / 2 - point.yMm,
    zMm: dimensions.thicknessMm / 2,
    u: point.xMm / dimensions.widthMm,
    v: 1 - point.yMm / dimensions.heightMm,
  });
}

export function createPreviewSurfaceSnapshot(
  input: PreviewSurfaceSnapshotInput,
): PreviewSurfaceSnapshot {
  requireSurfaceRevision(input.surfaceRevision);
  requirePositiveFinite(input.widthMm, 'widthMm');
  requirePositiveFinite(input.heightMm, 'heightMm');
  requirePositiveFinite(input.rasterSize.effectivePixelsPerMm, 'effectivePixelsPerMm');

  if (!Number.isSafeInteger(input.rasterSize.widthPx) || input.rasterSize.widthPx < 1) {
    throw new RangeError('widthPx must be a positive safe integer');
  }
  if (!Number.isSafeInteger(input.rasterSize.heightPx) || input.rasterSize.heightPx < 1) {
    throw new RangeError('heightPx must be a positive safe integer');
  }

  const actualPixelsPerMm = Math.min(
    input.rasterSize.widthPx / input.widthMm,
    input.rasterSize.heightPx / input.heightMm,
  );
  const densityTolerance = Number.EPSILON * Math.max(1, actualPixelsPerMm) * 8;
  if (Math.abs(input.rasterSize.effectivePixelsPerMm - actualPixelsPerMm) > densityTolerance) {
    throw new RangeError('effectivePixelsPerMm must match the physical and raster dimensions');
  }

  for (const source of Object.values(input.canvases)) {
    if (source.width !== input.rasterSize.widthPx || source.height !== input.rasterSize.heightPx) {
      throw new RangeError('every preview canvas must match the selected raster size');
    }
  }

  const physicalDimensions = Object.freeze({
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    thicknessMm: PCB_PREVIEW_THICKNESS_MM,
  });
  const rasterSize = Object.freeze({ ...input.rasterSize });
  const maps = Object.freeze({
    baseColor: Object.freeze({
      source: input.canvases.baseColor,
      colorSpace: PREVIEW_MAP_COLOR_SPACES.baseColor,
    }),
    metalness: Object.freeze({
      source: input.canvases.metalness,
      colorSpace: PREVIEW_MAP_COLOR_SPACES.metalness,
    }),
    roughness: Object.freeze({
      source: input.canvases.roughness,
      colorSpace: PREVIEW_MAP_COLOR_SPACES.roughness,
    }),
  });

  return Object.freeze({
    surfaceRevision: input.surfaceRevision,
    physicalDimensions,
    rasterSize,
    orientation: PREVIEW_FRONT_FACE_ORIENTATION,
    maps,
  });
}

export interface PreviewGenerationTicket {
  readonly surfaceRevision: PreviewSurfaceRevision;
  readonly signal: AbortSignal;
}

export interface PreviewGenerationSession {
  readonly initialGeneration: PreviewGenerationTicket;
  beginGeneration(surfaceRevision: PreviewSurfaceRevision): PreviewGenerationTicket;
  canPublish(
    ticket: PreviewGenerationTicket,
    snapshot: Pick<PreviewSurfaceSnapshot, 'surfaceRevision'>,
  ): boolean;
  settle(ticket: PreviewGenerationTicket): void;
  queueFontReadyInvalidation(surfaceRevision: PreviewSurfaceRevision): boolean;
  takeFontReadyInvalidation(): PreviewSurfaceRevision | null;
  close(): void;
}

// One session is owned by one mounted modal. Opening (or reopening) creates a
// fresh session with the current document revision. The session creates and
// aborts only its own AbortControllers; caller-owned signals are never touched.
export function openPreviewGenerationSession(
  currentSurfaceRevision: PreviewSurfaceRevision,
): PreviewGenerationSession {
  type ActiveGeneration = {
    readonly ticket: PreviewGenerationTicket;
    readonly controller: AbortController;
  };

  requireSurfaceRevision(currentSurfaceRevision);
  let closed = false;
  let latestRevision: PreviewSurfaceRevision | null = null;
  let active: ActiveGeneration | null = null;
  let pendingFontRevision: PreviewSurfaceRevision | null = null;

  const beginGeneration = (surfaceRevision: PreviewSurfaceRevision): PreviewGenerationTicket => {
    requireSurfaceRevision(surfaceRevision);
    const controller = new AbortController();
    const ticket = Object.freeze({ surfaceRevision, signal: controller.signal });

    if (closed || (latestRevision !== null && surfaceRevision < latestRevision)) {
      controller.abort();
      return ticket;
    }

    active?.controller.abort();
    latestRevision = surfaceRevision;
    active = { ticket, controller };
    return ticket;
  };

  const initialGeneration = beginGeneration(currentSurfaceRevision);

  const session: PreviewGenerationSession = {
    initialGeneration,
    beginGeneration,
    canPublish(ticket, snapshot) {
      return (
        !closed &&
        active?.ticket === ticket &&
        !ticket.signal.aborted &&
        snapshot.surfaceRevision === ticket.surfaceRevision
      );
    },
    settle(ticket) {
      if (active?.ticket === ticket) active = null;
    },
    queueFontReadyInvalidation(surfaceRevision) {
      requireSurfaceRevision(surfaceRevision);
      if (closed || (latestRevision !== null && surfaceRevision < latestRevision)) return false;

      const shouldSchedule = pendingFontRevision === null;
      pendingFontRevision = Math.max(pendingFontRevision ?? surfaceRevision, surfaceRevision);
      return shouldSchedule;
    },
    takeFontReadyInvalidation() {
      if (closed) return null;
      const revision = pendingFontRevision;
      pendingFontRevision = null;
      return revision;
    },
    close() {
      if (closed) return;
      closed = true;
      pendingFontRevision = null;
      active?.controller.abort();
      active = null;
    },
  };

  return Object.freeze(session);
}

export interface PreviewDisposableTexture {
  dispose(): void;
}

export type PreviewTextureSet<Texture extends PreviewDisposableTexture> = Readonly<
  Record<keyof PreviewSurfaceMaps, Texture>
>;

export function disposePreviewTextureSet<Texture extends PreviewDisposableTexture>(
  textures: PreviewTextureSet<Texture>,
): void {
  for (const texture of new Set(Object.values(textures))) texture.dispose();
}

// Ownership of a distinct replacement begins after validation. A failed
// install disposes the replacement and retains current; a successful install
// disposes current only after the scene swap has completed.
export function swapPreviewTextureSet<Texture extends PreviewDisposableTexture>(
  current: PreviewTextureSet<Texture> | null,
  replacement: PreviewTextureSet<Texture>,
  install: (textures: PreviewTextureSet<Texture>) => void,
): PreviewTextureSet<Texture> {
  if (current) {
    const currentTextures = new Set(Object.values(current));
    if (Object.values(replacement).some((texture) => currentTextures.has(texture))) {
      throw new Error('replacement textures must not overlap the current owned texture set');
    }
  }

  try {
    install(replacement);
  } catch (error) {
    disposePreviewTextureSet(replacement);
    throw error;
  }

  if (current) disposePreviewTextureSet(current);
  return replacement;
}

export interface PreviewCameraControls {
  dollyBy(factor: number): void;
  setPanMode(enabled: boolean): void;
  resetView(): void;
}

export interface PreviewVector3Summary {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PreviewDebugSummary {
  readonly sceneInstanceCount: number;
  readonly activeCanvasCount: number;
  readonly surfaceRevision: PreviewSurfaceRevision | null;
  readonly physicalDimensions: PreviewPhysicalDimensions | null;
  readonly camera: {
    readonly position: PreviewVector3Summary;
    readonly target: PreviewVector3Summary;
    readonly distance: number;
    readonly panModeEnabled: boolean;
  };
  readonly materialParameters: {
    readonly metalness: number;
    readonly roughness: number;
    readonly environmentIntensity: number;
  };
}

export interface PreviewAccessibilityCopy {
  readonly stageInstructions: string;
  readonly panelSummary: string;
}

export function createPreviewAccessibilityCopy(
  dimensions: PreviewPhysicalDimensions,
): PreviewAccessibilityCopy {
  return Object.freeze({
    stageInstructions:
      'Drag to rotate. Use Pan to move the board, use the wheel, pinch, or plus and minus to zoom, and use Reset to restore the view.',
    panelSummary: `PCB preview: ${dimensions.widthMm} mm wide by ${dimensions.heightMm} mm high by ${dimensions.thicknessMm} mm thick. Black soldermask and white silkscreen are matte; exposed gold is metallic.`,
  });
}
