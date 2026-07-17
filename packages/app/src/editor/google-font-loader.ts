// Ported from pgen's google-font-loader.ts (~35 lines) for zpd's Google Font
// browser (issue #67). Two deliberate deviations from the reference:
//  - regular weight only: TextLayer has no fontWeight field and the
//    renderer's ctx.font string carries no weight component, so the css2
//    request asks for just the default face — not the reference's 4-variant
//    ital/wght request, which can also fail outright for families that don't
//    ship those faces.
//  - sampleText is forwarded to document.fonts.load so unicode-range
//    subsets (e.g. Japanese fonts split into per-glyph-range faces) fetch
//    the glyphs a caller is about to render, not just the default Latin
//    range.
const fontLoadPromises = new Map<string, Promise<void>>();
const loadedFonts = new Set<string>();
const loadingFonts = new Set<string>();
// Per-family set of sample texts already sent to document.fonts.load. The
// <link> stylesheet is deduplicated by family alone (below) — but two
// callers sharing a family with DIFFERENT sample text (e.g. two text layers
// on the same CJK font, one Latin, one Japanese) each need their own
// explicit load call, or the second caller's unicode-range subset would
// never actually get requested (review finding, #67).
const requestedSamples = new Map<string, Set<string>>();

const FONT_LOAD_TIMEOUT_MS = 10000;

export function isFontLoaded(family: string): boolean {
  return loadedFonts.has(family);
}

export function isFontLoading(family: string): boolean {
  return loadingFonts.has(family);
}

function requestFontFace(family: string, sampleText: string | undefined): Promise<unknown> {
  const key = sampleText ?? '';
  const seen = requestedSamples.get(family) ?? new Set<string>();
  if (seen.has(key)) return Promise.resolve();
  seen.add(key);
  requestedSamples.set(family, seen);

  const fontSet = typeof document === 'undefined' ? undefined : document.fonts;
  return fontSet?.load ? fontSet.load(`16px "${family}"`, sampleText) : Promise.resolve();
}

export function loadGoogleFont(family: string, sampleText?: string): Promise<void> {
  const existing = fontLoadPromises.get(family);
  if (existing) {
    // stylesheet already requested for this family — still make sure THIS
    // sample's glyphs get their own load call; fire-and-forget, doesn't
    // gate the family's memoized promise or repeat the <link>/timeout race.
    requestFontFace(family, sampleText).catch(() => {});
    return existing;
  }

  loadingFonts.add(family);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
  document.head.appendChild(link);

  // Wait for the stylesheet to load so @font-face rules are registered,
  // then wait for the actual font binary to be ready.
  const stylesheetLoaded = new Promise<void>((resolve) => {
    link.onload = () => resolve();
    link.onerror = () => resolve();
  });
  const fontReady = stylesheetLoaded
    .then(() => requestFontFace(family, sampleText))
    .then(() => {})
    .catch(() => {
      // a FontFaceSet.load rejection must not surface — the fallback face
      // keeps rendering, same contract as a timed-out load below
    });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS));
  const promise = Promise.race([fontReady, timeout]).then(() => {
    loadedFonts.add(family);
    loadingFonts.delete(family);
  });
  fontLoadPromises.set(family, promise);
  return promise;
}
