// @vitest-environment jsdom
//
// jsdom has no IntersectionObserver and we never hit the network: the loader
// and ensureFont are mocked, and a controllable IO stub lets a test fire the
// pagination sentinel by hand. Card fonts therefore stay in their fallback
// face — we assert wiring (filtering, paging, apply, favorites), not glyphs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocState, Pt, TextLayer } from '@zpd/core';
import type { GoogleFontEntry } from '../data/google-fonts-types';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
import { getDialog } from '../registry/dialogs';
import { FONT_FAVORITES_STORAGE_KEY, toggleFontFavorite } from '../use-font-favorites';

vi.mock('../google-font-loader', () => ({
  loadGoogleFont: vi.fn(() => Promise.resolve()),
}));

// vi.mock factories are hoisted above imports, so the spy must be created in a
// hoisted block to be referenceable inside the factory. isFontLoaded is now
// read from ../fonts (the single public readiness API — finding #5), so the
// card's initial-loaded probe is stubbed here.
const { ensureFontMock } = vi.hoisted(() => ({ ensureFontMock: vi.fn(() => Promise.resolve()) }));
vi.mock('../fonts', () => ({
  ensureFont: ensureFontMock,
  isFontLoaded: vi.fn(() => false),
  CURATED_FONTS: [],
  DEFAULT_FONT_FAMILY: 'Oswald',
}));

// Import after the mocks are declared so the dialog binds to them.
import './font-explorer';
import { filterFonts, PAGE_SIZE } from './font-explorer';

/* ── controllable IntersectionObserver ── */

class IOStub {
  cb: IntersectionObserverCallback;
  elements = new Set<Element>();
  disconnected = false;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
}
let ioInstances: IOStub[] = [];

function fireIntersection(target: Element) {
  const rec = [...ioInstances].reverse().find((r) => !r.disconnected && r.elements.has(target));
  if (!rec) throw new Error('no live observer is watching that element');
  act(() => {
    rec.cb(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      rec as unknown as IntersectionObserver,
    );
  });
}

function resetFavorites() {
  localStorage.clear();
  window.dispatchEvent(
    new StorageEvent('storage', { key: FONT_FAVORITES_STORAGE_KEY, newValue: null }),
  );
}

beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal('IntersectionObserver', IOStub as unknown as typeof IntersectionObserver);
  resetFavorites();
  ensureFontMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetFavorites();
});

/* ── ctx + dialog harness ── */

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const ctx = {
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
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
  // Live flat view over whatever doc the stub ended up with (non-enumerable
  // so object spreads never snapshot it).
  Object.defineProperty(ctx, 'flatLayers', {
    get: () => projectFlatLayers(ctx.doc.layers),
  });
  return ctx;
}

function getDialogComponent() {
  return getDialog('font-explorer')!.component;
}

const textLayer: TextLayer = {
  id: 't1',
  name: 'Text',
  type: 'text',
  content: 'Hello',
  fontFamily: 'Oswald',
  sizeMm: 6,
  x: 10,
  y: 20,
  color: 2,
};

function renderDialog(overrides: Partial<ToolContext> = {}, close = vi.fn()) {
  const doc: DocState = { panelHp: 12, guides: [], layers: [textLayer] };
  const ctx = stubCtx({ doc, ...overrides });
  const Dialog = getDialogComponent();
  render(<Dialog props={{ layerId: 't1' }} close={close} ctx={ctx} />);
  return { ctx, close };
}

function cardButtons() {
  return screen.getAllByRole('button', { name: /^Use / });
}

/* ── filterFonts (pure) ── */

describe('filterFonts', () => {
  const fixtures: GoogleFontEntry[] = [
    { family: 'Roboto', category: 'sans-serif', variants: ['regular'], subsets: ['latin'] },
    { family: 'Roboto Slab', category: 'serif', variants: ['regular'], subsets: ['latin'] },
    {
      family: 'Noto Sans JP',
      category: 'sans-serif',
      variants: ['regular'],
      subsets: ['japanese', 'latin'],
    },
    { family: 'Lobster', category: 'display', variants: ['regular'], subsets: ['latin'] },
    { family: 'Fira Code', category: 'monospace', variants: ['regular'], subsets: ['latin'] },
  ];
  const noFav = new Set<string>();

  it('filters by category', () => {
    const result = filterFonts(fixtures, { search: '', category: 'serif', favorites: noFav });
    expect(result.map((f) => f.family)).toEqual(['Roboto Slab']);
  });

  it('derives the Japanese category from the subsets bucket, not the category field', () => {
    const result = filterFonts(fixtures, { search: '', category: 'japanese', favorites: noFav });
    expect(result.map((f) => f.family)).toEqual(['Noto Sans JP']);
  });

  it('matches the search substring case-insensitively', () => {
    const result = filterFonts(fixtures, { search: 'roBOto', category: null, favorites: noFav });
    expect(result.map((f) => f.family)).toEqual(['Roboto', 'Roboto Slab']);
  });

  it('sorts favorites first while preserving the rest', () => {
    const result = filterFonts(fixtures, {
      search: '',
      category: null,
      favorites: new Set(['Lobster']),
    });
    expect(result[0].family).toBe('Lobster');
    expect(result.map((f) => f.family)).toEqual([
      'Lobster',
      'Roboto',
      'Roboto Slab',
      'Noto Sans JP',
      'Fira Code',
    ]);
  });

  it('applies category + search + favorites together', () => {
    const result = filterFonts(fixtures, {
      search: 'roboto',
      category: null,
      favorites: new Set(['Roboto Slab']),
    });
    expect(result.map((f) => f.family)).toEqual(['Roboto Slab', 'Roboto']);
  });
});

