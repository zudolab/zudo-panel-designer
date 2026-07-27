// localStorage persistence layer for the single-document autosave (Composer
// Parity #72). Dependency-free of React, mirrors the reference tab-store's
// contract shape (see $HOME/repos/zp/pgen/.../lib/tab-store.ts) but reduced
// to zpd's single document: no tabs, no multi-window merge — just one key.
//
// Design goals (matching the reference):
// - Never throws. writeDoc()/readDoc() absorb every error and return a
//   tagged result or null; boot must never crash on a corrupt payload.
// - readDoc() validates the envelope before parsing. Unsupported/corrupt
//   source bytes are retained and protected from generated-default autosave.
//
// v1→v2 legacy promotion was deleted outright (epic #226 compat cut): a v1
// (`LEGACY_DOC_STORAGE_KEY`) entry, and any pre-v6 config at either key, is
// never read into a document — readDoc() returns null and boot falls back to
// the demo doc, same as any other unsupported/corrupt payload.
import {
  PANEL_CONFIG_VERSION,
  serializePanelConfig,
  tryParsePanelConfig,
  type DocState,
} from '@zpd/core';
import { getStorage } from './safe-storage';

export const DOC_STORAGE_KEY = 'zpd.doc.v2';
// No longer read from (see header comment) — clearDoc() still purges it, so a
// pre-existing rollback entry from before the compat cut doesn't linger
// forever in a user's storage.
export const LEGACY_DOC_STORAGE_KEY = 'zpd.doc.v1';
export const DOC_STORAGE_VERSION = 2;

export type WriteDocFailureReason = 'quota' | 'unavailable' | 'error';
export type WriteDocResult = { ok: true } | { ok: false; reason: WriteDocFailureReason };

interface StoredDocPayload {
  version: number;
  savedAt: number;
  config: unknown;
}

let protectedEntry: { key: string; raw: string } | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// SSR-safe read of the stored document. Returns null when there is no stored
// entry, storage is unavailable, or the stored value is corrupt/unparseable
// — including a config at any version other than PANEL_CONFIG_VERSION.
function readPayload(raw: string): DocState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isPlainObject(parsed) ||
    parsed.version !== DOC_STORAGE_VERSION ||
    parsed.config === undefined
  ) {
    return null;
  }
  const config = parsed.config;
  if (!isPlainObject(config) || config.version !== PANEL_CONFIG_VERSION) return null;
  const result = tryParsePanelConfig(config);
  return result.ok ? result.doc : null;
}

export function readDoc(): DocState | null {
  const storage = getStorage();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(DOC_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const doc = readPayload(raw);
  if (!doc) {
    protectedEntry = { key: DOC_STORAGE_KEY, raw };
    console.warn('[doc-store] Corrupt or unsupported payload at', DOC_STORAGE_KEY);
  }
  return doc;
}

// Persist the given document. Never throws — returns a tagged result so the
// caller can drive a save-status chip instead of crashing on a private-
// browsing quota or a serialization failure.
export function writeDoc(doc: DocState): WriteDocResult {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'unavailable' };
  }
  // A protected entry is the exact destination this function would
  // overwrite, so keep refusing while those bytes remain unchanged — a real
  // write elsewhere (a fresh readDoc()/writeDoc() cycle) clears the guard.
  if (protectedEntry?.key === DOC_STORAGE_KEY) {
    try {
      if (storage.getItem(protectedEntry.key) === protectedEntry.raw) {
        return { ok: false, reason: 'error' };
      }
      protectedEntry = null;
    } catch {
      return { ok: false, reason: 'error' };
    }
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
    storage.removeItem(LEGACY_DOC_STORAGE_KEY);
    protectedEntry = null;
  } catch {
    // ignore
  }
}
