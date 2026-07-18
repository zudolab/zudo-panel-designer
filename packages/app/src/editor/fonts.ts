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
import {
  ensureGoogleFontAttempt,
  FONT_LOAD_TIMEOUT_MS,
  isGoogleFontLoaded,
  type FontAttemptStatus,
  type FontInitialResult,
  type FontLoadAttempt,
} from './google-font-loader';

export type { FontAttemptStatus, FontInitialResult, FontLoadAttempt } from './google-font-loader';

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

const attempts = new Map<string, FontLoadAttempt>();

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
export function fontRequestKey(family: string, sampleText: string | undefined): string {
  if (CURATED_FAMILIES.has(family) || CSS_GENERIC_FAMILIES.has(family)) return family;
  const sampleKey = sampleText === undefined ? 'u' : `s${sampleText.length}:${sampleText}`;
  return `${family.length}:${family}:${sampleKey}`;
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
  const status = getFontAttemptStatus(family, sampleText);
  if (status !== 'idle' && status !== 'pending') return true;
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
  return getFontAttemptStatus(family, sampleText) === 'pending';
}

function settledAttempt(result: FontInitialResult): FontLoadAttempt {
  const initial = Promise.resolve(result);
  return {
    initial,
    done: initial.then(() => {}),
    getStatus: () => result,
    onLateReady: () => () => {},
  };
}

const EMPTY_FAMILY_ATTEMPT = settledAttempt('ready');

function createLocalAttempt(family: string): FontLoadAttempt {
  let status: FontAttemptStatus = 'pending';
  let settleInitial: (result: FontInitialResult) => void = () => {};
  const callbacks = new Set<() => void>();
  const initial = new Promise<FontInitialResult>((resolve) => {
    settleInitial = resolve;
  });
  const done = initial.then(() => {});
  const settle = (result: FontInitialResult) => {
    if (status !== 'pending') return;
    status = result;
    if (result !== 'timed-out') callbacks.clear();
    settleInitial(result);
  };
  const fontSet = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fontSet?.load) {
    settle('failed');
  } else {
    const timeoutId = setTimeout(() => settle('timed-out'), FONT_LOAD_TIMEOUT_MS);
    fontSet.load(`16px "${family}"`).then(
      () => {
        if (status === 'pending') {
          clearTimeout(timeoutId);
          settle('ready');
        } else if (status === 'timed-out') {
          status = 'late-ready';
          for (const callback of [...callbacks]) callback();
          callbacks.clear();
        }
      },
      () => {
        if (status === 'pending') {
          clearTimeout(timeoutId);
          settle('failed');
        }
      },
    );
  }
  return {
    initial,
    done,
    getStatus: () => status,
    onLateReady(callback) {
      if (status !== 'pending' && status !== 'timed-out') return () => {};
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
}

export function ensureFontAttempt(family: string, sampleText?: string): FontLoadAttempt {
  if (isNonLoadableFamily(family)) return EMPTY_FAMILY_ATTEMPT;
  const key = fontRequestKey(family, sampleText);
  const existing = attempts.get(key);
  if (existing) return existing;
  const attempt = isGoogleFetchedFamily(family)
    ? ensureGoogleFontAttempt(family, sampleText)
    : createLocalAttempt(family);
  attempts.set(key, attempt);
  return attempt;
}

export function getFontAttemptStatus(
  family: string,
  sampleText?: string,
): FontAttemptStatus | 'idle' {
  if (isNonLoadableFamily(family)) return 'ready';
  return attempts.get(fontRequestKey(family, sampleText))?.getStatus() ?? 'idle';
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
  return ensureFontAttempt(family, sampleText).done;
}

/** Clears module memoization between deterministic unit tests. */
export function resetFontStateForTests(): void {
  attempts.clear();
}
