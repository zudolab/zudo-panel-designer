// @vitest-environment jsdom
//
// jsdom never actually fetches the <link rel="stylesheet"> this module
// appends (no real network, per the task's hard rule), so every test drives
// the link's load/error handlers by hand and stubs document.fonts the same
// way fonts.test.ts does. Each test uses its own unique family name — the
// module's memoization (fontLoadPromises/loadedFonts/loadingFonts) is
// permanent by design (see the dedupe test), so reusing a family across
// tests would leak state between them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFontLoaded, isFontLoading, loadGoogleFont } from './google-font-loader';

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
  });

  it('resolves even when document.fonts is entirely absent', async () => {
    // @ts-expect-error test-only: simulate an env with no FontFaceSet API
    delete document.fonts;
    const promise = loadGoogleFont('No FontFaceSet Font');

    lastLink().onload?.(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
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
});

describe('isFontLoaded / isFontLoading — sync truth', () => {
  it('are both false before a load starts', () => {
    expect(isFontLoaded('Untouched Font')).toBe(false);
    expect(isFontLoading('Untouched Font')).toBe(false);
  });

  it('isFontLoading flips true while in flight and false once settled; isFontLoaded flips true on completion', async () => {
    stubFontFaceSet();
    const promise = loadGoogleFont('Truth Font');
    expect(isFontLoading('Truth Font')).toBe(true);
    expect(isFontLoaded('Truth Font')).toBe(false);

    lastLink().onload?.(new Event('load'));
    await promise;

    expect(isFontLoading('Truth Font')).toBe(false);
    expect(isFontLoaded('Truth Font')).toBe(true);
  });

  it('marks a timed-out load as loaded (attempted) even though it never really resolved', async () => {
    vi.useFakeTimers();
    stubFontFaceSet(() => new Promise(() => {}));
    const promise = loadGoogleFont('Timeout Truth Font');

    await vi.advanceTimersByTimeAsync(FONT_LOAD_TIMEOUT_MS_FOR_TEST);
    await promise;

    expect(isFontLoading('Timeout Truth Font')).toBe(false);
    expect(isFontLoaded('Timeout Truth Font')).toBe(true);
  });
});

// mirrors the module-private FONT_LOAD_TIMEOUT_MS constant for the test above
const FONT_LOAD_TIMEOUT_MS_FOR_TEST = 10000;
