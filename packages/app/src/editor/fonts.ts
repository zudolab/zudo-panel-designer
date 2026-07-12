// Self-hosted fonts via pinned @fontsource/* packages (OFL-licensed) — no
// runtime calls to fonts.googleapis.com. Curated for PCB silkscreen
// typography: bold/geometric/mono faces that stay legible at the small sizes
// silkscreen printing allows. Ported from the working proto's font list
// (_temp-resource/1-panel-designer-proto/src/fonts.ts), which used the
// Google Fonts CDN directly — this swaps that for bundled, offline-capable
// font files.
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

export const DEFAULT_FONT_FAMILY = 'Oswald';

const loaded = new Set<string>();
const pending = new Map<string, Promise<void>>();

// Idempotent: kicks off document.fonts.load once per family and resolves
// once the face is actually usable, so a caller can repaint with the real
// glyphs instead of the fallback face the canvas drew in the meantime.
// Never throws or hangs a caller — a family that fails to load, or a runtime
// with no FontFaceSet API at all (e.g. jsdom by default), just resolves
// without being marked ready, so the fallback face keeps rendering.
export function ensureFont(family: string): Promise<void> {
  if (loaded.has(family)) return Promise.resolve();
  const existing = pending.get(family);
  if (existing) return existing;

  const fontSet = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fontSet?.load) return Promise.resolve();

  const promise = fontSet
    .load(`16px "${family}"`)
    .then(() => {
      loaded.add(family);
    })
    .catch(() => {
      // never block rendering on a font failure; fallback face renders
    });
  pending.set(family, promise);
  return promise;
}
