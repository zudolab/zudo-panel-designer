// @vitest-environment jsdom
//
// The pattern "Browse…" and image "Convert to vector…" buttons are no-op
// affordance hooks for Wave 5's pattern-picker (#12) and trace (#11) dialogs:
// disabled until a dialog with the matching id is registered, then they open
// it via ctx.openDialog. Proves both halves of that contract.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImageLayer, PatternLayer, Pt } from '@zpd/core';
import { registerDialog, unregisterDialog } from '../registry/dialogs';
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
  };

  it('is disabled when no pattern-picker dialog is registered', () => {
    const ctx = stubCtx();
    const Inspector = getInspector('pattern')!;
    render(<Inspector layer={layer} onChange={vi.fn()} ctx={ctx} />);

    const button = screen.getByRole<HTMLButtonElement>('button', { name: /Browse…/ });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(ctx.openDialog).not.toHaveBeenCalled();
  });

  it('opens the pattern-picker dialog once one is registered', () => {
    registerDialog({ id: 'pattern-picker', component: NullDialog });
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('pattern')!;
      render(<Inspector layer={layer} onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Browse…/ });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(ctx.openDialog).toHaveBeenCalledWith('pattern-picker', { layerId: 'pat-1' });
    } finally {
      unregisterDialog('pattern-picker');
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
    const ctx = stubCtx();
    const Inspector = getInspector('image')!;
    render(<Inspector layer={layer} onChange={vi.fn()} ctx={ctx} />);

    const button = screen.getByRole<HTMLButtonElement>('button', { name: /Convert to vector…/ });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(ctx.openDialog).not.toHaveBeenCalled();
  });

  it('opens the trace dialog once one is registered', () => {
    registerDialog({ id: 'trace', component: NullDialog });
    try {
      const ctx = stubCtx();
      const Inspector = getInspector('image')!;
      render(<Inspector layer={layer} onChange={vi.fn()} ctx={ctx} />);

      const button = screen.getByRole<HTMLButtonElement>('button', { name: /Convert to vector…/ });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(ctx.openDialog).toHaveBeenCalledWith('trace', { layerId: 'img-1' });
    } finally {
      unregisterDialog('trace');
    }
  });
});
