// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStorage, readStringList, writeStringList } from './safe-storage';

const KEY = 'zpd.test.string-list';

afterEach(() => {
  localStorage.clear();
});

describe('getStorage', () => {
  it('returns the localStorage object in a normal browser context', () => {
    expect(getStorage()).toBe(window.localStorage);
  });
});

describe('readStringList / writeStringList round trip', () => {
  it('persists and reads back a string list', () => {
    writeStringList(KEY, ['a', 'b', 'c']);
    expect(readStringList(KEY)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for a missing key', () => {
    expect(readStringList('zpd.test.absent')).toEqual([]);
  });
});

describe('readStringList — malformed payloads degrade to []', () => {
  it('invalid JSON → []', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readStringList(KEY)).toEqual([]);
  });

  it('a non-array JSON value → []', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(readStringList(KEY)).toEqual([]);
  });

  it('a mixed array keeps only the string entries', () => {
    localStorage.setItem(KEY, JSON.stringify(['ok', 1, null, 'yes', {}]));
    expect(readStringList(KEY)).toEqual(['ok', 'yes']);
  });
});

describe('never throws when the storage APIs throw', () => {
  it('a throwing getItem yields [] rather than propagating', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(readStringList(KEY)).toEqual([]);
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it('a throwing setItem (quota/private mode) is swallowed', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      expect(() => writeStringList(KEY, ['x'])).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
