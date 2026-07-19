// @vitest-environment jsdom
import '../registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocState, Pt } from '@zpd/core';
import type { CommandContext } from '../commands';
import { Header } from '../components/header';
import { DialogHost } from '../components/dialog-host';
import { closeDialog, getDialog, openDialog } from '../registry/dialogs';

afterEach(() => {
  cleanup();
  closeDialog();
});

function stubCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const doc: DocState = { panelHp: 12, guides: [], layers: [] };
  return {
    doc,
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60.6, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (point: Pt) => point,
    toScreen: (point: Pt) => point,
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
    openDialog,
    closeDialog,
    clipboard: {
      handleCopy: vi.fn(),
      handleCut: vi.fn(),
      handleDuplicate: vi.fn(),
      handleSelectAll: vi.fn(),
    },
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomFit: vi.fn(),
    ...overrides,
  } as unknown as CommandContext;
}

function AppChrome({ ctx }: { readonly ctx: CommandContext }) {
  return (
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
    </>
  );
}

describe('preview-3d dialog integration', () => {
  it('auto-registers with an accessible title and opens through the dialog host', () => {
    expect(getDialog('preview-3d')?.labelledBy).toBe('preview-3d-title');
    const ctx = stubCtx();
    render(<DialogHost ctx={ctx} />);

    act(() =>
      openDialog('preview-3d', {
        loadViewer: () => new Promise(() => {}),
      }),
    );

    expect(screen.getByRole('dialog', { name: '3D PCB preview' })).toBeTruthy();
    expect(screen.getByText('Loading 3D preview…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close 3D preview' }));
    expect(ctx.commit).not.toHaveBeenCalled();
    expect(ctx.replace).not.toHaveBeenCalled();
    expect(ctx.reset).not.toHaveBeenCalled();
    expect(ctx.setCamera).not.toHaveBeenCalled();
  });

  it('restores focus to the header launch action after Close', () => {
    const ctx = stubCtx();
    render(<AppChrome ctx={ctx} />);
    const opener = screen.getByRole('button', { name: 'Preview 3D' });
    opener.focus();

    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: '3D PCB preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close 3D preview' }));

    expect(document.activeElement).toBe(opener);
  });

  it('palette launch replaces the palette and falls back to a durable editor control', () => {
    const ctx = stubCtx();
    render(<AppChrome ctx={ctx} />);
    const durableFallback = screen.getByRole('button', { name: 'Preview 3D' });
    const transientOpener = document.createElement('button');
    document.body.appendChild(transientOpener);
    transientOpener.focus();

    act(() => openDialog('command-palette'));
    transientOpener.remove();
    const search = screen.getByRole('combobox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'Preview 3D' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Preview 3D'));

    expect(screen.getByRole('dialog', { name: '3D PCB preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close 3D preview' }));
    expect(document.activeElement).toBe(durableFallback);
  });
});
