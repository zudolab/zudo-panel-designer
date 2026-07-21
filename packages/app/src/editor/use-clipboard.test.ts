// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultDoc,
  type DocState,
  type Layer,
  type PathLayer,
  type Pt,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { useClipboard } from './use-clipboard';
import { importImageFile } from './import-image';
import { classifyImportFile, sniffedRasterMimeType } from './svg-import/classify-file';
import type { ToolContext } from './types';

vi.mock('./import-image', () => ({ importImageFile: vi.fn(() => Promise.resolve()) }));
// jsdom (as pinned in this repo) implements FileReader but not the
// Blob/File read methods (arrayBuffer()/text()) that classifyImportFile and
// sniffedRasterMimeType use for their magic-byte/root-sniff checks -- see
// classify-file.test.ts's own header comment. Mocked here (classifyImportFile
// default: 'raster', matching every existing image-paste test's plain PNG
// fixture; sniffedRasterMimeType default: null, i.e. "the claimed type was
// already right", matching every fixture's already-correct image/png type)
// so routeImportFile's dispatch can be exercised without hitting that jsdom
// gap; both functions' own sniffing logic has its own real-environment tests
// (svg-import/classify-file.test.ts).
vi.mock('./svg-import/classify-file', () => ({
  classifyImportFile: vi.fn(),
  sniffedRasterMimeType: vi.fn(),
}));

const shapeLayer: ShapeLayer = {
  id: 'shape-1',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 10,
  y: 5,
  width: 20,
  height: 10,
  color: 1,
};

const textLayer: TextLayer = {
  id: 'text-1',
  name: 'Label',
  type: 'text',
  content: 'hi',
  fontFamily: 'Inter',
  sizeMm: 4,
  x: 1,
  y: 2,
  color: 0,
};

// Mirrors Editor.tsx's real ToolContext wiring: `doc`/`selectedIds` are LIVE
// getters, `commit`/`selectIds`/etc. mutate the same backing state, so the
// hook's handlers (which read ctx.doc/ctx.selectedIds fresh on every call)
// behave exactly as they do wired into the real Editor.
function createCtx(doc: DocState, selectedIds: readonly string[] = []) {
  let currentDoc = doc;
  let currentSelectedIds: readonly string[] = selectedIds;
  const ctx = {
    get doc() {
      return currentDoc;
    },
    get selectedIds() {
      return currentSelectedIds;
    },
    get selectedId() {
      return currentSelectedIds.length === 1 ? currentSelectedIds[0] : null;
    },
    get selectedLayer() {
      return currentDoc.layers.find((l) => l.id === ctx.selectedId) ?? null;
    },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn((next: DocState) => {
      currentDoc = next;
    }),
    replace: vi.fn((next: DocState) => {
      currentDoc = next;
    }),
    reset: vi.fn((next: DocState) => {
      currentDoc = next;
    }),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn((id: string | null) => {
      currentSelectedIds = id === null ? [] : [id];
    }),
    selectIds: vi.fn((ids: readonly string[]) => {
      currentSelectedIds = ids;
    }),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    evictImageCache: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
  };
  return ctx as unknown as ToolContext;
}

function baseDoc(layers: Layer[]): DocState {
  const doc = createDefaultDoc(); // seeds one pattern layer, 'layer-default-dot-grid'
  return { ...doc, layers: [...doc.layers, ...layers] };
}

function dispatchPaste(
  target: EventTarget,
  opts: { text?: string; imageFile?: File } = {},
): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const items = opts.imageFile
    ? [{ kind: 'file', type: opts.imageFile.type, getAsFile: () => opts.imageFile ?? null }]
    : [];
  const clipboardData = {
    items: items as unknown as DataTransferItemList,
    getData: (format: string) => (format === 'text/plain' ? (opts.text ?? '') : ''),
  };
  Object.defineProperty(event, 'clipboardData', { value: clipboardData, configurable: true });
  target.dispatchEvent(event);
  return event;
}

