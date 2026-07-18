// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac } from './is-mac';

function stubNavigator(overrides: Partial<Navigator>): void {
  vi.stubGlobal('navigator', {
    userAgent: '',
    platform: '',
    maxTouchPoints: 0,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isMac', () => {
  it('reports true for a Mac desktop platform string', () => {
    stubNavigator({ platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isMac()).toBe(true);
  });

  it('reports true for legacy Mac platform strings (MacPPC / Mac68K)', () => {
    stubNavigator({ platform: 'MacPPC' });
    expect(isMac()).toBe(true);
  });

  it('reports false for Windows', () => {
    stubNavigator({ platform: 'Win32' });
    expect(isMac()).toBe(false);
  });

  it('reports false for Linux', () => {
    stubNavigator({ platform: 'Linux x86_64' });
    expect(isMac()).toBe(false);
  });

  it('reports false for iPadOS even though it reports MacIntel — touch is its primary gesture, not Cmd+click', () => {
    stubNavigator({ platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isMac()).toBe(false);
  });

  it('reports false for legacy iPhone/iPad userAgent strings', () => {
    stubNavigator({
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });
    expect(isMac()).toBe(false);
  });

  it('returns false when navigator is unavailable (SSR)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isMac()).toBe(false);
  });
});
