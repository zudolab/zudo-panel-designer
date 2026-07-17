// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createDefaultDoc, type DocState } from '@zpd/core';
import { DOC_STORAGE_KEY } from './doc-store';
import { getToasts, dismissToast } from './registry/toasts';
import { useAutosave, type SaveStatus } from './use-autosave';

function TestHarness({
  initialDoc,
  onStatus,
}: {
  initialDoc: DocState;
  onStatus: (status: SaveStatus) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const status = useAutosave(doc);
  onStatus(status);
  return (
    <button type="button" onClick={() => setDoc((d) => ({ ...d, panelHp: d.panelHp + 1 }))}>
      change
    </button>
  );
}

let statuses: SaveStatus[] = [];
function trackStatus(status: SaveStatus) {
  statuses.push(status);
}

beforeEach(() => {
  window.localStorage.clear();
  statuses = [];
  for (const t of getToasts()) dismissToast(t.id);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  for (const t of getToasts()) dismissToast(t.id);
});

describe('useAutosave', () => {
  it('starts unsaved, then writes after the 500ms debounce', () => {
    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    expect(statuses.at(-1)).toEqual({ kind: 'unsaved' });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(statuses.at(-1)?.kind).toBe('saved');
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).not.toBeNull();
  });

  it('coalesces rapid changes into a single write (debounce resets on each change)', () => {
    const { getByText } = render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      getByText('change').click();
    });
    expect(statuses.at(-1)).toEqual({ kind: 'unsaved' });

    // Original timer would have fired at 500ms total, but the change at
    // 300ms reset it — at 300ms further along (600ms total) it must not have
    // fired yet since the reset pushes the deadline to 300+500=800ms.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(statuses.at(-1)?.kind).toBe('saved');
  });

  it('flushes synchronously on pagehide even if the debounce has not elapsed', () => {
    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).not.toBeNull();
    expect(statuses.at(-1)?.kind).toBe('saved');
  });

  it('flushes on visibilitychange turning hidden (mobile backgrounding may kill the tab without ever firing pagehide)', () => {
    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();

    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).not.toBeNull();
    expect(statuses.at(-1)?.kind).toBe('saved');
    visibilitySpy.mockRestore();
  });

  it('does not double-write when visibilitychange fires and pagehide later fires for the same doc', () => {
    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');

    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    visibilitySpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('ignores visibilitychange when the page is still visible', () => {
    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();
  });

  it('surfaces a quota write failure as the failed status with the quota reason', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(statuses.at(-1)).toEqual({ kind: 'failed', reason: 'quota' });
    setItemSpy.mockRestore();
  });

  it('shows exactly one warning toast per session even across repeated failed writes', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const { getByText } = render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getToasts().filter((t) => t.variant === 'warning')).toHaveLength(1);

    act(() => {
      getByText('change').click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(statuses.at(-1)).toEqual({ kind: 'failed', reason: 'quota' });
    expect(getToasts().filter((t) => t.variant === 'warning')).toHaveLength(1);

    setItemSpy.mockRestore();
  });

  it('recovers to saved after a subsequent successful write', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const { getByText } = render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(statuses.at(-1)).toEqual({ kind: 'failed', reason: 'quota' });

    act(() => {
      getByText('change').click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(statuses.at(-1)?.kind).toBe('saved');

    setItemSpy.mockRestore();
  });

  it('removes the pagehide listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<TestHarness initialDoc={createDefaultDoc()} onStatus={trackStatus} />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });
});
