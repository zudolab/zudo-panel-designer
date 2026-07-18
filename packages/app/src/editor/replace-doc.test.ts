import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocState, ImageLayer, Pt, TextLayer } from '@zpd/core';
import { replaceDoc } from './replace-doc';
import type { ToolContext } from './types';
import {
  getTextGeometry,
  reconcileTextGeometry,
  resetTextGeometryForTests,
  setTextMeasureForTests,
} from './text-geometry';

afterEach(() => resetTextGeometryForTests());

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

  it('clears render-only text geometry before a same-id next document', () => {
    resetTextGeometryForTests();
    const oldLayer: TextLayer = {
      id: 'reused-text',
      name: 'Old',
      type: 'text',
      content: 'OLD',
      fontFamily: 'sans-serif',
      sizeMm: 8,
      x: 10,
      y: 20,
      rotation: 90,
      color: 1,
    };
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width: 40,
      height: 20,
    }));
    reconcileTextGeometry([oldLayer]);
    expect(getTextGeometry(oldLayer)!.pivot).toEqual({ x: 30, y: 30 });

    const nextLayer = { ...oldLayer, name: 'New' };
    const nextDoc: DocState = { panelHp: 6, guides: [], layers: [nextLayer] };
    replaceDoc(nextDoc, stubCtx());
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width: 12,
      height: 10,
    }));
    reconcileTextGeometry(nextDoc.layers);
    expect(getTextGeometry(nextLayer)!.pivot).toEqual({ x: 16, y: 25 });
  });
});
