// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pt } from '@zpd/core';
import './add-image'; // registers 'add-image' as a side effect
import { allAddActions } from '../registry/add-actions';
import { classifyImportFile } from '../svg-import/classify-file';
import type { ToolContext } from '../types';

// jsdom (as pinned in this repo) implements FileReader but not the
// Blob/File read methods (arrayBuffer()/text()) that classifyImportFile
// uses for its magic-byte/root-sniff checks -- see classify-file.test.ts's
// own header comment. Mocked here so routeImportFile's dispatch can be
// exercised without hitting that jsdom gap; classifyImportFile's own
// sniffing logic has its own real-environment tests
// (svg-import/classify-file.test.ts).
vi.mock('../svg-import/classify-file', () => ({ classifyImportFile: vi.fn() }));

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

beforeEach(() => {
  // Default: the decode-failure test below picks a plain PNG and expects
  // the raster path; the #141 svg-routing test overrides this.
  vi.mocked(classifyImportFile).mockReset();
  vi.mocked(classifyImportFile).mockResolvedValue('raster');
});

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

  it('accepts images and SVGs in the native file picker (#141)', () => {
    const originalCreateElement = document.createElement.bind(document);
    let input: HTMLInputElement | undefined;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') input = el as HTMLInputElement;
      return el;
    });

    getAddImageAction().run(stubCtx());

    expect(input?.accept).toBe('image/*,.svg,image/svg+xml');
  });

  it('routes a picked SVG file to the svg-import dialog instead of importing it as a raster layer', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const ctx = stubCtx();
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const file = new File([svgText], 'icon.svg', { type: 'image/svg+xml' });
    // jsdom's File has no text() at all -- routeImportFile's svg branch
    // calls it directly, so it is stubbed per-instance here (see the
    // classify-file mock comment above for why classification is mocked).
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(svgText) });

    const originalCreateElement = document.createElement.bind(document);
    let input: HTMLInputElement | undefined;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'input') input = el as HTMLInputElement;
      return el;
    });

    getAddImageAction().run(ctx);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(ctx.openDialog).toHaveBeenCalled());

    expect(ctx.openDialog).toHaveBeenCalledWith('svg-import', {
      fileName: 'icon.svg',
      svgText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(ctx.commit).not.toHaveBeenCalled();
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
