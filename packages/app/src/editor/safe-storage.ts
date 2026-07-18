// Never-throws localStorage helpers, shared by every small "list of strings
// under a versioned key" persistence surface (font favorites, command-palette
// recents). doc-store.ts keeps its own richer payload logic but reuses the
// same guarded getStorage() accessor. All of these are convenience state —
// malformed or inaccessible storage must degrade to "empty", never crash a
// boot or a keystroke.

// The `window.localStorage` PROPERTY ACCESS itself (not just calling a method
// on it) can throw — e.g. a SecurityError under locked-down privacy settings
// or third-party-storage-blocked contexts — so every caller goes through this
// guarded accessor instead of touching `window.localStorage` directly.
export function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Reads a JSON string[] from `key`. Returns [] for a missing entry,
// unavailable storage, invalid JSON, or a non-array/heterogeneous payload —
// never throws.
export function readStringList(key: string): string[] {
  const storage = getStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

// Persists a string[] as JSON under `key`. Best-effort: a quota/private-mode
// denial (or unavailable storage) is swallowed so the in-memory caller keeps
// working; it just won't survive a reload.
export function writeStringList(key: string, list: readonly string[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch {
    // quota exceeded / private-mode denial — keep going in-memory only
  }
}
