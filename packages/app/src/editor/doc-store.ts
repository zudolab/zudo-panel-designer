// localStorage persistence layer for the single-document autosave (Composer
// Parity #72). Dependency-free of React, mirrors the reference tab-store's
// contract shape (see $HOME/repos/zp/pgen/.../lib/tab-store.ts) but reduced
// to zpd's single document: no tabs, no multi-window merge — just one key.
//
// Design goals (matching the reference):
// - Never throws. writeDoc()/readDoc() absorb every error and return a
//   tagged result or null; boot must never crash on a corrupt payload.
// - readDoc() validates both envelopes before parsing. Unsupported/corrupt
//   source bytes are retained and protected from generated-default autosave.
import {
  PANEL_CONFIG_VERSION,
  serializePanelConfig,
  tryParsePanelConfig,
  type DocState,
} from '@zpd/core';
import { getStorage } from './safe-storage';

export const DOC_STORAGE_KEY = 'zpd.doc.v2';
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
// entry, storage is unavailable, or the stored value is corrupt/unparseable.
function readPayload(raw: string, expectedEnvelopeVersion: number): DocState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isPlainObject(parsed) ||
    parsed.version !== expectedEnvelopeVersion ||
    parsed.config === undefined
  ) {
    return null;
  }
  const config = parsed.config;
  if (!isPlainObject(config)) return null;
  if (expectedEnvelopeVersion === DOC_STORAGE_VERSION && config.version !== PANEL_CONFIG_VERSION) {
    return null;
  }
  if (
    expectedEnvelopeVersion === 1 &&
    (typeof config.version !== 'number' ||
      !Number.isInteger(config.version) ||
      config.version < 1 ||
      config.version >= PANEL_CONFIG_VERSION)
  ) {
    return null;
  }
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
  if (raw !== null) {
    const doc = readPayload(raw, DOC_STORAGE_VERSION);
    if (!doc) {
      protectedEntry = { key: DOC_STORAGE_KEY, raw };
      console.warn('[doc-store] Corrupt or unsupported payload at', DOC_STORAGE_KEY);
    }
    return doc;
  }

  let legacyRaw: string | null;
  try {
    legacyRaw = storage.getItem(LEGACY_DOC_STORAGE_KEY);
  } catch {
    return null;
  }
  if (legacyRaw === null) return null;
  const legacyDoc = readPayload(legacyRaw, 1);
  if (!legacyDoc) {
    protectedEntry = { key: LEGACY_DOC_STORAGE_KEY, raw: legacyRaw };
    console.warn('[doc-store] Corrupt or unsupported payload at', LEGACY_DOC_STORAGE_KEY);
    return null;
  }

  // Promotion is transactional from the reader's point of view: only expose
  // the migrated document after its v5 envelope was persisted successfully.
  const promoted = writeDoc(legacyDoc);
  return promoted.ok ? legacyDoc : null;
}

// Persist the given document. Never throws — returns a tagged result so the
// caller can drive a save-status chip instead of crashing on a private-
// browsing quota or a serialization failure.
export function writeDoc(doc: DocState): WriteDocResult {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, reason: 'unavailable' };
  }
  // A protected current entry is the exact destination this function would
  // overwrite, so keep refusing while those bytes remain. A protected legacy
  // entry lives under a separate rollback key: writing v2 cannot replace it,
  // and must remain available so subsequent real user work can autosave.
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
