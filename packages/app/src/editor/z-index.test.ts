import { describe, expect, it } from 'vitest';
import { Z_INDEX } from './z-index';

describe('Z_INDEX', () => {
  it('keeps the modal < toast < tooltip ladder', () => {
    expect(Z_INDEX.modal).toBeLessThan(Z_INDEX.toast);
    expect(Z_INDEX.toast).toBeLessThan(Z_INDEX.tooltip);
  });

  it('matches the composer-parity reference values', () => {
    expect(Z_INDEX.modal).toBe(500);
    expect(Z_INDEX.toast).toBe(600);
    expect(Z_INDEX.tooltip).toBe(10000);
  });
});
