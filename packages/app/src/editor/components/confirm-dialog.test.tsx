// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { closeDialog, openDialog, registerDialog, unregisterDialog } from '../registry/dialogs';
import type { CommandContext } from '../commands';
import { DialogHost } from './dialog-host';
import { confirmDialog } from './confirm-dialog';

afterEach(() => {
  cleanup();
  closeDialog();
});

function stubCtx(): CommandContext {
  return {} as CommandContext;
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

  it('resolves false when the dialog is swapped for a different one before it settles', async () => {
    registerDialog({ id: 'demo-swap', component: () => <div>other dialog</div> });
    try {
      render(<DialogHost ctx={stubCtx()} />);
      let result!: Promise<boolean>;
      act(() => {
        result = confirmDialog({ title: 'Discard changes?' });
      });
      act(() => openDialog('demo-swap'));
      expect(await result).toBe(false);
    } finally {
      unregisterDialog('demo-swap');
    }
  });

  // Regression: an earlier implementation resolved "cancel" from the content
  // component's effect-cleanup, which React's StrictMode fires immediately
  // on mount (setup → cleanup → setup replay) — so confirmDialog() resolved
  // false before the user ever interacted with the dialog. The app itself
  // renders under StrictMode (main.tsx), so this must hold there too.
  it('does not resolve on mount under StrictMode', async () => {
    render(
      <StrictMode>
        <DialogHost ctx={stubCtx()} />
      </StrictMode>,
    );
    let result!: Promise<boolean>;
    let settledTo: 'pending' | boolean = 'pending';
    act(() => {
      result = confirmDialog({ title: 'Proceed?' });
    });
    result.then((v) => {
      settledTo = v;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settledTo).toBe('pending');

    act(() => {
      fireEvent.click(screen.getByText('Confirm'));
    });
    expect(await result).toBe(true);
  });
});
