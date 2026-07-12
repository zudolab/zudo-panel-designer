// @vitest-environment jsdom
//
// jsdom (as pinned in this repo) doesn't implement the FontFaceSet API at
// all — document.fonts is undefined — so ensureFont() has two contracts to
// prove: (a) it degrades to a harmless no-op Promise when the API is
// missing (so it never throws/hangs a caller, e.g. the renderer's
// fire-and-forget call on every text layer painted), and (b) once a
// FontFaceSet-shaped stub IS present, it actually drives load -> resolve,
// which is the "the actually-loaded face" contract the text tool/inspector
// depend on to know when to repaint.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURATED_FONTS, DEFAULT_FONT_FAMILY, ensureFont } from './fonts';

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
    const fonts = stubFontFaceSet();
    expect(document.fonts.check('16px "Orbitron"')).toBe(false);

    await ensureFont('Orbitron');

    expect(fonts.load).toHaveBeenCalledWith('16px "Orbitron"');
    expect(document.fonts.check('16px "Orbitron"')).toBe(true);
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
