// @vitest-environment jsdom
//
// The pattern "Browse…" and image "Convert to vector…" buttons are no-op
// affordance hooks for Wave 5's pattern-picker (#12) and trace (#11) dialogs:
// disabled until a dialog with the matching id is registered, then they open
// it via ctx.openDialog. Proves both halves of that contract.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImageLayer, PatternLayer, Pt } from '@zpd/core';
import { getDialog, registerDialog, unregisterDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import './pattern';
import './image';
import { getInspector } from '../registry/inspectors';

function NullDialog() {
  return null;
}

afterEach(cleanup);

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, layers: [] },
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

describe('pattern inspector — Browse… hook', () => {
  const layer: PatternLayer = {
    id: 'pat-1',
    name: 'Pattern',
    type: 'pattern',
    patternType: 'dot-grid',
    color: 1,
    params: {},
    x: 0,
    y: 0,
    size: 128.5,
  };

  it('is disabled when no pattern-picker dialog is registered', () => {
    // Same nested-execution hazard: force the "nothing registered" premise
    // rather than assuming it, since a real pattern-picker dialog (#12) may
    // already be registered by the time this runs nested inside another
    // file's suite. Restore afterward.
    const original = getDialog('pattern-picker');
    if (original) unregisterDialog('pattern-picker');
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('pattern')!;
      render(<Inspector layer={layer} materialRole="copper" onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Browse…/ });
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(ctx.openDialog).not.toHaveBeenCalled();
    } finally {
      if (original) registerDialog(original);
    }
  });

  it('opens the pattern-picker dialog once one is registered', () => {
    // This file lives under inspectors/, which registry/index.ts eagerly
    // globs — so it can also run nested inside another file's <App/> smoke
    // test, by which point the real pattern-picker dialog (#12) is already
    // registered. Restore whatever was there rather than unconditionally
    // deleting it, or we'd wipe out that real registration.
    const original = getDialog('pattern-picker');
    registerDialog({ id: 'pattern-picker', component: NullDialog });
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('pattern')!;
      render(<Inspector layer={layer} materialRole="copper" onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Browse…/ });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(ctx.openDialog).toHaveBeenCalledWith('pattern-picker', { layerId: 'pat-1' });
    } finally {
      if (original) registerDialog(original);
      else unregisterDialog('pattern-picker');
    }
  });
});

describe('image inspector — Convert to vector… hook', () => {
  const layer: ImageLayer = {
    id: 'img-1',
    name: 'Reference',
    type: 'image',
    src: 'data:image/png;base64,AAAA',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };

  it('is disabled when no trace dialog is registered', () => {
    // Same defensive premise as the pattern inspector test above.
    const original = getDialog('trace');
    if (original) unregisterDialog('trace');
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('image')!;
      render(<Inspector layer={layer} materialRole={null} onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Convert to vector…/ });
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(ctx.openDialog).not.toHaveBeenCalled();
    } finally {
      if (original) registerDialog(original);
    }
  });

  it('opens the trace dialog once one is registered', () => {
    // Same nested-execution hazard as the pattern-picker case above — restore
    // rather than delete so a real trace dialog (#11) survives this test.
    const original = getDialog('trace');
    registerDialog({ id: 'trace', component: NullDialog });
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('image')!;
      render(<Inspector layer={layer} materialRole={null} onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Convert to vector…/ });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(ctx.openDialog).toHaveBeenCalledWith('trace', { layerId: 'img-1' });
    } finally {
      if (original) registerDialog(original);
      else unregisterDialog('trace');
    }
  });
});
