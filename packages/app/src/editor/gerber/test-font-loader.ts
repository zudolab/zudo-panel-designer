// Test-only loader for the curated `@fontsource` `.woff` assets, shared by
// every suite that exercises text outlining.
//
// Vite resolves a `?url` import to one of TWO shapes, depending on where the
// asset sits relative to the Vite root:
//
//   outside the root -> `/@fs/<absolute path>`   (the fs escape hatch)
//   inside  the root -> `/node_modules/...`      (plain root-relative)
//
// A pnpm workspace can produce either, and WHICH one differs between a
// developer's incrementally-installed tree and CI's fresh install. That is not
// hypothetical: four copies of a hand-rolled
// `url.startsWith('/@fs') ? url.slice(4) : url` helper passed locally and all
// failed in CI with
//
//   ENOENT: no such file or directory, open
//   '/node_modules/.pnpm/@fontsource+inter@5.2.8/.../inter-latin-400-normal.woff'
//
// — the root-relative form read as an absolute filesystem path, from `/`.
//
// So: resolve against candidate bases and take the first that actually exists,
// rather than assuming a layout. Consolidated here precisely because four
// independent copies is how the bug survived review in the first place.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // packages/app/src/editor/gerber
const APP_ROOT = resolve(HERE, '../../..'); // packages/app  — the Vite root
const REPO_ROOT = resolve(HERE, '../../../../..'); // workspace root — holds node_modules/.pnpm

function candidatePaths(url: string): string[] {
  if (url.startsWith('/@fs')) {
    const absolute = url.slice('/@fs'.length);
    return [absolute, join(REPO_ROOT, absolute), join(APP_ROOT, absolute)];
  }
  if (url.startsWith('/')) {
    // Root-relative: relative to a Vite root, NOT to the filesystem root.
    return [join(REPO_ROOT, url), join(APP_ROOT, url), url];
  }
  return [resolve(APP_ROOT, url), resolve(REPO_ROOT, url), url];
}

/** Resolve a Vite `?url` font asset to a real path, whichever shape Vite emitted. */
export function resolveTestFontPath(url: string): string {
  const candidates = candidatePaths(url);
  // Fall back to the first candidate so a genuine miss still reports a
  // plausible path rather than the raw URL.
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/** Loader for `setCuratedFontFileLoaderForTests`. */
export async function loadTestFontFile(url: string): Promise<ArrayBuffer> {
  const buffer = await readFile(resolveTestFontPath(url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
