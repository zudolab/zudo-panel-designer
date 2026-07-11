// Curated Google Fonts for silkscreen typography. Loaded on demand via the
// css2 API; canvas text needs document.fonts to actually have the face before
// drawing, hence the load-promise bookkeeping.

export const GOOGLE_FONTS = [
  'Inter',
  'Oswald',
  'Bebas Neue',
  'Orbitron',
  'Rajdhani',
  'Audiowide',
  'Share Tech Mono',
  'Archivo Black',
  'Monoton',
  'Press Start 2P',
] as const;

export const DEFAULT_FONT = 'Oswald';

const loaded = new Set<string>();
const pending = new Map<string, Promise<void>>();

export function isFontLoaded(family: string): boolean {
  return loaded.has(family);
}

export function ensureFontLoaded(family: string): Promise<void> {
  if (loaded.has(family)) return Promise.resolve();
  const existing = pending.get(family);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`;
    link.onload = () => {
      document.fonts
        .load(`16px "${family}"`)
        .then(() => {
          loaded.add(family);
          resolve();
        })
        .catch(() => resolve()); // fall back to default rendering, never block
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  pending.set(family, promise);
  return promise;
}