// jsdom's File has no text() at all (see the classify-file mock comment
// above) -- routeImportFile's svg branch calls file.text() directly, so it
// is stubbed per-instance here, independent of jsdom's Blob prototype.
function svgFile(text: string, name: string, type = 'image/svg+xml'): File {
  const file = new File([text], name, { type });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
  return file;
}

function dispatchSvgPaste(target: EventTarget, file: File): ClipboardEvent {
  // A real DataTransferItem exposes no filename — only getAsFile().name does
  // — so the item's `type` here mirrors what an actual browser paste would
  // report for the file, same as dispatchPaste's imageFile shape above.
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const items = [{ kind: 'file', type: file.type, getAsFile: () => file }];
  const clipboardData = {
    items: items as unknown as DataTransferItemList,
    getData: () => '',
  };
  Object.defineProperty(event, 'clipboardData', { value: clipboardData, configurable: true });
  target.dispatchEvent(event);
  return event;
}

function dispatchKeydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.mocked(importImageFile).mockClear();
  vi.mocked(importImageFile).mockResolvedValue(undefined);
  // Default: every pre-existing image-paste test pastes a plain PNG fixture
  // and expects the raster path; the #141 svg tests below override this.
  vi.mocked(classifyImportFile).mockReset();
  vi.mocked(classifyImportFile).mockResolvedValue('raster');
  vi.mocked(sniffedRasterMimeType).mockReset();
  vi.mocked(sniffedRasterMimeType).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('useClipboard — copy/cut', () => {
  // #97 (movable pattern square): patterns join copy/cut/paste/duplicate —
  // the pre-#97 versions of these tests proved the opposite exclusions.
  it('handleCopy includes a directly-selected pattern and leaves the doc untouched', () => {
    const doc = baseDoc([shapeLayer, textLayer]);
    const ctx = createCtx(doc, ['shape-1', 'layer-default-dot-grid']);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleCopy());
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(ctx.doc.layers).toHaveLength(doc.layers.length);

    // paste the capture back: shape + pattern clones, cascade-offset squares
    act(() => dispatchPaste(window));
    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(doc.layers.length + 2);
    const patternClone = ctx.doc.layers.find(
      (l) => l.type === 'pattern' && l.id !== 'layer-default-dot-grid',
    );
    const original = ctx.doc.layers.find((l) => l.id === 'layer-default-dot-grid');
    if (patternClone?.type !== 'pattern' || original?.type !== 'pattern') {
      throw new Error('expected a pattern clone and its untouched original');
    }
    expect(patternClone.x).toBeCloseTo(original.x + 2, 5);
    expect(patternClone.y).toBeCloseTo(original.y + 2, 5);
    expect(patternClone.size).toBe(original.size);
  });

  it('handleCopy on an empty selection is a no-op', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, []);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleCopy());
    // Nothing captured — a subsequent paste has nothing to fall back to.
    act(() => dispatchPaste(window));
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('handleCut removes the selection (pattern INCLUDED, #97) as ONE undo entry and updates selection', () => {
    const doc = baseDoc([shapeLayer, textLayer]);
    const ctx = createCtx(doc, ['shape-1', 'text-1', 'layer-default-dot-grid']);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleCut());

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toEqual([]);
    expect(ctx.selectedIds).toEqual([]);
  });

  it('handleCut with nothing selected does not commit', () => {
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleCut());
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});

describe('useClipboard — copy -> paste round trip (internal clipboard)', () => {
  it('pastes fresh ids offset by the 2mm cascade, selects the clones, ONE undo entry', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, ['shape-1']);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleCopy());
    act(() => dispatchPaste(window));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(3); // pattern + original + clone
    const pasted = ctx.doc.layers.find(
      (l) => l.id !== 'shape-1' && l.type !== 'pattern',
    ) as ShapeLayer;
    expect(pasted).toBeDefined();
    expect(pasted.id).not.toBe(shapeLayer.id);
    expect(pasted.x).toBeCloseTo(shapeLayer.x + 2, 5);
    expect(pasted.y).toBeCloseTo(shapeLayer.y + 2, 5);
    expect(ctx.selectedIds).toEqual([pasted.id]);
    // source untouched
    const original = ctx.doc.layers.find((l) => l.id === 'shape-1') as ShapeLayer;
    expect(original).toMatchObject({ x: shapeLayer.x, y: shapeLayer.y });
  });

  it('a paste with an empty internal clipboard and no OS clipboard content is a no-op', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));

    act(() => dispatchPaste(window));
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});

