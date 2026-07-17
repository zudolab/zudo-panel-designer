// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pt } from '@zpd/core';
import './add-image'; // registers 'add-image' as a side effect
import { allAddActions } from '../registry/add-actions';
import type { ToolContext } from '../types';

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
  vi.restoreAllMocks();
});

function stubCtx(): ToolContext {
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
  } as unknown as ToolContext;
}

function getAddImageAction() {
  return allAddActions().find((a) => a.id === 'add-image')!;
}

describe('add-image action', () => {
  it('registers itself under id "add-image"', () => {
    expect(getAddImageAction()).toBeDefined();
  });

  it('logs instead of throwing an unhandled rejection when the picked file fails to decode', async () => {
    stubFailingImageProbe();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = stubCtx();
    const file = new File(['bad-bytes'], 'corrupt.png', { type: 'image/png' });

    // the picker <input> is a transient element never appended to the DOM
    // (see add-image.ts), so capture the one run() creates via createElement.
    const originalCreateElement = document.createElement.bind(document);
    let input: HTMLInputElement | undefined;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') input = el as HTMLInputElement;
      return el;
    });

    getAddImageAction().run(ctx);
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change'));

    // let the FileReader + probe microtasks settle
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

    expect(errorSpy.mock.calls[0][0]).toBe('add-image:');
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(ctx.select).not.toHaveBeenCalled();
  });
});
