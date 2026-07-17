// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { closeDialog, openDialog, registerDialog, unregisterDialog } from '../registry/dialogs';
import type { ToolContext } from '../types';
import { DialogHost } from './dialog-host';

afterEach(() => {
  cleanup();
  closeDialog();
});

function stubCtx(): ToolContext {
  return {} as ToolContext;
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

  it('restores focus to the opener element on close', () => {
    registerDialog({
      id: 'demo-restore',
      component: ({ close }) => <button onClick={close}>close-me</button>,
    });
    try {
      const opener = document.createElement('button');
      opener.textContent = 'opener';
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      render(<DialogHost ctx={stubCtx()} />);
      act(() => openDialog('demo-restore'));
      expect(document.activeElement).not.toBe(opener);

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      expect(document.activeElement).toBe(opener);
      opener.remove();
    } finally {
      unregisterDialog('demo-restore');
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
