// Starred-font favorites, persisted to localStorage. Both tiers of the font
// picker read this — the text inspector's curated dropdown (sorts favorites
// first) and the Font Explorer dialog (star buttons + favorites-first grid
// order) — so it is a single module-level observable store rather than a
// per-component useState: starring a font in the dialog is reflected in the
// inspector without either remounting.
//
// The reference (pgen) backs favorites with an authenticated D1 table; that
// does NOT port to zpd, which has no accounts. A plain string[] under one
// localStorage key is the whole persistence contract here (issue #71).
import { useCallback, useSyncExternalStore } from 'react';

export const FONT_FAVORITES_STORAGE_KEY = 'zpd.font-favorites.v1';

// Stable empty snapshot for the SSR/no-window path — useSyncExternalStore
// requires getServerSnapshot to return a referentially stable value.
const EMPTY: ReadonlySet<string> = new Set<string>();

function readFromStorage(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(FONT_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    // Malformed JSON / storage access denied → behave as if empty; favorites
    // are a convenience, never load-bearing.
    return new Set();
  }
}

// A NEW Set identity is assigned on every mutation so useSyncExternalStore's
// referential-equality check detects the change; subscribers never mutate it.
let current: Set<string> = readFromStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FONT_FAVORITES_STORAGE_KEY, JSON.stringify([...current]));
  } catch {
    // Quota exceeded / private-mode denial — keep the in-memory set so the
    // current session still works; it just won't survive a reload.
  }
}

export function toggleFontFavorite(family: string): void {
  const next = new Set(current);
  if (next.has(family)) {
    next.delete(family);
  } else {
    next.add(family);
  }
  current = next;
  persist();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Set<string> {
  return current;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

// Cross-tab sync (and the hook's test-reset seam): another tab writing the key
// — or a test clearing localStorage — reloads the in-memory set and notifies
// every mounted picker. A `null` key is a Storage.clear(), which also applies.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== FONT_FAVORITES_STORAGE_KEY) return;
    current = readFromStorage();
    emit();
  });
}

export interface FontFavorites {
  favorites: ReadonlySet<string>;
  isFavorite: (family: string) => boolean;
  toggleFavorite: (family: string) => void;
}

export function useFontFavorites(): FontFavorites {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isFavorite = useCallback((family: string) => favorites.has(family), [favorites]);
  const toggleFavorite = useCallback((family: string) => toggleFontFavorite(family), []);
  return { favorites, isFavorite, toggleFavorite };
}
