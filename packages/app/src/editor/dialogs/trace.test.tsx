// @vitest-environment jsdom
//
// jsdom has no real <canvas> 2D context and never fires Image onload/onerror
// for a data: URL by default, so this proves the dialog mounts/wires up
// through the registry without ever reaching the canvas/tracer boundary —
// the actual tracing math is covered DOM-free in svg-to-path-layers.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImageLayer, Pt } from '@zpd/core';
import './trace';
import { getDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';

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

const IMAGE_LAYER: ImageLayer = {
  id: 'img-1',
  name: 'Reference',
  type: 'image',
  src: 'data:image/png;base64,AAAA',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
};

describe('trace dialog', () => {
  it('registers itself under id "trace"', () => {
    expect(getDialog('trace')).toBeDefined();
  });

  it('mounts against a real image layer without crashing', () => {
    const ctx = stubCtx({ doc: { panelHp: 12, layers: [IMAGE_LAYER] } });
    const Dialog = getDialog('trace')!.component;
    render(<Dialog props={{ layerId: 'img-1' }} close={vi.fn()} ctx={ctx} />);

    expect(screen.getByText('Convert image to vectors')).toBeTruthy();
    // no traced preview yet — the source Image() never decodes in jsdom
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('shows a fallback + Close when the layer id no longer exists, without crashing', () => {
    const ctx = stubCtx({ doc: { panelHp: 12, layers: [] } });
    const Dialog = getDialog('trace')!.component;
    const close = vi.fn();
    render(<Dialog props={{ layerId: 'missing' }} close={close} ctx={ctx} />);

    expect(screen.getByText(/no longer exists/)).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(close).toHaveBeenCalled();
  });
});
