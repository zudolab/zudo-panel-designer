import { describe, expect, it, vi } from 'vitest';
import { createPcbLayerStack, type DocState } from '@zpd/core';
import {
  createPreviewSurfaceSnapshot,
  type PreviewCanvasSource,
  type PreviewSurfaceSnapshot,
} from './contracts';
import type { PreviewSceneRuntime } from './scene-runtime';
import { createPreviewSurfaceController } from './surface-controller';
import type { PreviewSurfaceMapGenerator, PreviewSurfaceMapGeneratorOptions } from './surface-maps';

function snapshot(revision: number): PreviewSurfaceSnapshot {
  const source = { width: 120, height: 257 } as PreviewCanvasSource;
  return createPreviewSurfaceSnapshot({
    surfaceRevision: revision,
    widthMm: 60,
    heightMm: 128.5,
    thicknessMm: 2.5,
    rasterSize: { widthPx: 120, heightPx: 257, effectivePixelsPerMm: 2 },
    canvases: { baseColor: source, metalness: source, roughness: source },
  });
}

function runtime(): PreviewSceneRuntime {
  return {
    maximumTextureSizePx: 4096,
    cameraControls: { dollyBy: vi.fn(), setPanMode: vi.fn(), resetView: vi.fn() },
    applySnapshot: vi.fn(),
    getDebugSummary: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('preview surface controller', () => {
  it('publishes current document revisions while ignoring duplicate document identity', () => {
    const scene = runtime();
    const generate = vi.fn(({ ticket }) => snapshot(ticket.surfaceRevision));
    const close = vi.fn();
    const onReady = vi.fn();
    const controller = createPreviewSurfaceController({
      runtime: scene,
      onReady,
      onError: vi.fn(),
      createGenerator: () => ({ generate, close }),
    });
    const first: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
    const second: DocState = { ...first, layers: createPcbLayerStack() };

    controller.update(first);
    controller.update(first);
    controller.update(second);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.map(([input]) => input.ticket.surfaceRevision)).toEqual([1, 2]);
    expect(scene.applySnapshot).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenLastCalledWith(expect.objectContaining({ surfaceRevision: 2 }));
    controller.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('regenerates a same-revision surface after a coalesced font-ready invalidation', async () => {
    const scene = runtime();
    let generatorOptions: PreviewSurfaceMapGeneratorOptions | null = null;
    const generator: PreviewSurfaceMapGenerator = {
      generate: vi.fn(({ ticket }) => snapshot(ticket.surfaceRevision)),
      close: vi.fn(),
    };
    const controller = createPreviewSurfaceController({
      runtime: scene,
      onReady: vi.fn(),
      onError: vi.fn(),
      createGenerator: (options) => {
        generatorOptions = options;
        return generator;
      },
    });
    controller.update({ panelHp: 12, guides: [], layers: createPcbLayerStack() });

    generatorOptions!.onFontReadyRevision?.(1);
    generatorOptions!.onFontReadyRevision?.(1);
    await Promise.resolve();

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(scene.applySnapshot).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(scene.applySnapshot).mock.calls.map(([value]) => value.surfaceRevision),
    ).toEqual([1, 1]);
    controller.close();
  });

  it('closes cancellation ownership and ignores late font work', async () => {
    const scene = runtime();
    let generatorOptions: PreviewSurfaceMapGeneratorOptions | null = null;
    const generator: PreviewSurfaceMapGenerator = {
      generate: vi.fn(({ ticket }) => snapshot(ticket.surfaceRevision)),
      close: vi.fn(),
    };
    const controller = createPreviewSurfaceController({
      runtime: scene,
      onReady: vi.fn(),
      onError: vi.fn(),
      createGenerator: (options) => {
        generatorOptions = options;
        return generator;
      },
    });
    controller.update({ panelHp: 12, guides: [], layers: createPcbLayerStack() });
    controller.close();
    generatorOptions!.onFontReadyRevision?.(1);
    await Promise.resolve();

    expect(generator.generate).toHaveBeenCalledOnce();
    expect(generator.close).toHaveBeenCalledOnce();
    expect(scene.applySnapshot).toHaveBeenCalledOnce();
  });

  it('reports generation failures without publishing an incomplete snapshot', () => {
    const scene = runtime();
    const error = new Error('surface failed');
    const onError = vi.fn();
    const controller = createPreviewSurfaceController({
      runtime: scene,
      onReady: vi.fn(),
      onError,
      createGenerator: () => ({
        generate: () => {
          throw error;
        },
        close: vi.fn(),
      }),
    });

    controller.update({ panelHp: 12, guides: [], layers: createPcbLayerStack() });
    expect(onError).toHaveBeenCalledWith(error);
    expect(scene.applySnapshot).not.toHaveBeenCalled();
    controller.close();
  });
});
