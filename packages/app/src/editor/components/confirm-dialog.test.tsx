// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { closeDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import { DialogHost } from './dialog-host';
import { confirmDialog } from './confirm-dialog';

afterEach(() => {
  cleanup();
  closeDialog();
});

function stubCtx(): ToolContext {
  return {} as ToolContext;
}

describe('confirmDialog', () => {
  it('resolves true when Confirm is clicked', async () => {
    render(<DialogHost ctx={stubCtx()} />);
    let result!: Promise<boolean>;
    act(() => {
      result = confirmDialog({ title: 'Delete layer?', message: 'This cannot be undone.' });
    });
    expect(screen.getByText('Delete layer?')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByText('Confirm'));
    });
    expect(await result).toBe(true);
  });

  it('resolves false when Cancel is clicked', async () => {
    render(<DialogHost ctx={stubCtx()} />);
    let result!: Promise<boolean>;
    act(() => {
      result = confirmDialog({ title: 'Discard changes?' });
    });

    act(() => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(await result).toBe(false);
  });

  it('resolves false when dismissed via Escape (host-owned)', async () => {
    render(<DialogHost ctx={stubCtx()} />);
    let result!: Promise<boolean>;
    act(() => {
      result = confirmDialog({ title: 'Discard changes?' });
    });

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(await result).toBe(false);
  });

  it('auto-focuses Cancel', () => {
    render(<DialogHost ctx={stubCtx()} />);
    act(() => {
      confirmDialog({ title: 'x' });
    });
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('applies the danger styling to the confirm button when danger is set', () => {
    render(<DialogHost ctx={stubCtx()} />);
    act(() => {
      confirmDialog({ title: 'Delete pattern?', danger: true, confirmLabel: 'Delete' });
    });
    const confirmButton = screen.getByText('Delete');
    expect(confirmButton.className).toContain('bg-red-600');
  });
});
