// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDoc, type DocState } from '@zpd/core';
import { clearDoc, DOC_STORAGE_KEY, readDoc, writeDoc } from './doc-store';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('writeDoc', () => {
  it('persists the doc under zpd.doc.v1 as {version, savedAt, config}', () => {
    const doc = createDefaultDoc();
    const result = writeDoc(doc);
    expect(result).toEqual({ ok: true });

    const raw = window.localStorage.getItem(DOC_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored.version).toBe(1);
    expect(typeof stored.savedAt).toBe('number');
    expect(stored.config.app).toBe('zpd');
    expect(stored.config.layers).toEqual(doc.layers);
  });

  it('returns {ok:false, reason:"quota"} when setItem throws QuotaExceededError, and never throws', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    let result;
    expect(() => {
      result = writeDoc(createDefaultDoc());
    }).not.toThrow();
    expect(result).toEqual({ ok: false, reason: 'quota' });
    setItemSpy.mockRestore();
  });

  it('treats the legacy Firefox quota error name the same as QuotaExceededError', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'NS_ERROR_DOM_QUOTA_REACHED');
    });
    const result = writeDoc(createDefaultDoc());
    expect(result).toEqual({ ok: false, reason: 'quota' });
    setItemSpy.mockRestore();
  });

  it('returns {ok:false, reason:"error"} on a non-quota setItem failure', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = writeDoc(createDefaultDoc());
    expect(result).toEqual({ ok: false, reason: 'error' });
    setItemSpy.mockRestore();
  });

  it('returns {ok:false, reason:"error"} when serialization fails', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('circular');
    });
    const result = writeDoc(createDefaultDoc());
    expect(result).toEqual({ ok: false, reason: 'error' });
    stringifySpy.mockRestore();
  });

  it('returns {ok:false, reason:"unavailable"} when localStorage is not present', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    // @ts-expect-error simulating a browser with storage disabled
    delete window.localStorage;
    try {
      const result = writeDoc(createDefaultDoc());
      expect(result).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('returns {ok:false, reason:"unavailable"} and never throws when the localStorage getter itself throws (e.g. SecurityError under locked-down privacy settings)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage access blocked', 'SecurityError');
      },
    });
    try {
      let result;
      expect(() => {
        result = writeDoc(createDefaultDoc());
      }).not.toThrow();
      expect(result).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('readDoc', () => {
  it('returns null when nothing is stored', () => {
    expect(readDoc()).toBeNull();
  });

  it('returns null and never throws when the localStorage getter itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage access blocked', 'SecurityError');
      },
    });
    try {
      expect(() => readDoc()).not.toThrow();
      expect(readDoc()).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('round-trips a document written by writeDoc', () => {
    const doc = createDefaultDoc(24);
    writeDoc(doc);
    const restored = readDoc();
    expect(restored).toEqual(doc);
  });

  it('returns null and warns (never throws) on invalid JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(DOC_STORAGE_KEY, 'not json{{{');
    expect(readDoc()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null and warns on a non-object payload', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(readDoc()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null and warns when the config field is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify({ version: 1, savedAt: Date.now() }));
    expect(readDoc()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to per-field defaults (never crashes) on a malformed config', () => {
    window.localStorage.setItem(
      DOC_STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), config: { layers: 'not-an-array', panel: { hp: -5 } } }),
    );
    const doc = readDoc();
    expect(doc).not.toBeNull();
    expect(doc!.layers).toEqual([]);
  });

  it('drops a layer with an unrecognized type rather than the whole doc', () => {
    const doc: DocState = createDefaultDoc();
    writeDoc(doc);
    const raw = JSON.parse(window.localStorage.getItem(DOC_STORAGE_KEY)!);
    raw.config.layers.push({ id: 'mystery', name: 'x', type: 'unknown-future-type' });
    window.localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(raw));

    const restored = readDoc();
    expect(restored!.layers).toEqual(doc.layers);
  });
});

describe('clearDoc', () => {
  it('removes the stored payload', () => {
    writeDoc(createDefaultDoc());
    expect(readDoc()).not.toBeNull();
    clearDoc();
    expect(readDoc()).toBeNull();
  });

  it('is a best-effort no-op when localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    // @ts-expect-error simulating a browser with storage disabled
    delete window.localStorage;
    try {
      expect(() => clearDoc()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
