import { describe, expect, it } from 'vitest';
import {
  createPreviewSurfaceSnapshot,
  type PreviewCanvasSource,
  type PreviewDebugSummary,
} from './contracts';
import {
  ZERO_PREVIEW_DEBUG_SUMMARY,
  createPreviewDebugPublisher,
  fingerprintPreviewSurfaceMap,
  getPreviewDebugSummary,
  samplePreviewSurfaceMap,
} from './debug-state';

function summary(revision: number): PreviewDebugSummary {
  return {
    sceneInstanceCount: 1,
    activeCanvasCount: 1,
    surfaceRevision: revision,
    physicalDimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
    camera: {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      distance: 4,
      panModeEnabled: false,
    },
    materialParameters: {
      metalness: 1,
      roughness: 0.24,
      environmentIntensity: 1.35,
      bumpScale: 0.3,
    },
  };
}

describe('preview debug state', () => {
  it('publishes immutable read-only state and returns the stable zero state after clear', () => {
    const publisher = createPreviewDebugPublisher();
    publisher.publish(summary(4));

    const published = getPreviewDebugSummary();
    expect(published.surfaceRevision).toBe(4);
    expect(published.sceneInstanceCount).toBe(1);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.camera.position)).toBe(true);

    publisher.clear();
    expect(getPreviewDebugSummary()).toBe(ZERO_PREVIEW_DEBUG_SUMMARY);
    publisher.publish(summary(5));
    expect(getPreviewDebugSummary()).toBe(ZERO_PREVIEW_DEBUG_SUMMARY);
  });

  it('does not let an older lifecycle clear a newer publisher', () => {
    const first = createPreviewDebugPublisher();
    const second = createPreviewDebugPublisher();
    first.publish(summary(1));
    second.publish(summary(2));
    expect(getPreviewDebugSummary()).toMatchObject({
      sceneInstanceCount: 2,
      activeCanvasCount: 2,
      surfaceRevision: 2,
    });

    first.clear();
    expect(getPreviewDebugSummary()).toMatchObject({
      sceneInstanceCount: 1,
      activeCanvasCount: 1,
      surfaceRevision: 2,
    });
    second.clear();
  });

  it('samples the latest surface map by normalized interior coordinate and revision', () => {
    const getImageData = (x: number, y: number) => ({
      data: new Uint8ClampedArray([x, y, 7, 255]),
    });
    const source = {
      width: 4,
      height: 2,
      getContext: () => ({ getImageData }),
    } as unknown as PreviewCanvasSource;
    const snapshot = createPreviewSurfaceSnapshot({
      surfaceRevision: 9,
      widthMm: 4,
      heightMm: 2,
      thicknessMm: 2.5,
      rasterSize: { widthPx: 4, heightPx: 2, effectivePixelsPerMm: 1 },
      canvases: { baseColor: source, metalness: source, roughness: source, height: source },
    });
    const publisher = createPreviewDebugPublisher();
    publisher.publish(summary(9), snapshot);

    expect(samplePreviewSurfaceMap('metalness', 0.75, 0.5)).toEqual({
      map: 'metalness',
      surfaceRevision: 9,
      xPx: 3,
      yPx: 1,
      rgba: [3, 1, 7, 255],
    });
    expect(samplePreviewSurfaceMap('baseColor', Number.NaN, 0)).toBeNull();
    publisher.clear();
    expect(samplePreviewSurfaceMap('baseColor', 0, 0)).toBeNull();
  });

  it('fingerprints the latest owned pixels and observes same-revision replacements', () => {
    let pixels = new Uint8ClampedArray([21, 21, 21, 255, 212, 175, 55, 255]);
    const source = {
      width: 2,
      height: 1,
      getContext: () => ({ getImageData: () => ({ data: pixels }) }),
    } as unknown as PreviewCanvasSource;
    const snapshot = createPreviewSurfaceSnapshot({
      surfaceRevision: 12,
      widthMm: 2,
      heightMm: 1,
      thicknessMm: 2.5,
      rasterSize: { widthPx: 2, heightPx: 1, effectivePixelsPerMm: 1 },
      canvases: { baseColor: source, metalness: source, roughness: source, height: source },
    });
    const publisher = createPreviewDebugPublisher();
    publisher.publish(summary(12), snapshot);

    const first = fingerprintPreviewSurfaceMap('baseColor');
    expect(first).toMatchObject({
      map: 'baseColor',
      surfaceRevision: 12,
      widthPx: 2,
      heightPx: 1,
    });
    expect(Object.isFrozen(first)).toBe(true);

    pixels = new Uint8ClampedArray([21, 21, 21, 255, 242, 240, 233, 255]);
    expect(fingerprintPreviewSurfaceMap('baseColor')?.hash).not.toBe(first?.hash);

    publisher.clear();
    expect(fingerprintPreviewSurfaceMap('baseColor')).toBeNull();
  });
});
