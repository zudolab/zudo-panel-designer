// @vitest-environment jsdom
//
// jsdom has no real 2D canvas (getContext returns null / logs "not
// implemented"), so every test stubs HTMLCanvasElement.prototype.getContext
// with a no-op recorder — enough for renderPatternThumb (real, unmocked) to
// run its full dpr-sizing logic without throwing. We test wiring, not pixels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocState, PatternLayer, Pt } from '@zpd/core';
import { defaultParams, PATTERN_GENERATORS } from '@zpd/patterns';
import { getDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import './pattern-picker';
import { PAGE_SIZE, THUMBNAIL_SIZE_PX } from './pattern-picker';

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

// Any canvas method call is recorded and no-ops; property assignment (e.g.
// fillStyle) works like a plain object. Covers every generator's draw() call
// mix without hand-listing 2D context methods.
function fakeCtx2d(): CanvasRenderingContext2D {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, p: string) => (p in t ? t[p] : () => undefined),
    set: (t, p: string, v) => {
      t[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    fakeCtx2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('pattern-picker dialog — swap (opened with layerId)', () => {
  it('swaps the layer patternType, resets params to the new defaults, one commit, closes', () => {
    const existing: PatternLayer = {
      id: 'p1',
      name: 'Dot Grid',
      type: 'pattern',
      patternType: 'dot-grid',
      color: 1,
      params: { spacing: 999 }, // deliberately non-default to prove the reset
    };
    const doc: DocState = { panelHp: 12, guides: [], layers: [existing] };
    const ctx = stubCtx({ doc });
    const close = vi.fn();
    const PatternPickerDialog = getPatternPickerDialog();

    render(<PatternPickerDialog props={{ layerId: 'p1' }} close={close} ctx={ctx} />);

    const target = PATTERN_GENERATORS[1]; // diag-stripes
    fireEvent.click(screen.getByTitle(target.displayName));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const nextDoc = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(nextDoc.layers).toEqual([
      { ...existing, patternType: target.name, params: defaultParams(target.name) },
    ]);
    expect(ctx.select).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves other layers untouched', () => {
    const target1: PatternLayer = {
      id: 'p1',
      name: 'Dot Grid',
      type: 'pattern',
      patternType: 'dot-grid',
      color: 1,
      params: {},
    };
    const other: PatternLayer = {
      id: 'p2',
      name: 'Other',
      type: 'pattern',
      patternType: 'checker',
      color: 2,
      params: { size: 5 },
    };
    const doc: DocState = { panelHp: 12, guides: [], layers: [target1, other] };
    const ctx = stubCtx({ doc });
    const PatternPickerDialog = getPatternPickerDialog();

    render(<PatternPickerDialog props={{ layerId: 'p1' }} close={vi.fn()} ctx={ctx} />);
    fireEvent.click(screen.getByTitle(PATTERN_GENERATORS[3].displayName));

    const nextDoc = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(nextDoc.layers[1]).toEqual(other);
  });
});

describe('pattern-picker dialog — add (opened without layerId)', () => {
  it('adds a new pattern layer on top with default params, selects it, one commit, closes', () => {
    const existing: PatternLayer = {
      id: 'p0',
      name: 'Existing',
      type: 'pattern',
      patternType: 'dot-grid',
      color: 1,
      params: {},
    };
    const doc: DocState = { panelHp: 12, guides: [], layers: [existing] };
    const ctx = stubCtx({ doc });
    const close = vi.fn();
    const PatternPickerDialog = getPatternPickerDialog();

    render(<PatternPickerDialog props={{}} close={close} ctx={ctx} />);

    const target = PATTERN_GENERATORS[2]; // grid-lines
    fireEvent.click(screen.getByTitle(target.displayName));

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const nextDoc = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(nextDoc.layers).toHaveLength(2);
    expect(nextDoc.layers[0]).toEqual(existing); // stays on top of existing, not replacing it
    const added = nextDoc.layers[1];
    expect(added).toMatchObject({
      type: 'pattern',
      patternType: target.name,
      name: target.displayName,
      color: 1,
      params: defaultParams(target.name),
    });
    expect(ctx.select).toHaveBeenCalledTimes(1);
    expect(ctx.select).toHaveBeenCalledWith(added.id);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('pattern-picker dialog — thumbnails', () => {
  it('renders one canvas per registered pattern up to the first page, sized for the device pixel ratio', () => {
    const original = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    try {
      const PatternPickerDialog = getPatternPickerDialog();
      const { container } = render(
        <PatternPickerDialog props={{}} close={vi.fn()} ctx={stubCtx()} />,
      );
      const canvases = container.querySelectorAll('canvas');
      // Paged rendering (#87) caps the first render at PAGE_SIZE; the real
      // registry is currently well under that, but this stays correct once
      // the epic grows it past PAGE_SIZE too.
      expect(canvases.length).toBe(Math.min(PATTERN_GENERATORS.length, PAGE_SIZE));
      canvases.forEach((canvas) => {
        expect(canvas.width).toBe(Math.round(THUMBNAIL_SIZE_PX * 2));
        expect(canvas.height).toBe(Math.round(THUMBNAIL_SIZE_PX * 2));
        expect(canvas.style.width).toBe(`${THUMBNAIL_SIZE_PX}px`);
      });
    } finally {
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = original;
    }
  });

  it('defaults to dpr 1 when devicePixelRatio is absent', () => {
    const original = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    try {
      const PatternPickerDialog = getPatternPickerDialog();
      const { container } = render(
        <PatternPickerDialog props={{}} close={vi.fn()} ctx={stubCtx()} />,
      );
      const canvas = container.querySelector('canvas')!;
      expect(canvas.width).toBe(THUMBNAIL_SIZE_PX);
    } finally {
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = original;
    }
  });
});

// Escape-to-close and focus restoration are now host-owned (dialog-host.tsx)
// rather than duplicated per-dialog — see components/dialog-host.test.tsx.
