import { describe, expect, it, vi } from 'vitest';
import type { DocState, ImageLayer, Pt } from '@zpd/core';
import { replaceDoc } from './replace-doc';
import type { ToolContext } from './types';

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: [] },
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

const IMAGE_LAYER: ImageLayer = {
  id: 'image-1',
  name: 'photo',
  type: 'image',
  src: 'data:image/png;base64,AAAA',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
};

describe('replaceDoc', () => {
  it('resets history with the next doc instead of committing (does not push an undo entry)', () => {
    const ctx = stubCtx();
    const nextDoc: DocState = { panelHp: 6, guides: [], layers: [IMAGE_LAYER] };

    replaceDoc(nextDoc, ctx);

    expect(ctx.reset).toHaveBeenCalledWith(nextDoc);
    expect(ctx.reset).toHaveBeenCalledTimes(1);
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(ctx.replace).not.toHaveBeenCalled();
  });

  it('clears the selection', () => {
    const ctx = stubCtx({ selectedIds: ['stale-1'] });
    replaceDoc({ panelHp: 6, guides: [], layers: [] }, ctx);
    expect(ctx.selectIds).toHaveBeenCalledWith([]);
  });

  it('reconciles the image cache against the next doc layers', () => {
    const ctx = stubCtx();
    const nextDoc: DocState = { panelHp: 6, guides: [], layers: [IMAGE_LAYER] };

    replaceDoc(nextDoc, ctx);

    expect(ctx.evictImageCache).toHaveBeenCalledWith(nextDoc.layers);
  });
});
