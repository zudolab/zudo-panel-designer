// @vitest-environment jsdom
import { useLayoutEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { closeDialog, openDialog, registerDialog, unregisterDialog } from '../registry/dialogs';
import type { CommandContext } from '../commands';
import type { DialogProps } from '../types';
import { DialogHost } from './dialog-host';

afterEach(() => {
  cleanup();
  closeDialog();
});

// DialogHost's ctx prop is CommandContext (the full context Editor wires in);
// these host-behavior tests never read it, so an empty cast suffices.
function stubCtx(): CommandContext {
  return {} as CommandContext;
}

function useSelfFocus() {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function SelfFocusingDialogA({ close }: DialogProps) {
  const focusRef = useSelfFocus();
  return (
    <div>
      <button ref={focusRef}>dialog-a-focus</button>
      <button onClick={close}>close-a</button>
    </div>
  );
}

function SelfFocusingDialogB({ close }: DialogProps) {
  const focusRef = useSelfFocus();
  return (
    <div>
      <button ref={focusRef}>dialog-b-focus</button>
      <button onClick={close}>close-b</button>
    </div>
  );
}

describe('DialogHost', () => {
  it('renders nothing when no dialog is open', () => {
    const { container } = render(<DialogHost ctx={stubCtx()} />);
    expect(container.innerHTML).toBe('');
  });

  it('focuses the first focusable descendant when a dialog opens', () => {
    registerDialog({
      id: 'demo-focus',
      component: ({ close }) => (
        <div>
          <button>alpha</button>
          <button onClick={close}>beta</button>
        </div>
      ),
    });
    try {
      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-focus'));
      expect(document.activeElement?.textContent).toBe('alpha');
    } finally {
      unregisterDialog('demo-focus');
    }
  });

  it('Escape closes the dialog via the host', () => {
    registerDialog({ id: 'demo-escape', component: () => <button>only</button> });
    try {
      const { queryByText } = render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-escape'));
      expect(queryByText('only')).toBeTruthy();

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(queryByText('only')).toBeNull();
    } finally {
      unregisterDialog('demo-escape');
    }
  });

  it('restores the pre-child opener when a self-focusing dialog is closed by the host', () => {
    registerDialog({
      id: 'demo-restore',
      component: SelfFocusingDialogA,
    });
    const opener = document.createElement('button');
    try {
      opener.textContent = 'opener';
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-restore'));
      expect(document.activeElement?.textContent).toBe('dialog-a-focus');

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      unregisterDialog('demo-restore');
    }
  });

  it('restores the pre-child opener when dialog content closes itself', () => {
    registerDialog({ id: 'demo-content-close', component: SelfFocusingDialogA });
    const opener = document.createElement('button');
    try {
      document.body.appendChild(opener);
      opener.focus();

      const { getByText } = render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-content-close'));
      expect(document.activeElement?.textContent).toBe('dialog-a-focus');

      fireEvent.click(getByText('close-a'));
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      unregisterDialog('demo-content-close');
    }
  });

  it('retains the outside opener without restoring it during dialog replacement', () => {
    registerDialog({ id: 'demo-replace-a', component: SelfFocusingDialogA });
    registerDialog({ id: 'demo-replace-b', component: SelfFocusingDialogB });
    const opener = document.createElement('button');
    try {
      document.body.appendChild(opener);
      opener.focus();
      const focusOpener = vi.spyOn(opener, 'focus');

      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-replace-a'));
      expect(document.activeElement?.textContent).toBe('dialog-a-focus');

      act(() => openDialog('demo-replace-b'));
      expect(focusOpener).not.toHaveBeenCalled();
      expect(document.activeElement?.textContent).toBe('dialog-b-focus');

      act(() => closeDialog());
      expect(focusOpener).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
      unregisterDialog('demo-replace-a');
      unregisterDialog('demo-replace-b');
    }
  });

  it('ignores a disconnected opener when the dialog closes', () => {
    registerDialog({ id: 'demo-disconnected-opener', component: SelfFocusingDialogA });
    const opener = document.createElement('button');
    try {
      document.body.appendChild(opener);
      opener.focus();
      const focusOpener = vi.spyOn(opener, 'focus');

      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-disconnected-opener'));
      opener.remove();

      expect(() => act(() => closeDialog())).not.toThrow();
      expect(focusOpener).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(opener);
    } finally {
      opener.remove();
      unregisterDialog('demo-disconnected-opener');
    }
  });

  it('focuses a durable editor fallback when the captured opener disconnected', () => {
    registerDialog({ id: 'demo-fallback', component: SelfFocusingDialogA });
    const opener = document.createElement('button');
    const fallback = document.createElement('button');
    try {
      fallback.dataset.dialogFocusFallback = 'true';
      document.body.append(opener, fallback);
      opener.focus();

      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-fallback'));
      opener.remove();
      act(() => closeDialog());

      expect(document.activeElement).toBe(fallback);
    } finally {
      opener.remove();
      fallback.remove();
      unregisterDialog('demo-fallback');
    }
  });

  it('stops the Escape keydown from reaching window-level listeners while a dialog is open', () => {
    registerDialog({ id: 'demo-stop', component: () => <button>x</button> });
    const windowHandler = vi.fn();
    window.addEventListener('keydown', windowHandler);
    try {
      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-stop'));
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(windowHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowHandler);
      unregisterDialog('demo-stop');
    }
  });

  it('closes on backdrop click', () => {
    registerDialog({ id: 'demo-backdrop', component: () => <button>content</button> });
    try {
      const { queryByText, getByTestId } = render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-backdrop'));
      expect(queryByText('content')).toBeTruthy();

      // DialogHost renders through OverlayPortal (to document.body in tests,
      // since there's no #overlay-portal-root), so the backdrop lives
      // outside the render() container — query it by baseElement instead.
      fireEvent.click(getByTestId('dialog-backdrop'));
      expect(queryByText('content')).toBeNull();
    } finally {
      unregisterDialog('demo-backdrop');
    }
  });
});
