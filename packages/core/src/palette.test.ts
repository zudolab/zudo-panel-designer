import { describe, expect, it } from 'vitest';
import { PALETTE, paletteEntry } from './palette';

describe('PALETTE', () => {
  it('has exactly 3 entries indexed 0/1/2 with the contract names', () => {
    expect(PALETTE).toHaveLength(3);
    expect(PALETTE.map((entry) => entry.name)).toEqual(['black', 'gold', 'white']);
    expect(PALETTE.map((entry) => entry.index)).toEqual([0, 1, 2]);
  });

  it('exposes the display-approximation hex values', () => {
    expect(PALETTE[0].hex).toBe('#151515');
    expect(PALETTE[1].hex).toBe('#d4af37');
    expect(PALETTE[2].hex).toBe('#f2f0e9');
  });
});

describe('paletteEntry', () => {
  it('looks up an entry by ColorIndex', () => {
    expect(paletteEntry(1).name).toBe('gold');
  });
});
