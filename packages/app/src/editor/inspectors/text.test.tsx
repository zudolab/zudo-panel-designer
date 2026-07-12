// @vitest-environment jsdom
//
// Proves the text inspector's own contract: multi-line content round-trips
// into the layer patch, the font <select> is populated from the curated
// list and commits a font change, and a non-curated fontFamily (e.g. the
// demo doc's 'sans-serif') stays selectable instead of being silently
// replaced.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Pt, TextLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import './text';
import { getInspector } from '../registry/inspectors';
import { CURATED_FONTS } from '../fonts';

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

const baseLayer: TextLayer = {
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

const Inspector = getInspector('text')!;

describe('text inspector', () => {
  it('round-trips multi-line content edits into the layer patch', () => {
    const onChange = vi.fn();
    render(<Inspector layer={baseLayer} onChange={onChange} ctx={stubCtx()} />);

    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Line one\nLine two' } });

    expect(onChange).toHaveBeenCalledWith({ content: 'Line one\nLine two' });
  });

  it('lists the curated fonts and commits a font change as one undo entry', () => {
    const onChange = vi.fn();
    render(<Inspector layer={baseLayer} onChange={onChange} ctx={stubCtx()} />);

    const select = screen.getByDisplayValue('Oswald') as HTMLSelectElement;
    const optionFamilies = Array.from(select.options).map((o) => o.value);
    for (const font of CURATED_FONTS) expect(optionFamilies).toContain(font.family);

    fireEvent.change(select, { target: { value: 'Orbitron' } });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'Orbitron' }, { commit: true });
  });

  it('keeps a non-curated fontFamily selectable instead of silently swapping it', () => {
    const layer: TextLayer = { ...baseLayer, fontFamily: 'sans-serif' };
    render(<Inspector layer={layer} onChange={vi.fn()} ctx={stubCtx()} />);

    const select = screen.getByDisplayValue('sans-serif') as HTMLSelectElement;
    expect(select.value).toBe('sans-serif');
  });

  it('round-trips color/size/position edits', () => {
    const onChange = vi.fn();
    render(<Inspector layer={baseLayer} onChange={onChange} ctx={stubCtx()} />);

    fireEvent.click(screen.getByTitle(/white/i));
    expect(onChange).toHaveBeenCalledWith({ color: 2 });
  });
});
