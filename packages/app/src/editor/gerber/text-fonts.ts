/**
 * The curated `@fontsource` `.woff` registry and CSS-faithful subset selection
 * (#212, Decision 8).
 *
 * Three things make this file more than a lookup table:
 *
 *  - **`@fontsource` ships per-Unicode-subset files, not one file per family.**
 *    Inter alone ships 126 `.woff`s (7 subsets × 9 weights × 2 styles). The
 *    canvas paints `${sizeMm}px "${family}"` — weight 400, style normal — so
 *    the 30 files below are exactly the `400-normal` faces of the 10 curated
 *    families, and which one a character comes from is decided per codepoint.
 *
 *  - **`unicode.json`'s KEY ORDER is the `@font-face` declaration order in the
 *    package's `index.css`.** CSS font matching resolves an overlapping
 *    `unicode-range` in favour of the LAST declared rule, so the browser's
 *    priority is that order REVERSED — `latin` beats `latin-ext` beats
 *    `vietnamese`, and Rajdhani's `devanagari` (declared first) loses to both.
 *    Deriving the priority from the shipped JSON instead of hard-coding it
 *    keeps this in step with a `@fontsource` bump; `text-fonts.test.ts` asserts
 *    the JSON order still matches `index.css`.
 *
 *  - **`opentype.js` parses `.woff` natively**, so the `.woff2` twin of every
 *    file here is deliberately ignored and no `wawoff2`/wasm decoder is needed.
 *
 * This module is `await import(...)`-ed by `text-outline.ts`, and it in turn
 * `await import(...)`s `opentype.js`, so neither the parser nor these asset
 * URLs reach the main chunk.
 */

import type { OpenTypeFont } from 'opentype.js';

import archivoBlackLatin from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff?url';
import archivoBlackLatinExt from '@fontsource/archivo-black/files/archivo-black-latin-ext-400-normal.woff?url';
import archivoBlackUnicode from '@fontsource/archivo-black/unicode.json';
import audiowideLatin from '@fontsource/audiowide/files/audiowide-latin-400-normal.woff?url';
import audiowideLatinExt from '@fontsource/audiowide/files/audiowide-latin-ext-400-normal.woff?url';
import audiowideUnicode from '@fontsource/audiowide/unicode.json';
import bebasNeueLatin from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import bebasNeueLatinExt from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff?url';
import bebasNeueUnicode from '@fontsource/bebas-neue/unicode.json';
import interCyrillic from '@fontsource/inter/files/inter-cyrillic-400-normal.woff?url';
import interCyrillicExt from '@fontsource/inter/files/inter-cyrillic-ext-400-normal.woff?url';
import interGreek from '@fontsource/inter/files/inter-greek-400-normal.woff?url';
import interGreekExt from '@fontsource/inter/files/inter-greek-ext-400-normal.woff?url';
import interLatin from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import interLatinExt from '@fontsource/inter/files/inter-latin-ext-400-normal.woff?url';
import interVietnamese from '@fontsource/inter/files/inter-vietnamese-400-normal.woff?url';
import interUnicode from '@fontsource/inter/unicode.json';
import monotonLatin from '@fontsource/monoton/files/monoton-latin-400-normal.woff?url';
import monotonLatinExt from '@fontsource/monoton/files/monoton-latin-ext-400-normal.woff?url';
import monotonUnicode from '@fontsource/monoton/unicode.json';
import orbitronLatin from '@fontsource/orbitron/files/orbitron-latin-400-normal.woff?url';
import orbitronUnicode from '@fontsource/orbitron/unicode.json';
import oswaldCyrillic from '@fontsource/oswald/files/oswald-cyrillic-400-normal.woff?url';
import oswaldCyrillicExt from '@fontsource/oswald/files/oswald-cyrillic-ext-400-normal.woff?url';
import oswaldLatin from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import oswaldLatinExt from '@fontsource/oswald/files/oswald-latin-ext-400-normal.woff?url';
import oswaldVietnamese from '@fontsource/oswald/files/oswald-vietnamese-400-normal.woff?url';
import oswaldUnicode from '@fontsource/oswald/unicode.json';
import pressStart2pCyrillic from '@fontsource/press-start-2p/files/press-start-2p-cyrillic-400-normal.woff?url';
import pressStart2pCyrillicExt from '@fontsource/press-start-2p/files/press-start-2p-cyrillic-ext-400-normal.woff?url';
import pressStart2pGreek from '@fontsource/press-start-2p/files/press-start-2p-greek-400-normal.woff?url';
import pressStart2pLatin from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff?url';
import pressStart2pLatinExt from '@fontsource/press-start-2p/files/press-start-2p-latin-ext-400-normal.woff?url';
import pressStart2pUnicode from '@fontsource/press-start-2p/unicode.json';
import rajdhaniDevanagari from '@fontsource/rajdhani/files/rajdhani-devanagari-400-normal.woff?url';
import rajdhaniLatin from '@fontsource/rajdhani/files/rajdhani-latin-400-normal.woff?url';
import rajdhaniLatinExt from '@fontsource/rajdhani/files/rajdhani-latin-ext-400-normal.woff?url';
import rajdhaniUnicode from '@fontsource/rajdhani/unicode.json';
import shareTechMonoLatin from '@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff?url';
import shareTechMonoUnicode from '@fontsource/share-tech-mono/unicode.json';

