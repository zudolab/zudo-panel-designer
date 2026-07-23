// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDoc, PANEL_CONFIG_VERSION } from '@zpd/core';
import {
  clearDoc,
  DOC_STORAGE_KEY,
  DOC_STORAGE_VERSION,
  LEGACY_DOC_STORAGE_KEY,
  readDoc,
  writeDoc,
} from './doc-store';

const legacyConfig = {
  version: 4,
  app: 'zpd',
  panel: { hp: 12 },
  layers: [
    {
      id: 'legacy-gold',
      name: 'Legacy gold',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: 1,
    },
  ],
  guides: [],
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('v2 autosave envelope', () => {
  it('writes the current envelope and panel-config version', () => {
    expect(writeDoc(createDefaultDoc())).toEqual({ ok: true });
    const stored = JSON.parse(window.localStorage.getItem(DOC_STORAGE_KEY)!);
    expect(DOC_STORAGE_KEY).toBe('zpd.doc.v2');
    expect(DOC_STORAGE_VERSION).toBe(2);
    expect(stored.version).toBe(2);
    expect(stored.config.version).toBe(PANEL_CONFIG_VERSION);
    expect(readDoc()).toEqual(createDefaultDoc());
  });

  it('reads the new key first and leaves the legacy rollback entry untouched', () => {
    const current = createDefaultDoc(20);
    writeDoc(current);
    window.localStorage.setItem(
      LEGACY_DOC_STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: 1, config: legacyConfig }),
    );
    expect(readDoc()).toEqual(current);
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).not.toBeNull();
  });

  it('validates the envelope and config versions, preserving unsupported data', () => {
    const raw = JSON.stringify({
      version: DOC_STORAGE_VERSION,
      savedAt: 1,
      config: { ...legacyConfig, version: PANEL_CONFIG_VERSION + 1 },
    });
    window.localStorage.setItem(DOC_STORAGE_KEY, raw);
    expect(readDoc()).toBeNull();
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBe(raw);
    expect(writeDoc(createDefaultDoc())).toEqual({ ok: false, reason: 'error' });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBe(raw);
  });

  it('preserves invalid JSON instead of replacing it with a generated default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(DOC_STORAGE_KEY, '{broken');
    expect(readDoc()).toBeNull();
    expect(writeDoc(createDefaultDoc())).toEqual({ ok: false, reason: 'error' });
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBe('{broken');
    expect(warn).toHaveBeenCalled();
  });
});

describe('legacy autosave promotion', () => {
  it('promotes a validated v1-v4 config to the new key and retains the old key', () => {
    const oldRaw = JSON.stringify({ version: 1, savedAt: 1, config: legacyConfig });
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, oldRaw);
    const doc = readDoc();

    expect(doc?.layers[0].children[0]).toMatchObject({ id: 'legacy-gold', color: 1 });
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBe(oldRaw);
    const promoted = JSON.parse(window.localStorage.getItem(DOC_STORAGE_KEY)!);
    expect(promoted.version).toBe(DOC_STORAGE_VERSION);
    expect(promoted.config.version).toBe(PANEL_CONFIG_VERSION);
  });

  it('does not promote or expose legacy data when the new write fails', () => {
    const oldRaw = JSON.stringify({ version: 1, savedAt: 1, config: legacyConfig });
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, oldRaw);
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation((key, value) => {
      if (key === DOC_STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError');
      if (typeof key === 'string' && typeof value === 'string') originalSetItem(key, value);
    });

    expect(readDoc()).toBeNull();
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBe(oldRaw);
  });

  it('does not promote corrupt or future legacy configs', () => {
    const raw = JSON.stringify({
      version: 1,
      savedAt: 1,
      config: { ...legacyConfig, version: PANEL_CONFIG_VERSION },
    });
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, raw);
    expect(readDoc()).toBeNull();
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBe(raw);
  });

  it('allows a later legitimate v2 write without touching protected legacy bytes', () => {
    const raw = JSON.stringify({
      version: 1,
      savedAt: 1,
      config: { ...legacyConfig, version: PANEL_CONFIG_VERSION },
    });
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, raw);
    expect(readDoc()).toBeNull();

    const next = createDefaultDoc(20);
    expect(writeDoc(next)).toEqual({ ok: true });
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBe(raw);
    expect(readDoc()).toEqual(next);
  });
});

describe('clearDoc', () => {
  it('explicitly clears current and rollback entries', () => {
    window.localStorage.setItem(DOC_STORAGE_KEY, 'current');
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, 'legacy');
    clearDoc();
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBeNull();
  });
});