describe('useClipboard — Cmd/Ctrl+D duplicate', () => {
  // #97: the selected pattern duplicates too — 3 clones, not 2.
  it('clones the selection (pattern included) with the same clone+offset technique, ONE undo entry', () => {
    const doc = baseDoc([shapeLayer, textLayer]);
    const ctx = createCtx(doc, ['shape-1', 'text-1', 'layer-default-dot-grid']);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleDuplicate());

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(6); // 3 originals + 3 clones
    const newIds = ctx.doc.layers
      .map((l) => l.id)
      .filter((id) => id !== 'shape-1' && id !== 'text-1' && id !== 'layer-default-dot-grid');
    expect(newIds).toHaveLength(3);
    expect(ctx.selectedIds).toEqual(newIds);
  });

  // #97: a pattern-only selection now duplicates (multiple squares are
  // legitimately useful); only an EMPTY selection stays a no-op.
  it('duplicating a pattern-only selection clones the square with the cascade offset', () => {
    const doc = baseDoc([]);
    const ctx = createCtx(doc, ['layer-default-dot-grid']);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleDuplicate());
    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(2);
    const [original, clone] = ctx.doc.layers;
    if (original?.type !== 'pattern' || clone?.type !== 'pattern') {
      throw new Error('expected two pattern layers');
    }
    expect(clone.x).toBeCloseTo(original.x + 2, 5);
    expect(clone.size).toBe(original.size);
    expect(ctx.selectedIds).toEqual([clone.id]);
  });

  it('duplicating an empty selection does not commit', () => {
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleDuplicate());
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});

describe('useClipboard — Cmd/Ctrl+A select-all', () => {
  // Still pattern-free after #97 — the ONE deliberate clipboard exception:
  // a background-ish cover square must not join every "select all and move".
  it('selects every non-pattern layer', () => {
    const doc = baseDoc([shapeLayer, textLayer]);
    const ctx = createCtx(doc, []);
    const { result } = renderHook(() => useClipboard(ctx));

    act(() => result.current.handleSelectAll());

    expect(ctx.selectIds).toHaveBeenCalledWith(['shape-1', 'text-1']);
    expect(ctx.selectedIds).toEqual(['shape-1', 'text-1']);
  });
});

