// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocState, Pt } from '@zpd/core';
import { closeDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import { DialogHost } from './dialog-host';
import { Header } from './header';

afterEach(() => {
  cleanup();
  closeDialog();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const doc: DocState = { panelHp: 12, guides: [], layers: [] };
  return {
    doc,
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
    ...overrides,
  } as unknown as ToolContext;
}

function renderHeader(ctx: ToolContext) {
  return render(
    <>
      <Header
        ctx={ctx}
        zoomPercent={100}
        canUndo={false}
        canRedo={false}
        saveStatus={{ kind: 'unsaved' }}
        onFit={vi.fn()}
        onZoomStep={vi.fn()}
      />
      <DialogHost ctx={ctx} />
    </>,
  );
}

describe('Header', () => {
  it('renders the save-status chip', () => {
    renderHeader(stubCtx());
    expect(screen.getByText('Unsaved changes…')).toBeTruthy();
  });

  it('the "?" button opens the shortcut-panel dialog (issue #77)', () => {
    const ctx = stubCtx();
    renderHeader(ctx);
    fireEvent.click(screen.getByTitle('Keyboard shortcuts'));
    expect(ctx.openDialog).toHaveBeenCalledWith('shortcut-panel');
  });

  it('opens a danger confirm dialog when "New panel" is clicked', () => {
    renderHeader(stubCtx());
    act(() => {
      fireEvent.click(screen.getByText('New panel'));
    });
    expect(screen.getByText('Start a new panel?')).toBeTruthy();
    const confirmButton = screen.getByText('New panel', { selector: 'button:not([title])' });
    expect(confirmButton.className).toContain('bg-red-600');
  });

  it('replaces the doc (reset/selection/image-cache) only after confirming', async () => {
    const ctx = stubCtx();
    renderHeader(ctx);

    act(() => {
      fireEvent.click(screen.getAllByText('New panel')[0]);
    });
    act(() => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(ctx.reset).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getAllByText('New panel')[0]);
    });
    const confirmButton = screen.getByText('New panel', { selector: 'button:not([title])' });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(ctx.reset).toHaveBeenCalledTimes(1);
    const [nextDoc] = (ctx.reset as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(nextDoc.panelHp).toBe(12); // DEFAULT_PANEL_HP
    expect(ctx.selectIds).toHaveBeenCalledWith([]);
    expect(ctx.evictImageCache).toHaveBeenCalledWith(nextDoc.layers);
  });
});
