import { describe, expect, it } from 'vitest';
import { ZPD_CORE_VERSION } from './index';

describe('ZPD_CORE_VERSION', () => {
  it('is defined', () => {
    expect(ZPD_CORE_VERSION).toBe('0.0.0');
  });
});
