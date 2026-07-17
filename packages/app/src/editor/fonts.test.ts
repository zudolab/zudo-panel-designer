// @vitest-environment jsdom
//
// jsdom (as pinned in this repo) doesn't implement the FontFaceSet API at
// all — document.fonts is undefined — so ensureFont() has two contracts to
// prove: (a) it degrades to a harmless no-op Promise when the API is
// missing (so it never throws/hangs a caller, e.g. the renderer's
// fire-and-forget call on every text layer painted), and (b) once a
// FontFaceSet-shaped stub IS present, it actually drives load -> resolve,
// which is the "the actually-loaded face" contract the text tool/inspector
// depend on to know when to repaint. google-font-loader.ts itself (the
// non-curated routing target) is unit-tested on its own in
// google-font-loader.test.ts — here it's mocked, so these tests stay about
// fonts.ts's routing/memoization contract, not the network-adjacent details.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_FONTS,
  DEFAULT_FONT_FAMILY,
  ensureFont,
  isFontLoaded,
  isFontLoading,
} from './fonts';
import { loadGoogleFont } from './google-font-loader';

vi.mock('./google-font-loader', () => ({
  loadGoogleFont: vi.fn(),
}));

function stubFontFaceSet() {
  const known = new Set<string>();
  const parseFamily = (spec: string) => /"([^"]+)"/.exec(spec)?.[1] ?? spec;
  const fonts = {
    load: vi.fn((spec: string) => {
      known.add(parseFamily(spec));
      return Promise.resolve([]);
    }),
    check: vi.fn((spec: string) => known.has(parseFamily(spec))),
  };
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  return fonts;
}

afterEach(() => {
  // @ts-expect-error test-only teardown of the stubbed FontFaceSet
  delete document.fonts;
  vi.resetAllMocks();
});

describe('curated font list', () => {
  it('has 10 self-hosted entries, and a default that is one of them', () => {
    expect(CURATED_FONTS).toHaveLength(10);
    expect(CURATED_FONTS.some((f) => f.family === DEFAULT_FONT_FAMILY)).toBe(true);
  });
});

describe('ensureFont — load -> repaint contract', () => {
  it('resolves without throwing when no FontFaceSet API exists', async () => {
    expect(document.fonts).toBeUndefined();
    await expect(ensureFont('Orbitron')).resolves.toBeUndefined();
  });

  it('drives document.fonts.load, and document.fonts.check flips true once resolved', async () => {
    // a family distinct from the test above — that one runs with no
    // FontFaceSet API at all, which (by design, see the P1 fix below) now
    // marks the family "attempted" forever so a per-frame caller can't
    // retry it endlessly; reusing that family here would find it already
    // marked and skip document.fonts.load entirely.
    const fonts = stubFontFaceSet();
    expect(document.fonts.check('16px "Inter"')).toBe(false);

    await ensureFont('Inter');

    expect(fonts.load).toHaveBeenCalledWith('16px "Inter"');
    expect(document.fonts.check('16px "Inter"')).toBe(true);
  });

  it('is idempotent — an already-loaded family is not reloaded', async () => {
    const fonts = stubFontFaceSet();
    await ensureFont('Rajdhani');
    await ensureFont('Rajdhani');
    expect(fonts.load).toHaveBeenCalledTimes(1);
  });

  it('never rejects even if the FontFaceSet load itself rejects', async () => {
    Object.defineProperty(document, 'fonts', {
      value: { load: vi.fn(() => Promise.reject(new Error('nope'))), check: vi.fn(() => false) },
      configurable: true,
    });
    await expect(ensureFont('Monoton')).resolves.toBeUndefined();
  });
});

