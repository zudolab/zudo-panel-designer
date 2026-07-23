// @vitest-environment jsdom
//
// jsdom implements FileReader.readAsDataURL for real, but (per trace.test.tsx)
// never fires Image onload/onerror for a data: URL — so the natural-size
// probe is stubbed here to drive the async decode deterministically.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcbLayerStack } from '@zpd/core';
import type { Pt } from '@zpd/core';
import { importImageFile } from './import-image';
import { projectFlatLayers } from './flat-projection';
import type { ToolContext } from './types';

function stubImageProbe(naturalWidth: number, naturalHeight: number) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    private _src = '';
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

function stubFailingImageProbe() {
  class FailingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onerror?.());
    }
  }
  vi.stubGlobal('Image', FailingImage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: createPcbLayerStack() },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn(),
    replace: vi.fn(),
    reset: vi.fn(),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    evictImageCache: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
}

describe('importImageFile', () => {
  it('reads the file, scales to fit within the panel, commits ONE layer, and selects it', async () => {
    stubImageProbe(400, 200);
    const ctx = stubCtx();
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

    await importImageFile(file, ctx);

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const layers = projectFlatLayers(committed.layers);
    expect(layers).toHaveLength(1);

    const layer = layers[0];
    if (layer?.type !== 'image') throw new Error('expected imported image layer');
    // regression parity with the pre-extraction add-image add-action: same
    // shape, same scale-to-fit math (maxW = 60*0.8 = 48, maxH = 128.5*0.5 =
    // 64.25; scale = min(48/400, 64.25/200, 1) = 0.12).
    expect(layer.type).toBe('image');
    expect(layer.name).toBe('photo.png');
    expect(layer.id).toMatch(/^image-/);
    expect(layer.src.startsWith('data:')).toBe(true);
    expect(layer.width).toBeCloseTo(48, 5);
    expect(layer.height).toBeCloseTo(24, 5);
    expect(layer.x).toBeCloseTo(6, 5); // snapToGrid(60 * 0.1)
    expect(layer.y).toBeCloseTo(19.3, 5); // snapToGrid(128.5 * 0.15)

    expect(ctx.select).toHaveBeenCalledWith(layer.id);
    expect(ctx.select).toHaveBeenCalledTimes(1);
  });

  it('appends onto the existing layers rather than replacing them', async () => {
    stubImageProbe(100, 100);
    const existing = {
      id: 'shape-1',
      name: 'shape-1',
      type: 'shape' as const,
      shape: 'rect' as const,
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: 1 as const,
    };
    const ctx = stubCtx({
      doc: { panelHp: 12, guides: [], layers: createPcbLayerStack({ copper: [existing] }) },
    });
    const file = new File(['bytes'], 'a.png', { type: 'image/png' });

    await importImageFile(file, ctx);

    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const layers = projectFlatLayers(committed.layers);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toBe(existing);
  });

  it('never grows an image beyond its natural size (scale caps at 1)', async () => {
    stubImageProbe(10, 10); // far smaller than the 48x64.25mm cap
    const ctx = stubCtx();
    const file = new File(['bytes'], 'tiny.png', { type: 'image/png' });

    await importImageFile(file, ctx);

    const layer = projectFlatLayers(
      (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0].layers,
    )[0];
    if (layer?.type !== 'image') throw new Error('expected imported image layer');
    expect(layer.width).toBe(10);
    expect(layer.height).toBe(10);
  });

  it('rejects and does not commit when the probe fails to decode', async () => {
    stubFailingImageProbe();
    const ctx = stubCtx();
    const file = new File(['bytes'], 'bad.png', { type: 'image/png' });

    await expect(importImageFile(file, ctx)).rejects.toThrow();
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(ctx.select).not.toHaveBeenCalled();
  });
});
