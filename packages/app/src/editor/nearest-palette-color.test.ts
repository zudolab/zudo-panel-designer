import { describe, expect, it } from 'vitest';
import { nearestPaletteIndex, parseColor } from './nearest-palette-color';

// black, gold, white — mirrors @zpd/core's PALETTE order/values
const PANEL_PALETTE = ['#151515', '#d4af37', '#f2f0e9'];

describe('parseColor', () => {
  it('parses 6-digit and 3-digit hex', () => {
    expect(parseColor('#D4AF37')).toBe('#d4af37');
    expect(parseColor('#fff')).toBe('#ffffff');
  });

  it('parses rgb()/rgba() as emitted by @image-tracer-ts', () => {
    expect(parseColor('rgb(212,175,55)')).toBe('#d4af37');
    expect(parseColor('rgba(212, 175, 55, 0.5)')).toBe('#d4af37');
  });

  it('returns null for fill="none"', () => {
    expect(parseColor('none')).toBeNull();
  });
});

describe('nearestPaletteIndex', () => {
  it('maps an exact gold fill to index 1', () => {
    expect(nearestPaletteIndex('rgb(212,175,55)', PANEL_PALETTE)).toBe(1);
  });

  it('picks OKLab-nearest, not RGB-nearest, when the two disagree', () => {
    // #646200 (a dark muted olive/gold) is numerically closer to black under
    // plain squared RGB distance, purely because both are dark — but OKLab,
    // which models perceived lightness/hue, correctly reads it as gold.
    const rgbDistSq = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [pr, pg, pb] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      return (pr - 0x64) ** 2 + (pg - 0x62) ** 2 + (pb - 0x00) ** 2;
    };
    expect(rgbDistSq(PANEL_PALETTE[0])).toBeLessThan(rgbDistSq(PANEL_PALETTE[1])); // sanity: RGB says black

    expect(nearestPaletteIndex('#646200', PANEL_PALETTE)).toBe(1); // OKLab says gold
  });

  it('returns null for an unparseable fill', () => {
    expect(nearestPaletteIndex('none', PANEL_PALETTE)).toBeNull();
  });
});
