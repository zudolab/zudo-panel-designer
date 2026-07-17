// localStorage persistence layer for the single-document autosave (Composer
// Parity #72). Dependency-free of React, mirrors the reference tab-store's
// contract shape (see $HOME/repos/zp/pgen/.../lib/tab-store.ts) but reduced
// to zpd's single document: no tabs, no multi-window merge — just one key.
//
// Design goals (matching the reference):
// - Never throws. writeDoc()/readDoc() absorb every error and return a
//   tagged result or null; boot must never crash on a corrupt payload.
// - readDoc() parses via serialize.ts's defensive parsePanelConfig, which
//   itself never throws — a garbage `config` field yields the default doc
//   rather than propagating an exception.
import { parsePanelConfig, serializePanelConfig, type DocState } from '@zpd/core';

export const DOC_STORAGE_KEY = 'zpd.doc.v1';
export const DOC_STORAGE_VERSION = 1;

export type WriteDocFailureReason = 'quota' | 'unavailable' | 'error';
export type WriteDocResult = { ok: true } | { ok: false; reason: WriteDocFailureReason };

interface StoredDocPayload {
  version: number;
  savedAt: number;
  config: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The `window.localStorage` PROPERTY ACCESS itself (not just calling a
// method on it) can throw — e.g. a SecurityError under locked-down privacy
// settings or third-party-storage-blocked contexts — so every caller below
// goes through this guarded accessor instead of touching `window.localStorage`
// directly.
function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// SSR-safe read of the stored document. Returns null when there is no stored
// entry, storage is unavailable, or the stored value is corrupt/unparseable —
// the caller falls back to createDemoDoc() in every one of those cases.
export function readDoc(): DocState | null {
  const storage = getStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(DOC_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[doc-store] Corrupt payload (invalid JSON) at', DOC_STORAGE_KEY);
    return null;
  }

  if (!isPlainObject(parsed) || parsed.config === undefined) {
    console.warn('[doc-store] Corrupt or unrecognised payload shape at', DOC_STORAGE_KEY);
    return null;
  }

  // parsePanelConfig never throws — a malformed config field falls through
  // to per-field defaults rather than sinking the whole boot.
  return parsePanelConfig(parsed.config);
}

// Persist the given document. Never throws — returns a tagged result so the
// caller can drive a save-status chip instead of crashing on a private-
// browsing quota or a serialization failure.
export function writeDoc(doc: DocState): WriteDocResult {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'unavailable' };
  }

  const payload: StoredDocPayload = {
    version: DOC_STORAGE_VERSION,
    savedAt: Date.now(),
    config: serializePanelConfig(doc),
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { ok: false, reason: 'error' };
  }

  try {
    storage.setItem(DOC_STORAGE_KEY, serialized);
    return { ok: true };
  } catch (err) {
    // QuotaExceededError (Chrome/FF/Safari all throw a DOMException with this
    // name) — zpd image layers carry base64 data URLs, so a real document can
    // exceed the quota; unlike the reference app, zpd cannot strip that data
    // without losing the image, so this is a real, user-facing failure mode.
    if (
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      return { ok: false, reason: 'quota' };
    }
    return { ok: false, reason: 'error' };
  }
}

// Remove the stored document. Best-effort — ignores errors.
export function clearDoc(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(DOC_STORAGE_KEY);
  } catch {
    // ignore
  }
}
