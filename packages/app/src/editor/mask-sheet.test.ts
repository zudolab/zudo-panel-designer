import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer, Layer, PathLayer, ShapeLayer, TextLayer } from '@zpd/core';

interface RecordedPaintLayerCall {
  readonly layerId: string;
  readonly compositeOperation: string;
  readonly loadingTextAlpha: number | undefined;
  readonly colorFor: unknown;
}

const paintLayerCalls: RecordedPaintLayerCall[] = [];

// paintMaskPunches consumes the shared paintLayer as a black box (issue #178
// says it must stay unmodified); mocking it here isolates what this file
// owns — leaf selection, composite-op set/restore, and option forwarding —
// from paintLayer's own per-type drawing, already covered by renderer.test.ts.
vi.mock('./renderer', () => ({
  paintLayer: vi.fn(
    (
      ctx: CanvasRenderingContext2D,
      layer: Layer,
      options: { colorFor: unknown; loadingTextAlpha?: number },
    ) => {
      paintLayerCalls.push({
        layerId: layer.id,
        compositeOperation: ctx.globalCompositeOperation,
        loadingTextAlpha: options.loadingTextAlpha,
        colorFor: options.colorFor,
      });
    },
  ),
}));

import { acquireMaskSheet, paintMaskPunches, type MaskSheetSource } from './mask-sheet';

function shape(id: string, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id,
    name: id,
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: 0,
    ...extra,
  };
}

function textLayer(id: string): TextLayer {
  return {
    id,
    name: id,
    type: 'text',
    content: 'hi',
    fontFamily: 'Inter',
    sizeMm: 5,
    x: 0,
    y: 0,
    color: 0,
  };
}

function pathLayer(id: string): PathLayer {
  return {
    id,
    name: id,
    type: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    extraSubpaths: [
      [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
      ],
    ],
    closed: true,
    fill: 0,
    stroke: null,
    strokeWidth: 0,
  };
}

function imageLayer(id: string): ImageLayer {
  return {
    id,
    name: id,
    type: 'image',
    src: 'data:image/png;base64,fixture',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };
}

function createRecordingCtx(): CanvasRenderingContext2D {
  const stateStack: Array<{ globalCompositeOperation: string }> = [];
  let state = { globalCompositeOperation: 'source-over' };
  return {
    get globalCompositeOperation() {
      return state.globalCompositeOperation;
    },
    set globalCompositeOperation(value: string) {
      state.globalCompositeOperation = value;
    },
    save: vi.fn(() => stateStack.push({ ...state })),
    restore: vi.fn(() => {
      state = stateStack.pop() ?? state;
    }),
  } as unknown as CanvasRenderingContext2D;
}

describe('paintMaskPunches', () => {
  beforeEach(() => {
    paintLayerCalls.length = 0;
  });

  it('skips hidden leaves and image leaves, preserving order of the rest', () => {
    const ctx = createRecordingCtx();
    const shapeA = shape('a');
    const hidden = shape('hidden', { hidden: true });
    const image = imageLayer('img');
    const text = textLayer('t');
    const path = pathLayer('p');
    const shapeB = shape('b');

    paintMaskPunches(ctx, [shapeA, hidden, image, text, path, shapeB], {
      colorFor: () => '#000000',
    });

    expect(paintLayerCalls.map((c) => c.layerId)).toEqual(['a', 't', 'p', 'b']);
  });

  it('punches under a destination-out composite operation', () => {
    const ctx = createRecordingCtx();
    paintMaskPunches(ctx, [shape('a'), shape('b')], { colorFor: () => '#000000' });

    expect(paintLayerCalls.every((c) => c.compositeOperation === 'destination-out')).toBe(true);
  });

  it('restores the prior composite operation via save/restore, not a hardcoded reset', () => {
    const ctx = createRecordingCtx();
    ctx.globalCompositeOperation = 'multiply';

    paintMaskPunches(ctx, [shape('a')], { colorFor: () => '#000000' });

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.globalCompositeOperation).toBe('multiply');
  });

  it('forwards loadingTextAlpha: 1 so a loading text leaf still punches at full alpha', () => {
    const ctx = createRecordingCtx();
    paintMaskPunches(ctx, [textLayer('t')], { colorFor: () => '#000000' });

    expect(paintLayerCalls[0].loadingTextAlpha).toBe(1);
  });

  it('forwards the caller colorFor unchanged', () => {
    const ctx = createRecordingCtx();
    const colorFor = vi.fn(() => '#123456');

    paintMaskPunches(ctx, [shape('a')], { colorFor });

    expect(paintLayerCalls[0].colorFor).toBe(colorFor);
  });

  it('passes a path leaf through unmodified, relying on paintLayer for evenodd holes', () => {
    const ctx = createRecordingCtx();
    const path = pathLayer('p');

    paintMaskPunches(ctx, [path], { colorFor: () => '#000000' });

    expect(paintLayerCalls.map((c) => c.layerId)).toEqual(['p']);
  });
});

function fakeCanvas(widthPx: number, heightPx: number): MaskSheetSource {
  return {
    width: widthPx,
    height: heightPx,
    getContext: () => ({}) as unknown as CanvasRenderingContext2D,
  } as unknown as MaskSheetSource;
}

describe('acquireMaskSheet', () => {
  it('reuses the same canvas allocation for repeated calls at the same dimensions', () => {
    const factory = vi.fn((w: number, h: number) => fakeCanvas(w, h));

    const first = acquireMaskSheet(factory, 64, 128);
    const second = acquireMaskSheet(factory, 64, 128);

    expect(second.canvas).toBe(first.canvas);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('reallocates a fresh canvas when dimensions change', () => {
    const factory = vi.fn((w: number, h: number) => fakeCanvas(w, h));

    const first = acquireMaskSheet(factory, 64, 128);
    const resized = acquireMaskSheet(factory, 96, 128);

    expect(resized.canvas).not.toBe(first.canvas);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('keeps independent allocations per factory identity', () => {
    const factoryA = vi.fn((w: number, h: number) => fakeCanvas(w, h));
    const factoryB = vi.fn((w: number, h: number) => fakeCanvas(w, h));

    const a = acquireMaskSheet(factoryA, 64, 128);
    const b = acquireMaskSheet(factoryB, 64, 128);

    expect(a.canvas).not.toBe(b.canvas);
  });
});
