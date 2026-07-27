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

  it('discards a v5 (or any pre-v6) config stored directly at the current key, no promotion (#229 acceptance)', () => {
    const raw = JSON.stringify({
      version: DOC_STORAGE_VERSION,
      savedAt: 1,
      config: { ...legacyConfig, version: PANEL_CONFIG_VERSION - 1 },
    });
    window.localStorage.setItem(DOC_STORAGE_KEY, raw);
    expect(readDoc()).toBeNull();
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

describe('legacy autosave: the v1 read-and-promote path is deleted (schema-v6 compat cut, #229)', () => {
  it('never reads the legacy key at all: a v1-only entry leaves readDoc() null with no warning, no v2 write', () => {
    // Unlike the pre-#229 interim behavior (readDoc() opened the legacy key,
    // found it unsupported, and warned), readDoc() now never looks at
    // LEGACY_DOC_STORAGE_KEY when the current key is empty — there is simply
    // no promotion code path left to run.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const oldRaw = JSON.stringify({ version: 1, savedAt: 1, config: legacyConfig });
    window.localStorage.setItem(LEGACY_DOC_STORAGE_KEY, oldRaw);

    expect(readDoc()).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DOC_STORAGE_KEY)).toBe(oldRaw);
    expect(window.localStorage.getItem(DOC_STORAGE_KEY)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a legacy entry even when its config is already at the current PANEL_CONFIG_VERSION', () => {
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

  it('a later legitimate v2 write proceeds untouched by a leftover legacy entry', () => {
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
