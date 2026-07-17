// @vitest-environment jsdom
//
// The favorites store is module-level (one observable shared by both picker
// tiers), so each test resets it by clearing localStorage and dispatching a
// storage event — the same seam the store uses for cross-tab sync.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  FONT_FAVORITES_STORAGE_KEY,
  toggleFontFavorite,
  useFontFavorites,
} from './use-font-favorites';

function resetStore() {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: FONT_FAVORITES_STORAGE_KEY, newValue: null }));
}

beforeEach(resetStore);
afterEach(resetStore);

describe('font favorites store', () => {
  it('persists a starred family as a plain string array under the versioned key', () => {
    toggleFontFavorite('Roboto');
    expect(JSON.parse(localStorage.getItem(FONT_FAVORITES_STORAGE_KEY)!)).toEqual(['Roboto']);
  });

  it('toggles a family off on a second call', () => {
    toggleFontFavorite('Roboto');
    toggleFontFavorite('Roboto');
    expect(JSON.parse(localStorage.getItem(FONT_FAVORITES_STORAGE_KEY)!)).toEqual([]);
  });

  it('round-trips: favorites written to localStorage are read back into the set', () => {
    localStorage.setItem(FONT_FAVORITES_STORAGE_KEY, JSON.stringify(['Inter', 'Lato']));
    // A storage event is what a fresh load / another tab would trigger.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: FONT_FAVORITES_STORAGE_KEY,
          newValue: JSON.stringify(['Inter', 'Lato']),
        }),
      );
    });
    const { result } = renderHook(() => useFontFavorites());
    expect(result.current.isFavorite('Inter')).toBe(true);
    expect(result.current.isFavorite('Lato')).toBe(true);
    expect(result.current.isFavorite('Roboto')).toBe(false);
  });

  it('the hook reflects an imperative toggle without a remount', () => {
    const { result } = renderHook(() => useFontFavorites());
    expect(result.current.isFavorite('Poppins')).toBe(false);
    act(() => toggleFontFavorite('Poppins'));
    expect(result.current.isFavorite('Poppins')).toBe(true);
    expect([...result.current.favorites]).toEqual(['Poppins']);
  });

  it('survives malformed stored JSON by treating favorites as empty', () => {
    localStorage.setItem(FONT_FAVORITES_STORAGE_KEY, '{not valid json');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: FONT_FAVORITES_STORAGE_KEY, newValue: '{not valid json' }),
      );
    });
    const { result } = renderHook(() => useFontFavorites());
    expect(result.current.favorites.size).toBe(0);
  });
});
