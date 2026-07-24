import type { PreviewDebugSummary, PreviewSurfaceMaps, PreviewSurfaceSnapshot } from './contracts';

export interface PreviewSurfaceDebugSample {
  readonly map: keyof PreviewSurfaceMaps;
  readonly surfaceRevision: number;
  readonly xPx: number;
  readonly yPx: number;
  readonly rgba: readonly [number, number, number, number];
}

export interface PreviewSurfaceDebugFingerprint {
  readonly map: keyof PreviewSurfaceMaps;
  readonly surfaceRevision: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly hash: string;
}

interface PreviewDebugEntry {
  readonly summary: PreviewDebugSummary;
  readonly snapshot: PreviewSurfaceSnapshot | null;
}

export interface PreviewDebugPublisher {
  publish(summary: PreviewDebugSummary, snapshot?: PreviewSurfaceSnapshot | null): void;
  clear(): void;
}

const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
export const ZERO_PREVIEW_DEBUG_SUMMARY: PreviewDebugSummary = Object.freeze({
  sceneInstanceCount: 0,
  activeCanvasCount: 0,
  surfaceRevision: null,
  physicalDimensions: null,
  camera: Object.freeze({
    position: ZERO_VECTOR,
    target: ZERO_VECTOR,
    distance: 0,
    panModeEnabled: false,
  }),
  materialParameters: Object.freeze({
    metalness: 0,
    roughness: 0,
    environmentIntensity: 0,
    bumpScale: 0,
  }),
});

const entries = new Map<number, PreviewDebugEntry>();
let nextPublisherId = 1;
let latestPublisherId: number | null = null;

function isPreviewDebugContext(): boolean {
  if (import.meta.env.DEV) return true;
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');
}

function freezeSummary(summary: PreviewDebugSummary): PreviewDebugSummary {
  return Object.freeze({
    ...summary,
    physicalDimensions: summary.physicalDimensions
      ? Object.freeze({ ...summary.physicalDimensions })
      : null,
    camera: Object.freeze({
      ...summary.camera,
      position: Object.freeze({ ...summary.camera.position }),
      target: Object.freeze({ ...summary.camera.target }),
    }),
    materialParameters: Object.freeze({ ...summary.materialParameters }),
  });
}

export function createPreviewDebugPublisher(): PreviewDebugPublisher {
  if (!isPreviewDebugContext()) {
    return Object.freeze({
      publish() {},
      clear() {},
    });
  }
  const publisherId = nextPublisherId++;
  let cleared = false;

  return Object.freeze({
    publish(summary: PreviewDebugSummary, snapshot: PreviewSurfaceSnapshot | null = null) {
      if (cleared) return;
      entries.set(publisherId, { summary: freezeSummary(summary), snapshot });
      latestPublisherId = publisherId;
    },
    clear() {
      if (cleared) return;
      cleared = true;
      entries.delete(publisherId);
      if (latestPublisherId === publisherId) {
        latestPublisherId = entries.size === 0 ? null : [...entries.keys()].at(-1)!;
      }
    },
  });
}

export function getPreviewDebugSummary(): PreviewDebugSummary {
  if (latestPublisherId === null) return ZERO_PREVIEW_DEBUG_SUMMARY;
  const latest = entries.get(latestPublisherId);
  if (!latest) return ZERO_PREVIEW_DEBUG_SUMMARY;

  let sceneInstanceCount = 0;
  let activeCanvasCount = 0;
  for (const entry of entries.values()) {
    sceneInstanceCount += entry.summary.sceneInstanceCount;
    activeCanvasCount += entry.summary.activeCanvasCount;
  }
  return freezeSummary({
    ...latest.summary,
    sceneInstanceCount,
    activeCanvasCount,
  });
}

function canvas2dContext(
  snapshot: PreviewSurfaceSnapshot,
  map: keyof PreviewSurfaceMaps,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return snapshot.maps[map].source.getContext('2d');
}

export function samplePreviewSurfaceMap(
  map: keyof PreviewSurfaceMaps,
  normalizedX: number,
  normalizedY: number,
): PreviewSurfaceDebugSample | null {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;
  const entry = latestPublisherId === null ? null : entries.get(latestPublisherId);
  const snapshot = entry?.snapshot;
  if (!snapshot) return null;
  const context = canvas2dContext(snapshot, map);
  if (!context) return null;

  const xPx = Math.min(
    snapshot.rasterSize.widthPx - 1,
    Math.max(0, Math.floor(normalizedX * snapshot.rasterSize.widthPx)),
  );
  const yPx = Math.min(
    snapshot.rasterSize.heightPx - 1,
    Math.max(0, Math.floor(normalizedY * snapshot.rasterSize.heightPx)),
  );
  const pixel = context.getImageData(xPx, yPx, 1, 1).data;
  return Object.freeze({
    map,
    surfaceRevision: snapshot.surfaceRevision,
    xPx,
    yPx,
    rgba: Object.freeze([pixel[0], pixel[1], pixel[2], pixel[3]]) as readonly [
      number,
      number,
      number,
      number,
    ],
  });
}

// A compact read-only observation for production-path tests that need to
// prove a same-revision texture replacement (for example, once a font becomes
// ready). FNV-1a is intentionally non-cryptographic: it is deterministic,
// cheap over a preview canvas, and never exposes or mutates the owned pixels.
export function fingerprintPreviewSurfaceMap(
  map: keyof PreviewSurfaceMaps,
): PreviewSurfaceDebugFingerprint | null {
  const entry = latestPublisherId === null ? null : entries.get(latestPublisherId);
  const snapshot = entry?.snapshot;
  if (!snapshot) return null;
  const context = canvas2dContext(snapshot, map);
  if (!context) return null;

  const { widthPx, heightPx } = snapshot.rasterSize;
  const pixels = context.getImageData(0, 0, widthPx, heightPx).data;
  let hash = 0x811c9dc5;
  for (const byte of pixels) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return Object.freeze({
    map,
    surfaceRevision: snapshot.surfaceRevision,
    widthPx,
    heightPx,
    hash: hash.toString(16).padStart(8, '0'),
  });
}