/* ── dialog behaviour ── */

// Each test below mounts up to PAGE_SIZE*2 real FontCard components — every
// one wiring up a live IntersectionObserver effect and a Tooltip (its own
// refs/callbacks/effects) — genuinely CPU-bound synchronous render work, not
// an async wait. Measured well under Vitest's 5s default in isolation
// (~150-500ms), but issue #160 caught it stretching past 5s when it shares
// CPU with the rest of the full suite (e.g. packages/patterns/src/
// patterns.test.ts's determinism scan, which alone can run 25s+). Same
// rationale and fix shape as that file's EXTREME_DRAW_TIMEOUT_MS /
// DETERMINISM_TIMEOUT_MS: raise the per-test timeout rather than trim what
// the test renders or asserts.
const DIALOG_RENDER_TIMEOUT_MS = 20_000;

describe('font-explorer dialog', () => {
  it(
    'renders only the first page of cards',
    () => {
      renderDialog();
      expect(cardButtons()).toHaveLength(PAGE_SIZE);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'focuses the search input on mount, not the Close button that precedes it in DOM order',
    () => {
      renderDialog();
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Search Google Fonts…'));
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'loads another page when the sentinel scrolls into view',
    () => {
      renderDialog();
      expect(cardButtons()).toHaveLength(PAGE_SIZE);
      fireIntersection(screen.getByTestId('font-explorer-sentinel'));
      expect(cardButtons()).toHaveLength(PAGE_SIZE * 2);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'shows an empty state when nothing matches the search',
    () => {
      renderDialog();
      fireEvent.change(screen.getByPlaceholderText('Search Google Fonts…'), {
        target: { value: 'zzz-no-such-font' },
      });
      expect(screen.getByText('No fonts match your search.')).toBeTruthy();
      expect(screen.queryAllByRole('button', { name: /^Use / })).toHaveLength(0);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'auto-switches the preview text to Japanese when the Japanese category is chosen',
    () => {
      renderDialog();
      const preview = screen.getByPlaceholderText('Type preview text…') as HTMLInputElement;
      expect(preview.value).toBe('The quick brown fox');
      fireEvent.click(screen.getByRole('button', { name: 'Japanese' }));
      expect(preview.value).toBe('こんにちは日本語');
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'keeps a user-typed preview text even after switching to Japanese',
    () => {
      renderDialog();
      const preview = screen.getByPlaceholderText('Type preview text…') as HTMLInputElement;
      fireEvent.change(preview, { target: { value: 'custom' } });
      fireEvent.click(screen.getByRole('button', { name: 'Japanese' }));
      expect(preview.value).toBe('custom');
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'applies the picked family with one geometry-owned readiness callback',
    () => {
      const { ctx, close } = renderDialog();
      const first = cardButtons()[0];
      const family = first
        .getAttribute('aria-label')!
        .replace(/^Use /, '')
        .replace(/ \(current\)$/, '');

      fireEvent.click(first);

      expect(ctx.commit).toHaveBeenCalledTimes(1);
      const nextDoc = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
      expect(nextDoc.layers[0]).toMatchObject({ id: 't1', fontFamily: family });
      expect(ensureFontMock).toHaveBeenCalledWith(family, 'Hello');
      expect(ctx.requestRepaint).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'is a no-op (no commit) when the already-applied family is clicked, but still closes',
    () => {
      const doc: DocState = {
        panelHp: 12,
        guides: [],
        layers: [{ ...textLayer, fontFamily: 'ABeeZee' }],
      };
      const ctx = stubCtx({ doc });
      const close = vi.fn();
      const Dialog = getDialogComponent();
      render(<Dialog props={{ layerId: 't1' }} close={close} ctx={ctx} />);

      fireEvent.click(screen.getByRole('button', { name: 'Use ABeeZee (current)' }));

      expect(ctx.commit).not.toHaveBeenCalled();
      expect(ensureFontMock).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    "marks the layer's current family as the active card",
    () => {
      // ABeeZee is the first catalog entry; make it the layer's font so its card
      // is on the first page and flagged active.
      const doc: DocState = {
        panelHp: 12,
        guides: [],
        layers: [{ ...textLayer, fontFamily: 'ABeeZee' }],
      };
      const Dialog = getDialogComponent();
      render(<Dialog props={{ layerId: 't1' }} close={vi.fn()} ctx={stubCtx({ doc })} />);
      expect(screen.getByRole('button', { name: 'Use ABeeZee (current)' })).toBeTruthy();
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'stars a font from a card and persists it to localStorage',
    () => {
      renderDialog();
      const first = cardButtons()[0];
      const family = first
        .getAttribute('aria-label')!
        .replace(/^Use /, '')
        .replace(/ \(current\)$/, '');
      const star = screen.getByRole('button', { name: `Add ${family} to favorites` });

      fireEvent.click(star);

      expect(JSON.parse(localStorage.getItem(FONT_FAVORITES_STORAGE_KEY)!)).toContain(family);
      // Toggled control now offers the inverse action.
      expect(screen.getByRole('button', { name: `Remove ${family} from favorites` })).toBeTruthy();
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );

  it(
    'orders a starred font first on the next open',
    () => {
      // Star a font that is NOT normally on the first page, then confirm it is.
      toggleFontFavorite('Roboto');
      renderDialog();
      expect(cardButtons()[0].getAttribute('aria-label')).toMatch(/^Use Roboto/);
    },
    DIALOG_RENDER_TIMEOUT_MS,
  );
});
