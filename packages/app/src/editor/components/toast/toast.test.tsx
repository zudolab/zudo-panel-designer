// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from './toast';

function renderToast(overrides: Partial<Parameters<typeof Toast>[0]> = {}) {
  const onDismiss = vi.fn();
  render(
    <Toast id="test-id" variant="success" message="Test message" onDismiss={onDismiss} {...overrides} />,
  );
  return { onDismiss };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('a11y roles', () => {
  it('success variant has role="status" and aria-live="polite"', () => {
    renderToast({ variant: 'success' });
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-atomic')).toBe('true');
  });

  it('warning variant has role="status" and aria-live="polite"', () => {
    renderToast({ variant: 'warning' });
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('error variant has role="alert" and aria-live="assertive"', () => {
    renderToast({ variant: 'error' });
    const el = screen.getByRole('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(el.getAttribute('aria-atomic')).toBe('true');
  });
});

describe('per-category auto-dismiss timing', () => {
  it('success dismisses after 3000ms by default', () => {
    const { onDismiss } = renderToast({ variant: 'success' });
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith('test-id');
  });

  it('warning dismisses after 6000ms by default', () => {
    const { onDismiss } = renderToast({ variant: 'warning' });
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('error does NOT auto-dismiss by default', () => {
    const { onDismiss } = renderToast({ variant: 'error' });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a finite duration overrides the variant default', () => {
    const { onDismiss } = renderToast({ variant: 'error', duration: 1500 });
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('Infinity disables auto-dismiss even for success', () => {
    const { onDismiss } = renderToast({ variant: 'success', duration: Infinity });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('pause-on-hover', () => {
  it('pauses the timer on mouseenter and resumes the remaining time on mouseleave', () => {
    const { onDismiss } = renderToast({ variant: 'success', duration: 2000 });
    const el = screen.getByRole('status');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      fireEvent.mouseEnter(el);
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      fireEvent.mouseLeave(el);
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('dismissal', () => {
  it('clicking the toast body dismisses immediately', () => {
    const { onDismiss } = renderToast({ variant: 'success' });
    act(() => {
      fireEvent.click(screen.getByRole('status'));
    });
    expect(onDismiss).toHaveBeenCalledWith('test-id');
  });

  it('renders a labelled close button that dismisses on click', () => {
    const { onDismiss } = renderToast({ variant: 'error' });
    const btn = screen.getByRole('button', { name: /dismiss/i });
    act(() => {
      fireEvent.click(btn);
    });
    expect(onDismiss).toHaveBeenCalledWith('test-id');
  });

  it('Escape dismisses the toast when it has focus', () => {
    const { onDismiss } = renderToast({ variant: 'error' });
    act(() => {
      fireEvent.keyDown(screen.getByRole('alert'), { key: 'Escape' });
    });
    expect(onDismiss).toHaveBeenCalledWith('test-id');
  });

  it('Escape stops propagation so it never reaches a document-level dialog handler', () => {
    const { onDismiss } = renderToast({ variant: 'error' });
    const el = screen.getByRole('alert');
    const documentHandler = vi.fn();
    document.addEventListener('keydown', documentHandler);
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape' });
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(documentHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentHandler);
  });

  it('the toast root is keyboard-focusable (tabIndex=0)', () => {
    renderToast({ variant: 'error' });
    expect(screen.getByRole('alert').getAttribute('tabindex')).toBe('0');
  });

  it('Space does not dismiss and does not bubble past the toast (would otherwise arm the app-wide pan-tool shortcut)', () => {
    const { onDismiss } = renderToast({ variant: 'error' });
    const documentHandler = vi.fn();
    document.addEventListener('keydown', documentHandler);
    act(() => {
      fireEvent.keyDown(screen.getByRole('alert'), { key: ' ', code: 'Space' });
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(documentHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentHandler);
  });

  it('Space on the close button does not bubble past the toast either', () => {
    renderToast({ variant: 'error' });
    const documentHandler = vi.fn();
    document.addEventListener('keydown', documentHandler);
    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: /dismiss/i }), {
        key: ' ',
        code: 'Space',
      });
    });
    expect(documentHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentHandler);
  });
});

describe('content', () => {
  it('renders an optional description', () => {
    renderToast({ description: 'more detail' });
    expect(screen.getByText('more detail')).toBeTruthy();
  });
});
