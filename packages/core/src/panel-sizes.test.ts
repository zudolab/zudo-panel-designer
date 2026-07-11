import { describe, expect, it } from 'vitest';
import { PANEL_HEIGHT_MM, PANEL_SIZES, panelWidthMm } from './panel-sizes';

describe('panelWidthMm', () => {
  it('returns the exact spec width for every tabulated HP', () => {
    for (const size of PANEL_SIZES) {
      expect(panelWidthMm(size.hp)).toBe(size.widthMm);
    }
  });

  it('falls back to the nominal 5.08mm pitch for HP not in the spec table', () => {
    expect(panelWidthMm(7)).toBeCloseTo(7 * 5.08, 5);
    expect(panelWidthMm(9)).toBeCloseTo(9 * 5.08, 5);
    expect(panelWidthMm(84)).toBeCloseTo(84 * 5.08, 5);
  });

  it('the fallback formula never coincides with a real tabulated width', () => {
    for (const size of PANEL_SIZES) {
      expect(size.hp * 5.08).not.toBe(size.widthMm);
    }
  });
});

describe('PANEL_HEIGHT_MM', () => {
  it('is the fixed 3U Eurorack height', () => {
    expect(PANEL_HEIGHT_MM).toBe(128.5);
  });
});
