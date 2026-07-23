// @vitest-environment jsdom
//
// Proves the text inspector's own contract: multi-line content round-trips
// into the layer patch, the font <select> is populated from the curated
// list and commits a font change, and a non-curated fontFamily (e.g. the
// demo doc's 'sans-serif') stays selectable instead of being silently
// replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPcbLayerStack, type Pt, type TextLayer } from '@zpd/core';
import type { ToolContext } from '../types';
import './text';
import { getInspector } from '../registry/inspectors';
import { CURATED_FONTS } from '../fonts';
import { FONT_FAVORITES_STORAGE_KEY, toggleFontFavorite } from '../use-font-favorites';

function resetFavorites() {
  localStorage.clear();
  window.dispatchEvent(
    new StorageEvent('storage', { key: FONT_FAVORITES_STORAGE_KEY, newValue: null }),
  );
}

beforeEach(resetFavorites);
afterEach(() => {
  cleanup();
  resetFavorites();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: createPcbLayerStack({ silkscreen: [baseLayer] }) },
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
    render(
      <Inspector layer={baseLayer} materialRole="silkscreen" onChange={onChange} ctx={stubCtx()} />,
    );

    const textarea = screen.getByDisplayValue('Hello');
    fireEvent.change(textarea, { target: { value: 'Line one\nLine two' } });

    expect(onChange).toHaveBeenCalledWith({ content: 'Line one\nLine two' });
  });

  it('lists the curated fonts and commits a font change as one undo entry', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(<Inspector layer={baseLayer} materialRole="silkscreen" onChange={onChange} ctx={ctx} />);

    const select = screen.getByDisplayValue('Oswald') as HTMLSelectElement;
    const optionFamilies = Array.from(select.options).map((o) => o.value);
    for (const font of CURATED_FONTS) expect(optionFamilies).toContain(font.family);

    fireEvent.change(select, { target: { value: 'Orbitron' } });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'Orbitron' }, { commit: true });
    expect(ctx.requestRepaint).not.toHaveBeenCalled();
  });

  it('keeps a non-curated fontFamily selectable instead of silently swapping it', () => {
    const layer: TextLayer = { ...baseLayer, fontFamily: 'sans-serif' };
    render(
      <Inspector layer={layer} materialRole="silkscreen" onChange={vi.fn()} ctx={stubCtx()} />,
    );

    const select = screen.getByDisplayValue('sans-serif') as HTMLSelectElement;
    expect(select.value).toBe('sans-serif');
  });

  it('shows the owning material without an object-level color control', () => {
    const onChange = vi.fn();
    render(
      <Inspector layer={baseLayer} materialRole="silkscreen" onChange={onChange} ctx={stubCtx()} />,
    );

    expect(screen.getByText('Silkscreen')).toBeTruthy();
    expect(screen.queryByText('Color')).toBeNull();
    expect(screen.queryByTitle(/white/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sorts starred favorites to the top of the dropdown and marks them with a star', () => {
    toggleFontFavorite('Bebas Neue');
    render(
      <Inspector layer={baseLayer} materialRole="silkscreen" onChange={vi.fn()} ctx={stubCtx()} />,
    );

    const select = screen.getByDisplayValue('Oswald') as HTMLSelectElement;
    // No non-curated guard option for this layer, so the first option is the
    // top of the favorites-first curated order.
    expect(select.options[0].value).toBe('Bebas Neue');
    expect(select.options[0].text).toBe('★ Bebas Neue');
  });

  it('opens the Font Explorer dialog with the layer id from the Browse button', () => {
    const ctx = stubCtx();
    render(<Inspector layer={baseLayer} materialRole="silkscreen" onChange={vi.fn()} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: /browse google fonts/i }));
    expect(ctx.openDialog).toHaveBeenCalledWith('font-explorer', { layerId: 't1' });
  });
});
