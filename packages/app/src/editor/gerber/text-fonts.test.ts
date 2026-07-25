// The registry's whole job is to reproduce the browser's per-codepoint choice
// of `@fontsource` subset file. These tests therefore check it against the
// SHIPPED packages — the real `index.css` declaration order and the real
// `.woff` bytes — rather than against a hand-copied table, so a `@fontsource`
// bump that reorders or drops a subset fails here instead of silently
// exporting a character from the wrong file.
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CURATED_FONTS } from '../fonts';
import {
  CURATED_FONT_FACES,
  curatedFontFace,
  loadCuratedFont,
  parseUnicodeRange,
  setCuratedFontFileLoaderForTests,
  subsetFileForCodePoint,
} from './text-fonts';

// Vitest resolves a `?url` import to `/@fs/<absolute path>`, which `fetch`
// cannot read but the filesystem can.
function fsPath(url: string): string {
  return url.startsWith('/@fs') ? url.slice('/@fs'.length) : url;
}

beforeAll(() => {
  setCuratedFontFileLoaderForTests(async (url) => {
    const buffer = await readFile(fsPath(url));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
});

describe('parseUnicodeRange', () => {
  it('parses single codepoints, spans and wildcards', () => {
    expect(parseUnicodeRange('U+0131')).toEqual([{ first: 0x131, last: 0x131 }]);
    expect(parseUnicodeRange('U+0000-00FF,U+0152-0153')).toEqual([
      { first: 0x0, last: 0xff },
      { first: 0x152, last: 0x153 },
    ]);
    expect(parseUnicodeRange('U+4??')).toEqual([{ first: 0x400, last: 0x4ff }]);
  });
});

describe('curated font registry', () => {
  it('covers exactly the 10 families fonts.ts curates', () => {
    expect([...CURATED_FONT_FACES.keys()].sort()).toEqual(
      CURATED_FONTS.map((entry) => entry.family).sort(),
    );
  });

  it('orders every face by CSS priority — the reverse of index.css', async () => {
    for (const face of CURATED_FONT_FACES.values()) {
      const packageDir = dirname(dirname(fsPath(face.files[0].url)));
      const familyId = basename(packageDir);
      const css = await readFile(`${packageDir}/index.css`, 'utf8');

      const declared = [...css.matchAll(/\/\* ([a-z0-9-]+)-400-normal \*\//g)]
        .map((match) => match[1].slice(familyId.length + 1))
        .filter((subset, index, all) => all.indexOf(subset) === index);

      // Last-declared wins in CSS font matching, so priority order is the
      // declaration order reversed.
      expect(face.files.map((file) => file.subset)).toEqual([...declared].reverse());
      // `latin` is always declared last, so it always wins an overlap.
      expect(face.files[0].subset).toBe('latin');
    }
  });

  it('routes a codepoint to the subset the browser would use', () => {
    const inter = curatedFontFace('Inter')!;
    expect(subsetFileForCodePoint(inter, 'A'.codePointAt(0)!)?.subset).toBe('latin');
    expect(subsetFileForCodePoint(inter, 'Ā'.codePointAt(0)!)?.subset).toBe('latin-ext');
    expect(subsetFileForCodePoint(inter, 'Д'.codePointAt(0)!)?.subset).toBe('cyrillic');
    expect(subsetFileForCodePoint(inter, 'α'.codePointAt(0)!)?.subset).toBe('greek');
    // Outside every shipped subset: the canvas silently used a system face.
    expect(subsetFileForCodePoint(inter, '中'.codePointAt(0)!)).toBeUndefined();
  });

  it('gives an overlapping codepoint to the highest-priority subset', () => {
    // U+0304 COMBINING MACRON is in the unicode-range of latin, latin-ext AND
    // vietnamese. CSS hands it to the last declared, which is latin.
    const inter = curatedFontFace('Inter')!;
    const covering = inter.files.filter((file) =>
      file.ranges.some((range) => 0x304 >= range.first && 0x304 <= range.last),
    );
    expect(covering.map((file) => file.subset)).toContain('latin-ext');
    expect(subsetFileForCodePoint(inter, 0x304)?.subset).toBe('latin');
  });

  it('reports a family it does not ship', () => {
    expect(curatedFontFace('Comic Sans MS')).toBeUndefined();
  });
});

describe('loadCuratedFont', () => {
  it('parses the shipped .woff natively — no woff2 decoder involved', async () => {
    const inter = curatedFontFace('Inter')!;
    const latin = inter.files.find((file) => file.subset === 'latin')!;
    expect(latin.url.endsWith('.woff')).toBe(true);

    const font = await loadCuratedFont(latin);
    expect(font.outlinesFormat).toBe('truetype');
    expect(font.unitsPerEm).toBe(2048);
    expect(font.hasChar('A')).toBe(true);
    // U+0007 is inside `latin`'s U+0000-00FF range but carries no glyph. That
    // gap between a range hit and a real outline is exactly what the
    // `missing-glyph` refusal exists to catch.
    expect(subsetFileForCodePoint(inter, 0x07)?.subset).toBe('latin');
    expect(font.hasChar('\u0007')).toBe(false);
  });

  it('memoises per file', async () => {
    const oswald = curatedFontFace('Oswald')!;
    const latin = oswald.files.find((file) => file.subset === 'latin')!;
    expect(await loadCuratedFont(latin)).toBe(await loadCuratedFont(latin));
  });

  it('parses every shipped curated file', async () => {
    for (const face of CURATED_FONT_FACES.values()) {
      for (const file of face.files) {
        const font = await loadCuratedFont(file);
        expect(font.numGlyphs, `${file.family}/${file.subset}`).toBeGreaterThan(0);
      }
    }
  });
});
