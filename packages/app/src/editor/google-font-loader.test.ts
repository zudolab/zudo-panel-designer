// @vitest-environment jsdom
//
// jsdom never actually fetches the <link rel="stylesheet"> this module
// appends (no real network, per the task's hard rule), so every test drives
// the link's load/error handlers by hand and stubs document.fonts the same
// way fonts.test.ts does. Each test uses its own unique family name because
// the production memoization is intentionally permanent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureGoogleFontAttempt,
  FONT_LOAD_TIMEOUT_MS,
  getGoogleFontAttemptStatus,
  isGoogleFontLoaded,
  loadGoogleFont,
} from './google-font-loader';

function stubFontFaceSet(loadImpl?: (spec: string, text?: string) => Promise<unknown>) {
  const fonts = { load: vi.fn(loadImpl ?? (() => Promise.resolve([]))) };
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  return fonts;
}

function lastLink(): HTMLLinkElement {
  const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]');
  return links[links.length - 1];
}

afterEach(() => {
  document.head.querySelectorAll('link').forEach((el) => el.remove());
  // @ts-expect-error test-only teardown of the stubbed FontFaceSet
  delete document.fonts;
  vi.useRealTimers();
});

describe('loadGoogleFont', () => {
  it('appends a stylesheet link for the plain family (no weight variants) and resolves once the link + face are ready', async () => {
    const fonts = stubFontFaceSet();
    const promise = loadGoogleFont('Roboto Slab');

    const link = lastLink();
    expect(link.rel).toBe('stylesheet');
    expect(link.href).toBe(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent('Roboto Slab')}&display=swap`,
    );

    link.onload?.(new Event('load'));
    await promise;

    expect(fonts.load).toHaveBeenCalledWith('16px "Roboto Slab"', undefined);
    expect(getGoogleFontAttemptStatus('Roboto Slab')).toBe('ready');
  });

  it('forwards sample text to document.fonts.load so unicode-range subsets load', async () => {
    const fonts = stubFontFaceSet();
    const promise = loadGoogleFont('Noto Sans JP', '日本語');

    lastLink().onload?.(new Event('load'));
    await promise;

    expect(fonts.load).toHaveBeenCalledWith('16px "Noto Sans JP"', '日本語');
  });

  it('resolves even when the stylesheet link fails to load', async () => {
    const fonts = stubFontFaceSet();
    const promise = loadGoogleFont('Broken Font');

    lastLink().onerror?.(new Event('error'));
    await expect(promise).resolves.toBeUndefined();
    expect(fonts.load).toHaveBeenCalledWith('16px "Broken Font"', undefined);
  });

  it('resolves even when document.fonts.load itself rejects', async () => {
    stubFontFaceSet(() => Promise.reject(new Error('decode error')));
    const promise = loadGoogleFont('Rejecting Font');

    lastLink().onload?.(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
    expect(getGoogleFontAttemptStatus('Rejecting Font')).toBe('failed');
  });

  it('resolves even when document.fonts is entirely absent', async () => {
    // @ts-expect-error test-only: simulate an env with no FontFaceSet API
    delete document.fonts;
    const promise = loadGoogleFont('No FontFaceSet Font');

    lastLink().onload?.(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
    expect(getGoogleFontAttemptStatus('No FontFaceSet Font')).toBe('failed');
  });

  it('dedupes concurrent loads for the same family — one link, one document.fonts.load call', async () => {
    const fonts = stubFontFaceSet();
    const p1 = loadGoogleFont('Concurrent Font');
    const p2 = loadGoogleFont('Concurrent Font');
    expect(p1).toBe(p2);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(1);

    lastLink().onload?.(new Event('load'));
    await p1;

    expect(fonts.load).toHaveBeenCalledTimes(1);
  });

  it('times out after 10s and resolves without waiting on a never-settling font load', async () => {
    vi.useFakeTimers();
    stubFontFaceSet(() => new Promise(() => {})); // never resolves
    const promise = loadGoogleFont('Slow Font');

    let settled = false;
    promise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toBe(true);
  });

  it('keeps a pre-timeout late-ready subscription and emits exactly one final notification', async () => {
    vi.useFakeTimers();
    let resolveFace: (value: unknown[]) => void = () => {};
    stubFontFaceSet(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveFace = resolve;
        }),
    );
    const attempt = ensureGoogleFontAttempt('Late Exact Font', '日本語');
    const notifications: string[] = [];
    void attempt.initial.then(() => notifications.push('initial'));
    attempt.onLateReady(() => notifications.push('late'));

    lastLink().onload?.(new Event('load'));
    await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS);
    await attempt.initial;
    expect(attempt.getStatus()).toBe('timed-out');
    expect(notifications).toEqual(['initial']);

    resolveFace([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(attempt.getStatus()).toBe('late-ready');
    expect(notifications).toEqual(['initial', 'late']);
  });

  it('keeps a timed-out fallback frozen when the underlying face later rejects', async () => {
    vi.useFakeTimers();
    let rejectFace: (reason: Error) => void = () => {};
    stubFontFaceSet(
      () =>
        new Promise((_resolve, reject) => {
          rejectFace = reject;
        }),
    );
    const attempt = ensureGoogleFontAttempt('Late Reject Font', 'X');
    const late = vi.fn();
    attempt.onLateReady(late);
    lastLink().onload?.(new Event('load'));
    await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS);
    await attempt.initial;
    rejectFace(new Error('decode failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(attempt.getStatus()).toBe('timed-out');
    expect(late).not.toHaveBeenCalled();
  });

  it('shares a same-sample attempt but loads different samples independently behind one stylesheet', async () => {
    const fonts = stubFontFaceSet();
    const latin = ensureGoogleFontAttempt('Subset Font', 'ABC');
    expect(ensureGoogleFontAttempt('Subset Font', 'ABC')).toBe(latin);
    const japanese = ensureGoogleFontAttempt('Subset Font', '日本語');
    expect(japanese).not.toBe(latin);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1);
    lastLink().onload?.(new Event('load'));
    await Promise.all([latin.initial, japanese.initial]);
    expect(fonts.load).toHaveBeenCalledTimes(2);
    expect(fonts.load).toHaveBeenCalledWith('16px "Subset Font"', 'ABC');
    expect(fonts.load).toHaveBeenCalledWith('16px "Subset Font"', '日本語');
  });
});

// isGoogleFontLoaded is the family-level "done trying" view used by the Font
// Explorer; exact sample state lives on FontLoadAttempt/get...Status.
describe('isGoogleFontLoaded — family-level sync truth', () => {
  it('is false before a load starts', () => {
    expect(isGoogleFontLoaded('Untouched Font')).toBe(false);
  });

  it('flips true once the family finishes loading', async () => {
    stubFontFaceSet();
    const promise = loadGoogleFont('Truth Font');
    expect(isGoogleFontLoaded('Truth Font')).toBe(false);

    lastLink().onload?.(new Event('load'));
    await promise;

    expect(isGoogleFontLoaded('Truth Font')).toBe(true);
  });

  it('marks a timed-out load as loaded (attempted) even though it never really resolved', async () => {
    vi.useFakeTimers();
    stubFontFaceSet(() => new Promise(() => {}));
    const promise = loadGoogleFont('Timeout Truth Font');

    await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS);
    await promise;

    expect(isGoogleFontLoaded('Timeout Truth Font')).toBe(true);
    expect(getGoogleFontAttemptStatus('Timeout Truth Font')).toBe('timed-out');
  });
});