/** An inclusive codepoint span from a CSS `unicode-range` token. */
export interface CodePointRange {
  readonly first: number;
  readonly last: number;
}

/** One shipped `<family>-<subset>-400-normal.woff`. */
export interface CuratedFontFile {
  readonly family: string;
  readonly subset: string;
  /** Vite asset URL — a real HTTP URL in the app, an `/@fs/…` path under vitest. */
  readonly url: string;
  readonly ranges: readonly CodePointRange[];
}

export interface CuratedFontFace {
  readonly family: string;
  /** Highest CSS priority FIRST: the last-declared `@font-face` wins. */
  readonly files: readonly CuratedFontFile[];
}

interface FontsourcePackage {
  readonly family: string;
  readonly files: Readonly<Record<string, string>>;
  /** The package's `unicode.json`, key order preserved. */
  readonly unicodeRanges: Readonly<Record<string, string>>;
}

// Family names are the CSS values `fonts.ts`'s CURATED_FONTS puts on a layer;
// `text-fonts.test.ts` asserts the two lists stay identical.
const FONTSOURCE_PACKAGES: readonly FontsourcePackage[] = [
  {
    family: 'Inter',
    files: {
      'cyrillic-ext': interCyrillicExt,
      cyrillic: interCyrillic,
      'greek-ext': interGreekExt,
      greek: interGreek,
      vietnamese: interVietnamese,
      'latin-ext': interLatinExt,
      latin: interLatin,
    },
    unicodeRanges: interUnicode,
  },
  {
    family: 'Oswald',
    files: {
      'cyrillic-ext': oswaldCyrillicExt,
      cyrillic: oswaldCyrillic,
      vietnamese: oswaldVietnamese,
      'latin-ext': oswaldLatinExt,
      latin: oswaldLatin,
    },
    unicodeRanges: oswaldUnicode,
  },
  {
    family: 'Bebas Neue',
    files: { 'latin-ext': bebasNeueLatinExt, latin: bebasNeueLatin },
    unicodeRanges: bebasNeueUnicode,
  },
  {
    family: 'Orbitron',
    files: { latin: orbitronLatin },
    unicodeRanges: orbitronUnicode,
  },
  {
    family: 'Rajdhani',
    files: {
      devanagari: rajdhaniDevanagari,
      'latin-ext': rajdhaniLatinExt,
      latin: rajdhaniLatin,
    },
    unicodeRanges: rajdhaniUnicode,
  },
  {
    family: 'Audiowide',
    files: { 'latin-ext': audiowideLatinExt, latin: audiowideLatin },
    unicodeRanges: audiowideUnicode,
  },
  {
    family: 'Share Tech Mono',
    files: { latin: shareTechMonoLatin },
    unicodeRanges: shareTechMonoUnicode,
  },
  {
    family: 'Archivo Black',
    files: { 'latin-ext': archivoBlackLatinExt, latin: archivoBlackLatin },
    unicodeRanges: archivoBlackUnicode,
  },
  {
    family: 'Monoton',
    files: { 'latin-ext': monotonLatinExt, latin: monotonLatin },
    unicodeRanges: monotonUnicode,
  },
  {
    family: 'Press Start 2P',
    files: {
      'cyrillic-ext': pressStart2pCyrillicExt,
      cyrillic: pressStart2pCyrillic,
      greek: pressStart2pGreek,
      'latin-ext': pressStart2pLatinExt,
      latin: pressStart2pLatin,
    },
    unicodeRanges: pressStart2pUnicode,
  },
];

