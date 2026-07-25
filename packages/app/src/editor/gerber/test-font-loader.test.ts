// Regression cover for the loader itself. Four suites once hand-rolled
// `url.startsWith('/@fs') ? url.slice(4) : url`, which passed on a developer
// tree and failed in CI with
//   ENOENT ... open '/node_modules/.pnpm/@fontsource+inter@5.2.8/.../*.woff'
// because the root-relative form Vite emits when the asset sits INSIDE the
// Vite root was read as an absolute path from `/`.
//
// These tests assert both shapes resolve to a file that exists, so the CI-only
// shape is covered on a developer machine too — the failure mode was precisely
// that local runs never exercised it.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATED_FONT_FACES } from './text-fonts';
import { loadTestFontFile, resolveTestFontPath } from './test-font-loader';

const sampleUrl = (): string => {
  const face = [...CURATED_FONT_FACES.values()][0];
  return face.files[0].url;
};

/** The path Vite hands us when the asset lives outside the Vite root. */
function asFsEscapeUrl(absolute: string): string {
  return `/@fs${absolute}`;
}

/** The path Vite hands us when the asset lives inside the Vite root. */
function asRootRelativeUrl(absolute: string): string {
  const marker = '/node_modules/';
  const at = absolute.indexOf(marker);
  return at === -1 ? absolute : absolute.slice(at);
}

describe('test font-asset resolution', () => {
  it('resolves the /@fs escape-hatch shape', () => {
    const absolute = resolveTestFontPath(sampleUrl());
    expect(existsSync(absolute)).toBe(true);
    expect(existsSync(resolveTestFontPath(asFsEscapeUrl(absolute)))).toBe(true);
  });

  it('resolves the root-relative shape — the one that only appears in CI', () => {
    const absolute = resolveTestFontPath(sampleUrl());
    const rootRelative = asRootRelativeUrl(absolute);
    // Guard the fixture itself: if this is not root-relative the test is vacuous.
    expect(rootRelative.startsWith('/node_modules/')).toBe(true);
    expect(rootRelative).not.toBe(absolute);
    expect(existsSync(resolveTestFontPath(rootRelative))).toBe(true);
  });

  it('loads real font bytes through the root-relative shape', async () => {
    const rootRelative = asRootRelativeUrl(resolveTestFontPath(sampleUrl()));
    const bytes = await loadTestFontFile(rootRelative);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // wOFF magic — proves we read the font, not some other file that happened to exist.
    expect(new TextDecoder().decode(new Uint8Array(bytes, 0, 4))).toBe('wOFF');
  });
});
