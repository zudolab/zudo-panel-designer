// @vitest-environment jsdom
//
// Dedicated to pattern-picker's search box and paged/sentinel lazy rendering
// (#87). @zpd/patterns is mocked with a synthetic 50-generator catalog — the
// real registry (12 patterns as of this issue, growing toward 62 across the
// epic) is smaller than PAGE_SIZE, so it can't exercise "beyond the first
// page" on its own; mocking keeps that assertion independent of however many
// patterns are actually registered. renderPatternThumb is mocked to a no-op
// (pixel-accurate canvas sizing is already covered by pattern-picker.test.tsx
// against the real package); defaultParams is mocked since the fake
// generators aren't in the real registry it looks up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPcbLayerStack } from '@zpd/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocState, Pt } from '@zpd/core';
import type { PanelPatternGenerator } from '@zpd/patterns';
import type { ToolContext } from '../types';

// vi.mock factories (and vi.hoisted callbacks) are hoisted above every
// top-level statement in the file, including plain `const` declarations, so
// the fake catalog must be built entirely inside the hoisted block to be
// referenceable inside the factory — same reasoning as font-explorer.test.tsx's
// ensureFontMock.
const { fakeGenerators } = vi.hoisted(() => ({
  fakeGenerators: Array.from({ length: 50 }, (_, i) => ({
    name: i === 0 ? 'zebra-stripes' : `fake-pattern-${i}`,
    displayName: i === 0 ? 'Zebra Stripes' : `Fake Pattern ${i}`,
    paramDefs: [],
    draw: () => undefined,
  })),
}));

vi.mock('@zpd/patterns', () => ({
  PATTERN_GENERATORS: fakeGenerators,
  defaultParams: vi.fn(() => ({})),
  renderPatternThumb: vi.fn(),
}));

// Import after the mock is declared so the dialog binds to it.
import './pattern-picker';
import { getDialog } from '../registry/dialogs';
import { filterPatterns, PAGE_SIZE } from './pattern-picker';

/* ── controllable IntersectionObserver (mirrors font-explorer.test.tsx) ── */

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

beforeEach(() => {
  ioInstances = [];
  vi.stubGlobal('IntersectionObserver', IOStub as unknown as typeof IntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ── ctx + dialog harness ── */

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
}

function getPatternPickerDialog() {
  return getDialog('pattern-picker')!.component;
}

function renderDialog(overrides: Partial<ToolContext> = {}, close = vi.fn()) {
  const doc: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
  const ctx = stubCtx({ doc, ...overrides });
  const Dialog = getPatternPickerDialog();
  const view = render(<Dialog props={{}} close={close} ctx={ctx} />);
  return { ctx, close, ...view };
}

function cardCount(container: HTMLElement) {
  return container.querySelectorAll('canvas').length;
}

/* ── filterPatterns (pure) ── */

describe('filterPatterns', () => {
  const fixtures: PanelPatternGenerator[] = [
    { name: 'dot-grid', displayName: 'Dot Grid', paramDefs: [], draw: vi.fn() },
    { name: 'diag-stripes', displayName: 'Diagonal Stripes', paramDefs: [], draw: vi.fn() },
    { name: 'hex-lattice', displayName: 'Hex Lattice', paramDefs: [], draw: vi.fn() },
  ];

  it('returns every entry when the search is empty', () => {
    expect(filterPatterns(fixtures, { search: '' })).toEqual(fixtures);
  });

  it('matches displayName case-insensitively', () => {
    const result = filterPatterns(fixtures, { search: 'STRIPES' });
    expect(result.map((g) => g.name)).toEqual(['diag-stripes']);
  });

  it('matches the stable name (kebab id) too', () => {
    const result = filterPatterns(fixtures, { search: 'hex' });
    expect(result.map((g) => g.name)).toEqual(['hex-lattice']);
  });

  it('returns no entries when nothing matches', () => {
    expect(filterPatterns(fixtures, { search: 'zzz-no-such-pattern' })).toEqual([]);
  });
});

/* ── dialog behaviour ── */

describe('pattern-picker dialog — search + paging', () => {
  it('renders only the first page of cards', () => {
    const { container } = renderDialog();
    expect(cardCount(container)).toBe(PAGE_SIZE);
  });

  it('focuses the search input on mount', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search patterns…'));
  });

  it('typing in search narrows the rendered grid', () => {
    const { container } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search patterns…'), {
      target: { value: 'Zebra' },
    });
    expect(cardCount(container)).toBe(1);
    expect(screen.getByTitle('Zebra Stripes')).toBeTruthy();
  });

  it('shows an empty state when nothing matches the search', () => {
    const { container } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search patterns…'), {
      target: { value: 'zzz-no-such-pattern' },
    });
    expect(screen.getByText('No patterns match your search.')).toBeTruthy();
    expect(cardCount(container)).toBe(0);
  });

  it('does not render cards beyond the first page until the sentinel intersects', () => {
    const { container } = renderDialog();
    expect(cardCount(container)).toBe(PAGE_SIZE);
    fireIntersection(screen.getByTestId('pattern-picker-sentinel'));
    expect(cardCount(container)).toBe(PAGE_SIZE * 2);
  });

  it('resets paging to the first page when the search filter changes', () => {
    const { container } = renderDialog();
    fireIntersection(screen.getByTestId('pattern-picker-sentinel'));
    expect(cardCount(container)).toBe(PAGE_SIZE * 2);

    fireEvent.change(screen.getByPlaceholderText('Search patterns…'), {
      target: { value: 'Fake' },
    });
    // 49 of the 50 fake generators match "Fake" (all but Zebra Stripes),
    // still more than one page, so the first-page cap re-applies.
    expect(cardCount(container)).toBe(PAGE_SIZE);
  });

  it('scrolls the results back to the top when the search filter changes', () => {
    renderDialog();
    const scrollRoot = screen.getByTestId('pattern-picker-scroll-root') as HTMLDivElement;
    // jsdom elements have no real scrollTo; stub it so the effect's call is
    // observable (same technique the paging effect above uses to detect it).
    const scrollToSpy = vi.fn();
    scrollRoot.scrollTo = scrollToSpy;

    fireEvent.change(screen.getByPlaceholderText('Search patterns…'), {
      target: { value: 'Zebra' },
    });

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it('clicking a card commits, closes, and stops observing beyond the visible page', () => {
    const { ctx, close } = renderDialog();
    fireEvent.click(screen.getByTitle('Zebra Stripes'));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    expect(ctx.select).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