/**
 * Parse one CSS `unicode-range` value, e.g.
 * `U+0000-00FF,U+0131,U+0152-0153`. Wildcard tokens (`U+4??`) are handled too:
 * `@fontsource` does not currently emit any, but a token silently parsed as
 * something else would mis-route a codepoint rather than fail.
 */
export function parseUnicodeRange(spec: string): CodePointRange[] {
  const ranges: CodePointRange[] = [];
  for (const raw of spec.split(',')) {
    const token = raw.trim().replace(/^u\+/i, '');
    if (token.length === 0) continue;
    if (token.includes('?')) {
      const first = Number.parseInt(token.replace(/\?/g, '0'), 16);
      const last = Number.parseInt(token.replace(/\?/g, 'F'), 16);
      if (Number.isFinite(first) && Number.isFinite(last)) ranges.push({ first, last });
      continue;
    }
    const [start, end] = token.split('-');
    const first = Number.parseInt(start, 16);
    const last = end === undefined ? first : Number.parseInt(end, 16);
    if (Number.isFinite(first) && Number.isFinite(last)) ranges.push({ first, last });
  }
  return ranges;
}

function buildFace(pkg: FontsourcePackage): CuratedFontFace {
  // Reversed declaration order == CSS priority (last matching rule wins).
  const subsets = Object.keys(pkg.unicodeRanges).reverse();
  const files: CuratedFontFile[] = [];
  for (const subset of subsets) {
    const url = pkg.files[subset];
    if (url === undefined) continue;
    files.push({
      family: pkg.family,
      subset,
      url,
      ranges: parseUnicodeRange(pkg.unicodeRanges[subset]),
    });
  }
  return { family: pkg.family, files };
}

export const CURATED_FONT_FACES: ReadonlyMap<string, CuratedFontFace> = new Map(
  FONTSOURCE_PACKAGES.map((pkg) => [pkg.family, buildFace(pkg)]),
);

export function curatedFontFace(family: string): CuratedFontFace | undefined {
  return CURATED_FONT_FACES.get(family);
}

/**
 * The file the browser's font matching would take this codepoint from: the
 * highest-priority face whose `unicode-range` covers it.
 *
 * Deliberately NO fallthrough when the covering file turns out to lack the
 * glyph. CSS stops at the `unicode-range` match and hands the character to the
 * system font from there, which is precisely the silent substitution Decision 8
 * refuses on — so the caller reports `missing-glyph` instead of quietly reading
 * the same character out of a lower-priority subset.
 */
export function subsetFileForCodePoint(
  face: CuratedFontFace,
  codePoint: number,
): CuratedFontFile | undefined {
  return face.files.find((file) =>
    file.ranges.some((range) => codePoint >= range.first && codePoint <= range.last),
  );
}

type FontFileLoader = (url: string) => Promise<ArrayBuffer>;

async function fetchFontFile(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch font file ${url}: ${response.status}`);
  }
  return response.arrayBuffer();
}

let loadFontFile: FontFileLoader = fetchFontFile;
const parsedFonts = new Map<string, Promise<OpenTypeFont>>();

/**
 * Parse one subset file, memoised per URL. `opentype.js` is `await import`-ed
 * here — this is the only place it is referenced at runtime, so it stays out of
 * the main chunk (#212 acceptance criterion).
 */
export function loadCuratedFont(file: CuratedFontFile): Promise<OpenTypeFont> {
  const cached = parsedFonts.get(file.url);
  if (cached) return cached;
  const pending = (async () => {
    const [opentype, buffer] = await Promise.all([import('opentype.js'), loadFontFile(file.url)]);
    return opentype.parse(buffer);
  })();
  parsedFonts.set(file.url, pending);
  return pending;
}

/**
 * Swap the byte source for the `.woff` files. Vitest resolves `?url` imports to
 * an `/@fs/…` path that `fetch` cannot read, so unit tests point this at the
 * filesystem and still parse the REAL shipped font files.
 */
export function setCuratedFontFileLoaderForTests(loader: FontFileLoader | null): void {
  loadFontFile = loader ?? fetchFontFile;
  parsedFonts.clear();
}
