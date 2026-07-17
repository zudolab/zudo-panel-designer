import { afterEach, describe, expect, it } from 'vitest';
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  toastError,
  toastSuccess,
  toastWarning,
} from './toasts';

// The store is module-level singleton state — drain it after every test so
// runs don't leak into each other.
afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

describe('toast store', () => {
  it('success/error/warning enqueue an entry with the right variant', () => {
    toastSuccess('ok');
    toastError('broke');
    toastWarning('careful');
    const variants = getToasts().map((t) => t.variant);
    expect(variants).toEqual(['success', 'error', 'warning']);
  });

  it('returns a stable id that dismiss() can target', () => {
    const id = toastSuccess('hello');
    expect(getToasts().some((t) => t.id === id)).toBe(true);
    dismissToast(id);
    expect(getToasts().some((t) => t.id === id)).toBe(false);
  });

  it('carries description and duration through options', () => {
    toastError('failed', { description: 'more detail', duration: 1234 });
    const [entry] = getToasts();
    expect(entry.description).toBe('more detail');
    expect(entry.duration).toBe(1234);
  });

  it('notifies subscribers on add and dismiss', () => {
    let calls = 0;
    const unsubscribe = subscribeToasts(() => {
      calls++;
    });
    const id = toastSuccess('hi');
    expect(calls).toBe(1);
    dismissToast(id);
    expect(calls).toBe(2);
    unsubscribe();
  });

  it('dismiss() on an unknown id is a no-op (no notification)', () => {
    let calls = 0;
    const unsubscribe = subscribeToasts(() => {
      calls++;
    });
    dismissToast('does-not-exist');
    expect(calls).toBe(0);
    unsubscribe();
  });

  describe('overflow policy (cap = 5)', () => {
    it('drops the OLDEST non-error toast when a 6th toast arrives', () => {
      for (let i = 1; i <= 6; i++) toastSuccess(`Toast ${i}`);
      const messages = getToasts().map((t) => t.message);
      expect(messages).toEqual(['Toast 2', 'Toast 3', 'Toast 4', 'Toast 5', 'Toast 6']);
    });

    it('never drops an error to make room for a new non-error toast', () => {
      toastError('Error A');
      for (let i = 1; i <= 4; i++) toastSuccess(`Success ${i}`);
      // Queue is now full (1 error + 4 success = 5). One more arrives.
      toastSuccess('Success 5');
      const messages = getToasts().map((t) => t.message);
      expect(messages).toEqual(['Error A', 'Success 2', 'Success 3', 'Success 4', 'Success 5']);
    });

    it('drops the oldest error only once every queued toast is an error', () => {
      for (let i = 1; i <= 6; i++) toastError(`Error ${i}`);
      const messages = getToasts().map((t) => t.message);
      expect(messages).toEqual(['Error 2', 'Error 3', 'Error 4', 'Error 5', 'Error 6']);
    });
  });
});