describe('ensureFont — Google Font routing (#67)', () => {
  it('routes a non-curated family through loadGoogleFont, forwarding the sample text', async () => {
    vi.mocked(loadGoogleFont).mockReturnValue(Promise.resolve());
    await ensureFont('My Custom Font', 'Hello World');
    expect(loadGoogleFont).toHaveBeenCalledWith('My Custom Font', 'Hello World');
  });

  it('never touches document.fonts.load directly for a non-curated family', async () => {
    const fonts = stubFontFaceSet();
    vi.mocked(loadGoogleFont).mockReturnValue(Promise.resolve());
    await ensureFont('Another Custom Font');
    expect(fonts.load).not.toHaveBeenCalled();
  });

  it('is idempotent for a non-curated family — loadGoogleFont is called once', async () => {
    vi.mocked(loadGoogleFont).mockReturnValue(Promise.resolve());
    await ensureFont('Repeated Custom Font');
    await ensureFont('Repeated Custom Font');
    expect(loadGoogleFont).toHaveBeenCalledTimes(1);
  });

  it('a curated family never reaches loadGoogleFont', async () => {
    stubFontFaceSet();
    await ensureFont('Bebas Neue');
    expect(loadGoogleFont).not.toHaveBeenCalled();
  });

  it('a CSS generic family (e.g. an imported layer with no real fontFamily) never reaches loadGoogleFont', async () => {
    // 'sans-serif' isn't a Google Font — routing it there would fire a real,
    // pointless network request and dim the layer for up to the timeout.
    const fonts = stubFontFaceSet();
    await ensureFont('sans-serif');
    expect(loadGoogleFont).not.toHaveBeenCalled();
    expect(fonts.load).toHaveBeenCalledWith('16px "sans-serif"');
  });

  it('two different sample texts for the same Google Font family each reach loadGoogleFont', async () => {
    // e.g. two text layers on the same CJK font, one Latin content, one
    // Japanese — both need their own load attempt so their distinct
    // unicode-range subsets actually get requested.
    vi.mocked(loadGoogleFont).mockReturnValue(Promise.resolve());
    await ensureFont('Shared CJK Font', 'ABC');
    await ensureFont('Shared CJK Font', '日本語');
    expect(loadGoogleFont).toHaveBeenNthCalledWith(1, 'Shared CJK Font', 'ABC');
    expect(loadGoogleFont).toHaveBeenNthCalledWith(2, 'Shared CJK Font', '日本語');
  });
});

describe('isFontLoading / isFontLoaded — sync truth', () => {
  it('are both false before a load starts', () => {
    expect(isFontLoading('Never Touched Font')).toBe(false);
    expect(isFontLoaded('Never Touched Font')).toBe(false);
  });

  it('a curated load flips isFontLoading true while in flight, false + isFontLoaded true once resolved', async () => {
    const fonts = stubFontFaceSet();
    let resolveLoad: (v: never[]) => void = () => {};
    fonts.load.mockImplementation(
      () =>
        new Promise<never[]>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const promise = ensureFont('Audiowide');
    expect(isFontLoading('Audiowide')).toBe(true);
    expect(isFontLoaded('Audiowide')).toBe(false);

    resolveLoad([]);
    await promise;

    expect(isFontLoading('Audiowide')).toBe(false);
    expect(isFontLoaded('Audiowide')).toBe(true);
  });

  it('a Google Font load flips isFontLoading true while in flight, false + isFontLoaded true once resolved', async () => {
    let resolveLoad: () => void = () => {};
    vi.mocked(loadGoogleFont).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const promise = ensureFont('Pending Google Font');
    expect(isFontLoading('Pending Google Font')).toBe(true);
    expect(isFontLoaded('Pending Google Font')).toBe(false);

    resolveLoad();
    await promise;

    expect(isFontLoading('Pending Google Font')).toBe(false);
    expect(isFontLoaded('Pending Google Font')).toBe(true);
  });

  it('a failed curated load is still marked loaded (attempted), so a per-frame caller never retries it forever', async () => {
    // renderer.ts fire-and-forgets ensureFont on EVERY paint of a text
    // layer, guarded only by isFontLoaded — a family left unmarked after a
    // real failure would be re-attempted on every single repaint, forever.
    const fonts = stubFontFaceSet();
    fonts.load.mockReturnValue(Promise.reject(new Error('nope')));

    await ensureFont('Share Tech Mono');

    expect(isFontLoading('Share Tech Mono')).toBe(false);
    expect(isFontLoaded('Share Tech Mono')).toBe(true);
  });

  it('a Google Font family is tracked per (family, sampleText) — one sample resolving does not mark the other loaded', async () => {
    let resolveAbc: () => void = () => {};
    vi.mocked(loadGoogleFont).mockImplementation((_family, sampleText) =>
      sampleText === 'ABC'
        ? new Promise<void>((resolve) => {
            resolveAbc = resolve;
          })
        : Promise.resolve(),
    );

    const abcPromise = ensureFont('Independent CJK Font', 'ABC');
    await ensureFont('Independent CJK Font', '日本語');

    expect(isFontLoaded('Independent CJK Font', '日本語')).toBe(true);
    expect(isFontLoaded('Independent CJK Font', 'ABC')).toBe(false);
    expect(isFontLoading('Independent CJK Font', 'ABC')).toBe(true);

    resolveAbc();
    await abcPromise;
    expect(isFontLoaded('Independent CJK Font', 'ABC')).toBe(true);
  });
});
