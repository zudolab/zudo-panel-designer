// Self-hosted fonts via pinned @fontsource/* packages (OFL-licensed) — no
// runtime calls to fonts.googleapis.com for these 10. Curated for PCB
// silkscreen typography: bold/geometric/mono faces that stay legible at the
// small sizes silkscreen printing allows. Ported from the working proto's
// font list (_temp-resource/1-panel-designer-proto/src/fonts.ts), which used
// the Google Fonts CDN directly — this swaps that for bundled,
// offline-capable font files. Any OTHER family (e.g. picked via the Google
// Font browser, issue #67) is fetched at runtime through
// google-font-loader.ts instead.
import '@fontsource/inter';
import '@fontsource/oswald';
import '@fontsource/bebas-neue';
import '@fontsource/orbitron';
import '@fontsource/rajdhani';
import '@fontsource/audiowide';
import '@fontsource/share-tech-mono';
import '@fontsource/archivo-black';
import '@fontsource/monoton';
import '@fontsource/press-start-2p';
import { isGoogleFontLoaded, loadGoogleFont } from './google-font-loader';

export interface FontEntry {
  family: string; // both the display label and the CSS font-family value
  cssName: string;
}

export const CURATED_FONTS: readonly FontEntry[] = [
  { family: 'Inter', cssName: 'Inter' },
  { family: 'Oswald', cssName: 'Oswald' },
  { family: 'Bebas Neue', cssName: 'Bebas Neue' },
  { family: 'Orbitron', cssName: 'Orbitron' },
  { family: 'Rajdhani', cssName: 'Rajdhani' },
  { family: 'Audiowide', cssName: 'Audiowide' },
  { family: 'Share Tech Mono', cssName: 'Share Tech Mono' },
  { family: 'Archivo Black', cssName: 'Archivo Black' },
  { family: 'Monoton', cssName: 'Monoton' },
  { family: 'Press Start 2P', cssName: 'Press Start 2P' },
];

const CURATED_FAMILIES = new Set(CURATED_FONTS.map((f) => f.family));

// CSS's own generic keywords — the canvas's built-in fallback faces (e.g. an
// imported/legacy layer with no real fontFamily set), not real font names to
// fetch from Google. Routing these through loadGoogleFont would fire a real,
// pointless network request and dim the layer for up to the 10s timeout.
const CSS_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

export const DEFAULT_FONT_FAMILY = 'Oswald';

const loaded = new Set<string>();
const pending = new Map<string, Promise<void>>();

// Curated + generic families are sample-agnostic (one bundled file / the
// browser's own built-in face — no unicode-range subsetting concern), so
// they're tracked by family alone. A Google Font is tracked per (family,
// sampleText): two text layers sharing a family but needing different
// glyphs (e.g. a CJK font's Latin vs. Japanese subsets) must each get their
// own load attempt, or the second layer's subset would never be requested
// and its `isFontLoaded`/`isFontLoading` truth would never reflect reality.
// Length-prefixing `family` (rather than joining with a separator character)
// makes the split point unambiguous, so two different (family, sampleText)
// pairs can never collide onto the same key.
function fontKey(family: string, sampleText: string | undefined): string {
  if (CURATED_FAMILIES.has(family) || CSS_GENERIC_FAMILIES.has(family)) return family;
  return `${family.length}:${family}${sampleText ?? ''}`;
}

// An empty / whitespace-only family (e.g. a legacy or imported text layer that
// never had a real fontFamily set) is neither a curated face nor a CSS
// generic, so it must NOT be routed to the Google Fonts network path — that
// would fire css2?family=&display=swap and dim the layer for the whole 10s
// timeout. There is genuinely nothing to fetch: the canvas renders its own
// default face. Treated everywhere here as an immediately-ready no-op.
function isNonLoadableFamily(family: string): boolean {
  return family.trim() === '';
}

function isGoogleFetchedFamily(family: string): boolean {
  return !CURATED_FAMILIES.has(family) && !CSS_GENERIC_FAMILIES.has(family);
}

export function isFontLoaded(family: string, sampleText?: string): boolean {
  if (isNonLoadableFamily(family)) return true;
  if (loaded.has(fontKey(family, sampleText))) return true;
  // Family-level query (no sampleText) for a Google-fetched family: delegate
  // to the loader's family-deduped readiness so a caller that knows only the
  // family — the Font Explorer's cards — sees a font warmed via loadGoogleFont
  // as loaded. A per-sample query (the renderer, passing the layer's content)
  // stays exact: each (family, sample) subset loads on its own, no delegation.
  if (sampleText === undefined && isGoogleFetchedFamily(family)) {
    return isGoogleFontLoaded(family);
  }
  return false;
}

// True while `family` (+ `sampleText` for a Google Font) has an in-flight
// load — the renderer dims a text layer's fallback-face paint while this is
// true (#67).
export function isFontLoading(family: string, sampleText?: string): boolean {
  if (isNonLoadableFamily(family)) return false;
  return pending.has(fontKey(family, sampleText));
}

// Idempotent: kicks off the font load once per (family, sample) and resolves
// once the face is actually usable (or the loader has given up trying), so a
// caller can repaint with the real glyphs instead of the fallback face the
// canvas drew in the meantime. Never throws or hangs a caller, and never
// retries forever either — a family/sample that fails to load, or a runtime
// with no FontFaceSet API at all (e.g. jsdom by default), is still marked
// "done trying" so a per-frame caller (the renderer) doesn't re-attempt it on
// every repaint. `sampleText` (typically the layer's own content) is
// forwarded to the Google Font path so unicode-range subsets fetch the
// glyphs actually being rendered, not just the default Latin range.
export function ensureFont(family: string, sampleText?: string): Promise<void> {
  // Nothing to load for an empty/whitespace family — resolve immediately
  // without touching the network or document.fonts (see isNonLoadableFamily).
  if (isNonLoadableFamily(family)) return Promise.resolve();
  const key = fontKey(family, sampleText);
  if (loaded.has(key)) return Promise.resolve();
  const existing = pending.get(key);
  if (existing) return existing;

  if (isGoogleFetchedFamily(family)) {
    const promise = loadGoogleFont(family, sampleText).then(() => {
      loaded.add(key);
      pending.delete(key);
    });
    pending.set(key, promise);
    return promise;
  }

  const fontSet = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fontSet?.load) {
    loaded.add(key);
    return Promise.resolve();
  }

  const promise = fontSet
    .load(`16px "${family}"`)
    .then(() => {})
    .catch(() => {
      // never block rendering on a font failure; fallback face renders
    })
    .finally(() => {
      // marked loaded (== "attempted") even on failure — otherwise the
      // renderer's per-frame caller would retry a permanently-failing
      // family forever
      loaded.add(key);
      pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}