describe('useClipboard — handleCopy writes the versioned OS envelope', () => {
  it('writes {app:"zpd", kind:"layers", version:1, layers:[...]} to navigator.clipboard.writeText', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const doc = baseDoc([shapeLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));

      act(() => result.current.handleCopy());

      expect(writeText).toHaveBeenCalledTimes(1);
      const envelope = JSON.parse(writeText.mock.calls[0][0] as string);
      expect(envelope).toMatchObject({ app: 'zpd', kind: 'layers', version: 1 });
      expect(envelope.layers).toEqual([shapeLayer]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a denied/unavailable OS clipboard degrades silently — internal clipboard still works', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: () => {
          throw new Error('permission denied');
        },
      },
    });
    try {
      const doc = baseDoc([shapeLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));

      expect(() => act(() => result.current.handleCopy())).not.toThrow();

      act(() => dispatchPaste(window)); // internal-clipboard fallback
      expect(ctx.commit).toHaveBeenCalledTimes(1);
      expect(ctx.doc.layers).toHaveLength(3); // pattern + original + clone
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('an in-flight write does not let stale OS text suppress the internal fallback; once it resolves, unrelated text is untouched again', async () => {
    let resolveWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const writeText = vi.fn().mockReturnValue(pendingWrite);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const doc = baseDoc([shapeLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));

      act(() => result.current.handleCopy()); // write is now in flight (unresolved)

      // The OS clipboard currently holds unrelated text that PRE-DATES this
      // copy (the write hasn't landed yet) — must NOT be treated as a
      // deliberate foreign paste while the write is pending.
      act(() => dispatchPaste(window, { text: 'stale unrelated text' }));
      expect(ctx.commit).toHaveBeenCalledTimes(1);
      expect(ctx.doc.layers).toHaveLength(3); // pattern + original + clone

      // Once the write resolves, the normal "foreign text wins" rule applies
      // again — a second unrelated paste is left untouched.
      await act(async () => {
        resolveWrite();
        await pendingWrite;
      });
      vi.mocked(ctx.commit).mockClear();
      act(() => dispatchPaste(window, { text: 'stale unrelated text' }));
      expect(ctx.commit).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('while our own write is in flight, a STALE prior zpd envelope on the OS clipboard does NOT win over the just-copied internal snapshot', () => {
    // copy A, copy B, immediate paste: the OS clipboard still holds envelope A
    // (this session's B write hasn't landed). Parsing the envelope BEFORE the
    // pending-write guard used to paste stale A; the internal snapshot (B) must
    // win instead.
    const writeText = vi.fn().mockReturnValue(new Promise<void>(() => {})); // never resolves → stays pending
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const doc = baseDoc([shapeLayer, textLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));

      act(() => result.current.handleCopy()); // internal snapshot = [shapeLayer]; write in flight

      // A DIFFERENT layer's envelope (a prior copy) sitting on the OS clipboard.
      const staleEnvelope = JSON.stringify({
        app: 'zpd',
        kind: 'layers',
        version: 1,
        layers: [textLayer],
      });
      act(() => dispatchPaste(window, { text: staleEnvelope }));

      // Pasted the internal shape snapshot's clone, NOT the stale envelope's text layer.
      expect(ctx.commit).toHaveBeenCalledTimes(1);
      const pasted = ctx.doc.layers.find(
        (l) => l.id !== 'shape-1' && l.id !== 'text-1' && l.type !== 'pattern',
      );
      expect(pasted?.type).toBe('shape');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('overlapping writes: an EARLIER write settling does not clear the pending state while a LATER write is still in flight', async () => {
    // copy A (shape), copy B (text) before A settles, settle ONLY A, then
    // paste. The OS clipboard now holds envelope A, but the latest copy is B —
    // a single boolean would read "no write pending" (A cleared it) and paste
    // stale A; the outstanding-writes counter keeps B winning.
    let resolveA!: () => void;
    const writeA = new Promise<void>((resolve) => {
      resolveA = resolve;
    });
    const writeB = new Promise<void>(() => {}); // never settles → B stays in flight
    const writeText = vi.fn().mockReturnValueOnce(writeA).mockReturnValueOnce(writeB);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      const doc = baseDoc([shapeLayer, textLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));

      act(() => result.current.handleCopy()); // copy A = shapeLayer, write A in flight
      act(() => ctx.selectIds(['text-1']));
      act(() => result.current.handleCopy()); // copy B = textLayer, write B in flight; internal = [textLayer]

      // Settle ONLY write A — the OS clipboard now reflects envelope A.
      await act(async () => {
        resolveA();
        await writeA;
      });

      const envelopeA = JSON.stringify({
        app: 'zpd',
        kind: 'layers',
        version: 1,
        layers: [shapeLayer],
      });
      act(() => dispatchPaste(window, { text: envelopeA }));

      // Write B is still outstanding, so the internal snapshot (textLayer) wins.
      expect(ctx.commit).toHaveBeenCalledTimes(1);
      const pasted = ctx.doc.layers.find(
        (l) => l.id !== 'shape-1' && l.id !== 'text-1' && l.type !== 'pattern',
      );
      expect(pasted?.type).toBe('text');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('useClipboard — paste priority: image > envelope > internal', () => {
  it('an image on the OS clipboard wins even when the internal clipboard also has layers', async () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, ['shape-1']);
    const { result } = renderHook(() => useClipboard(ctx));
    act(() => result.current.handleCopy()); // populate the internal clipboard too

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    let event!: ClipboardEvent;
    act(() => {
      event = dispatchPaste(window, { imageFile: file });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(importImageFile).toHaveBeenCalledTimes(1);
    expect(importImageFile).toHaveBeenCalledWith(file, ctx);
    // Internal-clipboard paste (a doc commit) must NOT also have fired.
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('a zpd envelope on the OS clipboard wins over the internal clipboard when there is no image', () => {
    // The envelope as handleCopy would have written it for a DIFFERENT
    // session/tab's selection (shapeLayer) — built by hand here so this test
    // doesn't need a second concurrently-mounted hook instance (which would
    // register a second `window` paste listener and cross-fire).
    const envelopeText = JSON.stringify({
      app: 'zpd',
      kind: 'layers',
      version: 1,
      layers: [shapeLayer],
    });

    const doc = baseDoc([textLayer]);
    const ctx = createCtx(doc, ['text-1']);
    const { result } = renderHook(() => useClipboard(ctx));
    act(() => result.current.handleCopy()); // populates THIS session's internal clipboard with textLayer

    act(() => dispatchPaste(window, { text: envelopeText }));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const pasted = ctx.doc.layers.find((l) => l.id !== 'text-1' && l.type !== 'pattern');
    expect(pasted).toMatchObject({ type: 'shape', x: shapeLayer.x + 2, y: shapeLayer.y + 2 });
  });

  it('falls back to the internal clipboard when the OS clipboard has neither an image nor any text', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, ['shape-1']);
    const { result } = renderHook(() => useClipboard(ctx));
    act(() => result.current.handleCopy());

    act(() => dispatchPaste(window)); // no clipboardData.items, no text

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(3); // pattern + original + clone
  });
});

describe('useClipboard — pasting an SVG file (#141)', () => {
  it('routes a pasted SVG file to the svg-import dialog instead of importing it as a raster layer', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));
    const file = svgFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'icon.svg');

    let event!: ClipboardEvent;
    act(() => {
      event = dispatchSvgPaste(window, file);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(ctx.openDialog).toHaveBeenCalledWith('svg-import', {
      fileName: 'icon.svg',
      svgText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(importImageFile).not.toHaveBeenCalled();
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('falls back to "clipboard.svg" when the pasted file has no name', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));
    const file = svgFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', '');

    act(() => {
      dispatchSvgPaste(window, file);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ctx.openDialog).toHaveBeenCalledWith(
      'svg-import',
      expect.objectContaining({ fileName: 'clipboard.svg' }),
    );
  });

  it('routes a .svg-named file with a generic MIME type by its extension', async () => {
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));
    // A generic/empty MIME type proves the .svg-name fallback in
    // use-clipboard.ts's file-item predicate, independent of classification
    // (mocked above) which only takes over once the item is already found.
    const file = svgFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'icon.svg', '');

    act(() => {
      dispatchSvgPaste(window, file);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ctx.openDialog).toHaveBeenCalledWith('svg-import', {
      fileName: 'icon.svg',
      svgText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
  });

  it('routes an anonymous clipboard blob (no MIME type, no name) through the classifier instead of dropping it', async () => {
    // Neither the type-based nor the name-based signal fires here -- this is
    // exactly the gap a real SVG copy without either identifying field would
    // fall into; the file-item predicate has a dedicated fallback for it.
    vi.mocked(classifyImportFile).mockResolvedValue('svg');
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));
    const file = svgFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', '', '');

    act(() => {
      dispatchSvgPaste(window, file);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ctx.openDialog).toHaveBeenCalledWith('svg-import', {
      fileName: 'clipboard.svg',
      svgText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
  });
});

describe('useClipboard — non-envelope text is left untouched', () => {
  it('plain text on the OS clipboard is ignored, and skips the internal-clipboard fallback too', () => {
    const doc = baseDoc([shapeLayer, textLayer]);
    const ctx = createCtx(doc, ['text-1']);
    const { result } = renderHook(() => useClipboard(ctx));
    act(() => result.current.handleCopy()); // internal clipboard now has textLayer

    let event!: ClipboardEvent;
    act(() => {
      event = dispatchPaste(window, { text: 'just a normal sentence, not JSON at all' });
    });

    expect(event.defaultPrevented).toBe(false);
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(importImageFile).not.toHaveBeenCalled();
  });

  it('JSON text that is not a zpd envelope (wrong app/kind/version) is ignored', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));

    act(() =>
      dispatchPaste(window, {
        text: JSON.stringify({
          app: 'other-app',
          kind: 'layers',
          version: 1,
          layers: [shapeLayer],
        }),
      }),
    );
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});

describe('useClipboard — pattern layers in envelopes (#97)', () => {
  // Pre-#97 the parser filtered patterns out of envelopes; they now paste
  // like any layer (cross-tab pattern copy is a legitimate flow).
  it('an envelope carrying a pattern layer pastes it with the cascade offset', () => {
    const patternLayer = baseDoc([]).layers[0];
    const envelopeText = JSON.stringify({
      app: 'zpd',
      kind: 'layers',
      version: 1,
      layers: [patternLayer],
    });

    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));

    act(() => dispatchPaste(window, { text: envelopeText }));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.doc.layers).toHaveLength(2);
    const pasted = ctx.doc.layers[1];
    if (pasted.type !== 'pattern' || patternLayer.type !== 'pattern') {
      throw new Error('expected pattern layers');
    }
    expect(pasted.id).not.toBe(patternLayer.id);
    expect(pasted.x).toBeCloseTo(patternLayer.x + 2, 5);
    expect(pasted.size).toBe(patternLayer.size);
  });
});

describe('useClipboard — envelope layer validation', () => {
  it('a structurally incomplete layer in an otherwise-valid envelope is defended, not crashed or inserted as garbage geometry', () => {
    const doc = baseDoc([]);
    const ctx = createCtx(doc, []);
    renderHook(() => useClipboard(ctx));

    // Missing points/closed/fill/stroke/strokeWidth — a hand-edited or
    // older-tool envelope could plausibly produce this.
    const envelopeText = JSON.stringify({
      app: 'zpd',
      kind: 'layers',
      version: 1,
      layers: [{ id: 'p', type: 'path' }],
    });

    expect(() => act(() => dispatchPaste(window, { text: envelopeText }))).not.toThrow();
    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const pasted = ctx.doc.layers.find((l) => l.type !== 'pattern') as PathLayer;
    expect(pasted).toBeDefined();
    expect(pasted.points).toEqual([]);
    expect(pasted.strokeWidth).toBe(0);
  });
});

describe('useClipboard — editable-target guard', () => {
  it('does not paste when the event target is an editable element, even with an image on the clipboard', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      const doc = baseDoc([shapeLayer]);
      const ctx = createCtx(doc, ['shape-1']);
      const { result } = renderHook(() => useClipboard(ctx));
      act(() => result.current.handleCopy());

      const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
      act(() => {
        dispatchPaste(input, { imageFile: file, text: 'irrelevant' });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(importImageFile).not.toHaveBeenCalled();
      expect(ctx.commit).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });
});

describe('useClipboard — no keydown V handler', () => {
  it('exposes no paste-related handler at all — nothing a keydown listener could wire a "v" case to', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, ['shape-1']);
    const { result } = renderHook(() => useClipboard(ctx));

    expect(Object.keys(result.current).sort()).toEqual(
      ['handleCopy', 'handleCut', 'handleDuplicate', 'handleSelectAll'].sort(),
    );
    expect('handlePaste' in result.current).toBe(false);
  });

  it('a Cmd/Ctrl+V keydown (only the paste EVENT should ever trigger a paste) has no effect', () => {
    const doc = baseDoc([shapeLayer]);
    const ctx = createCtx(doc, ['shape-1']);
    const { result } = renderHook(() => useClipboard(ctx));
    act(() => result.current.handleCopy());
    vi.mocked(ctx.commit).mockClear();

    act(() => dispatchKeydown(window, { key: 'v', metaKey: true }));
    act(() => dispatchKeydown(window, { key: 'v', ctrlKey: true }));

    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('Editor.tsx source has no keydown branch calling a paste handler for the v key', () => {
    const editorPath = join(dirname(fileURLToPath(import.meta.url)), 'Editor.tsx');
    const source = readFileSync(editorPath, 'utf8');
    expect(source).not.toMatch(/handlePaste/);
    expect(source).not.toMatch(/case ['"]v['"]/);
  });
});
