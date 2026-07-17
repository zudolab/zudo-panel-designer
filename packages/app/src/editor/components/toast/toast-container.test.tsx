// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastContainer } from './toast-container';
import { dismissToast, getToasts, toastError, toastSuccess } from '../../registry/toasts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  for (const t of getToasts()) dismissToast(t.id);
});

describe('ToastContainer', () => {
  it('renders nothing when the store is empty', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('portals active toasts into document.body', () => {
    render(<ToastContainer />);
    act(() => {
      toastSuccess('Portalled', { duration: 999999 });
    });
    expect(screen.getByText('Portalled')).toBeTruthy();
    expect(document.body.querySelector('[aria-label="Notifications"]')).toBeTruthy();
  });

  it('reacts to store updates fired from outside React (e.g. a tool handler)', () => {
    render(<ToastContainer />);
    act(() => {
      toastError('From a handler', { duration: 999999 });
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('From a handler')).toBeTruthy();
  });

  it('clicking a toast dismisses it via the shared store', () => {
    render(<ToastContainer />);
    act(() => {
      toastSuccess('Dismiss me', { duration: 999999 });
    });
    const el = screen.getByRole('status');
    act(() => {
      fireEvent.click(el);
    });
    expect(screen.queryByText('Dismiss me')).toBeNull();
    expect(getToasts()).toHaveLength(0);
  });
});
