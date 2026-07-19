import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  PCB_PREVIEW_THICKNESS_MM,
  PREVIEW_FRONT_FACE_ORIENTATION,
  PREVIEW_MAP_COLOR_SPACES,
  choosePreviewRasterSize,
  createPreviewAccessibilityCopy,
  createPreviewSurfaceSnapshot,
  disposePreviewTextureSet,
  mapDocumentPointToPreviewFront,
  openPreviewGenerationSession,
  swapPreviewTextureSet,
  type PreviewCanvasSource,
  type PreviewDebugSummary,
  type PreviewDisposableTexture,
  type PreviewPhysicalDimensions,
  type PreviewTextureSet,
} from './contracts';

function fakeCanvas(width: number, height: number): PreviewCanvasSource {
  return { width, height } as PreviewCanvasSource;
}

const dimensions: PreviewPhysicalDimensions = {
  widthMm: 100,
  heightMm: 50,
  thicknessMm: PCB_PREVIEW_THICKNESS_MM,
};

describe('choosePreviewRasterSize', () => {
  it('uses the preferred density when the runtime texture capability allows it', () => {
    expect(
      choosePreviewRasterSize({
        widthMm: 60,
        heightMm: 128.5,
        preferredPixelsPerMm: 4,
        maximumTextureSizePx: 4096,
      }),
    ).toEqual({ widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 });
  });

  it.each([
    { widthMm: 10_000, heightMm: 1, expectedWidth: 1024, expectedHeight: 1 },
    { widthMm: 1, heightMm: 10_000, expectedWidth: 1, expectedHeight: 1024 },
  ])(
    'keeps an extreme $widthMm:$heightMm panel inside both texture axes',
    ({ widthMm, heightMm, expectedWidth, expectedHeight }) => {
      const size = choosePreviewRasterSize({
        widthMm,
        heightMm,
        preferredPixelsPerMm: 8,
        maximumTextureSizePx: 1024,
      });

      expect(size.widthPx).toBe(expectedWidth);
      expect(size.heightPx).toBe(expectedHeight);
      expect(size.widthPx).toBeLessThanOrEqual(1024);
      expect(size.heightPx).toBeLessThanOrEqual(1024);
      expect(size.effectivePixelsPerMm).toBeCloseTo(0.1024, 8);
    },
  );

  it('rejects unusable physical dimensions and capabilities', () => {
    expect(() =>
      choosePreviewRasterSize({
        widthMm: 0,
        heightMm: 128.5,
        preferredPixelsPerMm: 4,
        maximumTextureSizePx: 4096,
      }),
    ).toThrow(RangeError);
    expect(() =>
      choosePreviewRasterSize({
        widthMm: 60,
        heightMm: 128.5,
        preferredPixelsPerMm: 4,
        maximumTextureSizePx: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      choosePreviewRasterSize({
        widthMm: 60,
        heightMm: 128.5,
        preferredPixelsPerMm: 4,
        maximumTextureSizePx: 0.5,
      }),
    ).toThrow(RangeError);
  });
});

describe('front-face orientation', () => {
  it('maps document top-left to the outward model top-left without mirroring', () => {
    expect(mapDocumentPointToPreviewFront({ xMm: 0, yMm: 0 }, dimensions)).toEqual({
      xMm: -50,
      yMm: 25,
      zMm: 1.25,
      u: 0,
      v: 1,
    });
    expect(mapDocumentPointToPreviewFront({ xMm: 100, yMm: 0 }, dimensions)).toEqual({
      xMm: 50,
      yMm: 25,
      zMm: 1.25,
      u: 1,
      v: 1,
    });
    expect(mapDocumentPointToPreviewFront({ xMm: 0, yMm: 50 }, dimensions)).toEqual({
      xMm: -50,
      yMm: -25,
      zMm: 1.25,
      u: 0,
      v: 0,
    });
  });

  it('maps the document center to the center of the +z front plane', () => {
    expect(mapDocumentPointToPreviewFront({ xMm: 50, yMm: 25 }, dimensions)).toEqual({
      xMm: 0,
      yMm: 0,
      zMm: 1.25,
      u: 0.5,
      v: 0.5,
    });
    expect(PREVIEW_FRONT_FACE_ORIENTATION.outwardNormal).toBe('+z');
  });
});

describe('surface snapshot', () => {
  it('freezes the 2.5 mm physical contract and unambiguous map color-space tags', () => {
    const rasterSize = choosePreviewRasterSize({
      widthMm: 60,
      heightMm: 128.5,
      preferredPixelsPerMm: 4,
      maximumTextureSizePx: 4096,
    });
    const snapshot = createPreviewSurfaceSnapshot({
      surfaceRevision: 7,
      widthMm: 60,
      heightMm: 128.5,
      rasterSize,
      canvases: {
        baseColor: fakeCanvas(240, 514),
        metalness: fakeCanvas(240, 514),
        roughness: fakeCanvas(240, 514),
      },
    });

    expect(snapshot.physicalDimensions.thicknessMm).toBe(2.5);
    expect(snapshot.maps.baseColor.colorSpace).toBe('srgb');
    expect(snapshot.maps.metalness.colorSpace).toBe('linear-scalar');
    expect(snapshot.maps.roughness.colorSpace).toBe('linear-scalar');
    expect(PREVIEW_MAP_COLOR_SPACES).toEqual({
      baseColor: 'srgb',
      metalness: 'linear-scalar',
      roughness: 'linear-scalar',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.physicalDimensions)).toBe(true);
    expect(Object.isFrozen(snapshot.maps.baseColor)).toBe(true);
  });

  it('rejects a canvas whose dimensions differ from the selected raster size', () => {
    expect(() =>
      createPreviewSurfaceSnapshot({
        surfaceRevision: 1,
        widthMm: 60,
        heightMm: 128.5,
        rasterSize: { widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 },
        canvases: {
          baseColor: fakeCanvas(239, 514),
          metalness: fakeCanvas(240, 514),
          roughness: fakeCanvas(240, 514),
        },
      }),
    ).toThrow('every preview canvas must match');
  });
});

describe('preview generation revision and cancellation', () => {
  it('aborts replaced work and never publishes stale or mismatched revisions', () => {
    const session = openPreviewGenerationSession(1);
    const first = session.initialGeneration;
    expect(session.canPublish(first, { surfaceRevision: 1 })).toBe(true);

    const second = session.beginGeneration(2);
    expect(first.signal.aborted).toBe(true);
    expect(session.canPublish(first, { surfaceRevision: 1 })).toBe(false);
    expect(session.canPublish(second, { surfaceRevision: 1 })).toBe(false);
    expect(session.canPublish(second, { surfaceRevision: 2 })).toBe(true);

    const stale = session.beginGeneration(1);
    expect(stale.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(session.canPublish(stale, { surfaceRevision: 1 })).toBe(false);

    session.settle(second);
    expect(session.canPublish(second, { surfaceRevision: 2 })).toBe(false);
  });

  it('coalesces font-ready invalidations and aborts/ignores all late work after close', () => {
    const session = openPreviewGenerationSession(3);
    expect(session.queueFontReadyInvalidation(3)).toBe(true);
    expect(session.queueFontReadyInvalidation(4)).toBe(false);
    expect(session.queueFontReadyInvalidation(3)).toBe(false);
    expect(session.takeFontReadyInvalidation()).toBe(4);
    expect(session.takeFontReadyInvalidation()).toBeNull();
    expect(session.queueFontReadyInvalidation(2)).toBe(false);
    expect(session.queueFontReadyInvalidation(4)).toBe(true);

    const active = session.beginGeneration(4);
    session.close();
    expect(active.signal.aborted).toBe(true);
    expect(session.canPublish(active, { surfaceRevision: 4 })).toBe(false);
    expect(session.takeFontReadyInvalidation()).toBeNull();
    expect(session.queueFontReadyInvalidation(5)).toBe(false);
    expect(session.beginGeneration(5).signal.aborted).toBe(true);
  });

  it('starts every reopened modal from the latest document revision', () => {
    const firstOpen = openPreviewGenerationSession(2);
    firstOpen.close();
    const reopened = openPreviewGenerationSession(8);

    expect(reopened.initialGeneration.surfaceRevision).toBe(8);
    expect(reopened.initialGeneration.signal.aborted).toBe(false);
  });
});

describe('preview texture ownership', () => {
  function texture(name: string, events: string[]): PreviewDisposableTexture {
    return { dispose: vi.fn(() => events.push(`dispose:${name}`)) };
  }

  function textureSet(
    prefix: string,
    events: string[],
  ): PreviewTextureSet<PreviewDisposableTexture> {
    return {
      baseColor: texture(`${prefix}:base`, events),
      metalness: texture(`${prefix}:metalness`, events),
      roughness: texture(`${prefix}:roughness`, events),
    };
  }

  it('disposes replaced textures only after a successful scene swap', () => {
    const events: string[] = [];
    const current = textureSet('old', events);
    const replacement = textureSet('new', events);

    expect(
      swapPreviewTextureSet(current, replacement, () => {
        events.push('install:new');
      }),
    ).toBe(replacement);
    expect(events).toEqual([
      'install:new',
      'dispose:old:base',
      'dispose:old:metalness',
      'dispose:old:roughness',
    ]);
  });

  it('retains current and disposes every newly owned texture when installation fails', () => {
    const events: string[] = [];
    const current = textureSet('old', events);
    const replacement = textureSet('new', events);

    expect(() =>
      swapPreviewTextureSet(current, replacement, () => {
        events.push('install:failed');
        throw new Error('install failed');
      }),
    ).toThrow('install failed');
    expect(events).toEqual([
      'install:failed',
      'dispose:new:base',
      'dispose:new:metalness',
      'dispose:new:roughness',
    ]);
  });

  it('disposes a shared texture only once during final scene teardown', () => {
    const dispose = vi.fn();
    const shared = { dispose };
    disposePreviewTextureSet({ baseColor: shared, metalness: shared, roughness: shared });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects overlapping ownership without installing or disposing either set', () => {
    const events: string[] = [];
    const current = textureSet('old', events);
    const replacement = { ...textureSet('new', events), baseColor: current.baseColor };
    const install = vi.fn();

    expect(() => swapPreviewTextureSet(current, replacement, install)).toThrow(
      'replacement textures must not overlap',
    );
    expect(install).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe('debug and accessibility contracts', () => {
  it('is JSON-serializable and exposes lifecycle, camera, pan, and material state', () => {
    const summary: PreviewDebugSummary = {
      sceneInstanceCount: 1,
      activeCanvasCount: 3,
      surfaceRevision: 9,
      physicalDimensions: dimensions,
      camera: {
        position: { x: 1, y: 2, z: 3 },
        target: { x: 0, y: 0, z: 0 },
        distance: 3.75,
        panModeEnabled: true,
      },
      materialParameters: { metalness: 1, roughness: 1, environmentIntensity: 1.2 },
    };

    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it('describes both controls and the manufactured panel finish in text', () => {
    const copy = createPreviewAccessibilityCopy(dimensions);
    expect(copy.stageInstructions).toContain('Pan');
    expect(copy.stageInstructions).toContain('plus and minus');
    expect(copy.stageInstructions).toContain('Reset');
    expect(copy.panelSummary).toContain('100 mm wide by 50 mm high by 2.5 mm thick');
    expect(copy.panelSummary).toContain('exposed gold is metallic');
  });
});

describe('renderer independence', () => {
  it('does not import Three.js or any Three.js submodule', () => {
    const contractPath = join(dirname(fileURLToPath(import.meta.url)), 'contracts.ts');
    const source = readFileSync(contractPath, 'utf8');
    expect(source).not.toMatch(/(?:from\s+|import\s*\()['"]three(?:\/[^'"]*)?['"]/);
  });
});
