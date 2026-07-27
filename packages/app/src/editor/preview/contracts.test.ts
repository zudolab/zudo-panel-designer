import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { panelHoles } from '@zpd/core';
import {
  PREVIEW_BACK_FACE_ORIENTATION,
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
  type PreviewSurfaceMaps,
  type PreviewTextureSet,
} from './contracts';

function fakeCanvas(width: number, height: number): PreviewCanvasSource {
  return { width, height } as PreviewCanvasSource;
}

function fakeCanvasSet(
  width: number,
  height: number,
): Readonly<Record<keyof PreviewSurfaceMaps, PreviewCanvasSource>> {
  return {
    baseColor: fakeCanvas(width, height),
    metalness: fakeCanvas(width, height),
    roughness: fakeCanvas(width, height),
    height: fakeCanvas(width, height),
  };
}

const dimensions: PreviewPhysicalDimensions = {
  widthMm: 100,
  heightMm: 50,
  thicknessMm: 2.5,
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

describe('back-face orientation', () => {
  it('pins the canonical-coordinate x mirror for the -z back face', () => {
    // Canonical fabrication coords are front-view; a back-side consumer
    // mirrors x for display only (`width − x`). The back face therefore
    // shares every front-face convention except the mirrored u.
    expect(PREVIEW_BACK_FACE_ORIENTATION.outwardNormal).toBe('-z');
    expect(PREVIEW_BACK_FACE_ORIENTATION.documentTopLeftUv).toEqual({ u: 1, v: 1 });
    expect(PREVIEW_BACK_FACE_ORIENTATION).toMatchObject({
      documentOrigin: PREVIEW_FRONT_FACE_ORIENTATION.documentOrigin,
      documentXAxis: PREVIEW_FRONT_FACE_ORIENTATION.documentXAxis,
      documentYAxis: PREVIEW_FRONT_FACE_ORIENTATION.documentYAxis,
      modelOrigin: PREVIEW_FRONT_FACE_ORIENTATION.modelOrigin,
      canvasOrigin: PREVIEW_FRONT_FACE_ORIENTATION.canvasOrigin,
    });
    expect(Object.isFrozen(PREVIEW_BACK_FACE_ORIENTATION)).toBe(true);
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
    const holes = panelHoles('3U', 12);
    const snapshot = createPreviewSurfaceSnapshot({
      surfaceRevision: 7,
      material: 'fr4',
      widthMm: 60,
      heightMm: 128.5,
      thicknessMm: 2.5,
      holes,
      rasterSize,
      canvases: fakeCanvasSet(240, 514),
      backCanvases: fakeCanvasSet(240, 514),
    });

    expect(snapshot.physicalDimensions.thicknessMm).toBe(2.5);
    expect(snapshot.material).toBe('fr4');
    expect(snapshot.holes).toEqual(holes);
    expect(snapshot.maps.baseColor.colorSpace).toBe('srgb');
    expect(snapshot.maps.metalness.colorSpace).toBe('linear-scalar');
    expect(snapshot.maps.roughness.colorSpace).toBe('linear-scalar');
    expect(snapshot.maps.height.colorSpace).toBe('linear-scalar');
    expect(PREVIEW_MAP_COLOR_SPACES).toEqual({
      baseColor: 'srgb',
      metalness: 'linear-scalar',
      roughness: 'linear-scalar',
      height: 'linear-scalar',
    });
    expect(snapshot.orientation).toBe(PREVIEW_FRONT_FACE_ORIENTATION);
    expect(snapshot.backOrientation).toBe(PREVIEW_BACK_FACE_ORIENTATION);
    expect(snapshot.backMaps).not.toBeNull();
    expect(snapshot.backMaps!.baseColor.colorSpace).toBe('srgb');
    expect(snapshot.backMaps!.height.colorSpace).toBe('linear-scalar');
    expect(snapshot.backMaps!.baseColor.source).not.toBe(snapshot.maps.baseColor.source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.physicalDimensions)).toBe(true);
    expect(Object.isFrozen(snapshot.holes)).toBe(true);
    expect(Object.isFrozen(snapshot.maps.baseColor)).toBe(true);
    expect(Object.isFrozen(snapshot.backMaps)).toBe(true);
  });

  it('couples the back map set to the document material', () => {
    const rasterSize = { widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 };
    const base = {
      surfaceRevision: 1,
      widthMm: 60,
      heightMm: 128.5,
      thicknessMm: 2.5,
      holes: panelHoles('3U', 12),
      rasterSize,
    } as const;

    const alumi = createPreviewSurfaceSnapshot({
      ...base,
      material: 'alumi',
      canvases: fakeCanvasSet(240, 514),
      backCanvases: null,
    });
    expect(alumi.material).toBe('alumi');
    expect(alumi.backMaps).toBeNull();

    expect(() =>
      createPreviewSurfaceSnapshot({
        ...base,
        material: 'alumi',
        canvases: fakeCanvasSet(240, 514),
        backCanvases: fakeCanvasSet(240, 514),
      }),
    ).toThrow('untextured bare-metal back');
    expect(() =>
      createPreviewSurfaceSnapshot({
        ...base,
        material: 'fr4',
        canvases: fakeCanvasSet(240, 514),
        backCanvases: null,
      }),
    ).toThrow('backCanvases are required');
  });

  it('rejects a canvas whose dimensions differ from the selected raster size', () => {
    expect(() =>
      createPreviewSurfaceSnapshot({
        surfaceRevision: 1,
        material: 'fr4',
        widthMm: 60,
        heightMm: 128.5,
        thicknessMm: 2.5,
        holes: panelHoles('3U', 12),
        rasterSize: { widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 },
        canvases: {
          ...fakeCanvasSet(240, 514),
          baseColor: fakeCanvas(239, 514),
        },
        backCanvases: fakeCanvasSet(240, 514),
      }),
    ).toThrow('every preview canvas must match');
    expect(() =>
      createPreviewSurfaceSnapshot({
        surfaceRevision: 1,
        material: 'fr4',
        widthMm: 60,
        heightMm: 128.5,
        thicknessMm: 2.5,
        holes: panelHoles('3U', 12),
        rasterSize: { widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 },
        canvases: fakeCanvasSet(240, 514),
        backCanvases: {
          ...fakeCanvasSet(240, 514),
          height: fakeCanvas(240, 513),
        },
      }),
    ).toThrow('every preview canvas must match');
  });

  it('rejects a non-positive supplied thickness', () => {
    expect(() =>
      createPreviewSurfaceSnapshot({
        surfaceRevision: 1,
        material: 'fr4',
        widthMm: 60,
        heightMm: 128.5,
        thicknessMm: 0,
        holes: panelHoles('3U', 12),
        rasterSize: { widthPx: 240, heightPx: 514, effectivePixelsPerMm: 4 },
        canvases: fakeCanvasSet(240, 514),
        backCanvases: fakeCanvasSet(240, 514),
      }),
    ).toThrow('thicknessMm must be a positive finite number');
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
      height: texture(`${prefix}:height`, events),
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
      'dispose:old:height',
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
      'dispose:new:height',
    ]);
  });

  it('disposes a shared texture only once during final scene teardown', () => {
    const dispose = vi.fn();
    const shared = { dispose };
    disposePreviewTextureSet({
      baseColor: shared,
      metalness: shared,
      roughness: shared,
      height: shared,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('continues disposing the owned set when one texture disposer throws', () => {
    const baseColor = {
      dispose: vi.fn(() => {
        throw new Error('dispose failed');
      }),
    };
    const metalness = { dispose: vi.fn() };
    const roughness = { dispose: vi.fn() };
    const height = { dispose: vi.fn() };

    expect(() =>
      disposePreviewTextureSet({ baseColor, metalness, roughness, height }),
    ).not.toThrow();
    expect(baseColor.dispose).toHaveBeenCalledOnce();
    expect(metalness.dispose).toHaveBeenCalledOnce();
    expect(roughness.dispose).toHaveBeenCalledOnce();
    expect(height.dispose).toHaveBeenCalledOnce();
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
      materialParameters: { metalness: 1, roughness: 1, environmentIntensity: 1.2, bumpScale: 0.3 },
    };

    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it('describes both controls and the manufactured panel finish in text', () => {
    const copy = createPreviewAccessibilityCopy(dimensions, 'fr4');
    expect(copy.stageInstructions).toContain('Pan');
    expect(copy.stageInstructions).toContain('plus and minus');
    expect(copy.stageInstructions).toContain('Reset');
    expect(copy.panelSummary).toContain('100 mm wide by 50 mm high by 2.5 mm thick');
    expect(copy.panelSummary).toContain('exposed copper with the gold/HASL finish is metallic');
    // Inverted mask + emboss semantics (epic #176): the mask covers by
    // default, drawn openings expose, and copper reads embossed.
    expect(copy.panelSummary).toContain('covers the board except where drawn openings expose it');
    expect(copy.panelSummary).toContain('emboss');
  });

  it('describes the polished aluminum finish for alumi documents', () => {
    const copy = createPreviewAccessibilityCopy(dimensions, 'alumi');
    expect(copy.panelSummary).toContain('Aluminum PCB preview');
    expect(copy.panelSummary).toContain('100 mm wide by 50 mm high by 2.5 mm thick');
    expect(copy.panelSummary).toContain('Polished aluminum');
    expect(copy.panelSummary).toContain('edges and back');
    // Shared instruction copy stays material-agnostic.
    expect(copy.stageInstructions).toBe(
      createPreviewAccessibilityCopy(dimensions, 'fr4').stageInstructions,
    );
  });
});

describe('renderer independence', () => {
  it('does not import Three.js or any Three.js submodule', () => {
    const contractPath = join(dirname(fileURLToPath(import.meta.url)), 'contracts.ts');
    const source = readFileSync(contractPath, 'utf8');
    expect(source).not.toMatch(/(?:from\s+|import\s*\()['"]three(?:\/[^'"]*)?['"]/);
  });
});
