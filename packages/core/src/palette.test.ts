import { describe, expect, it } from 'vitest';
import { createPcbLayerStack, PALETTE, paletteEntry, PCB_LAYER_DEFINITIONS } from './palette';

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
    expect(paletteEntry(1).note).toBe('exposed copper (gold/HASL)');
  });
});

describe('PCB_LAYER_DEFINITIONS', () => {
  it('defines the fixed bottom-to-top stack and material mapping', () => {
    expect(PCB_LAYER_DEFINITIONS).toEqual([
      { role: 'copper', id: 'pcb-layer-copper', name: 'Copper', color: 1 },
      {
        role: 'solder-mask',
        id: 'pcb-layer-solder-mask',
        name: 'Solder mask',
        color: 0,
      },
      {
        role: 'silkscreen',
        id: 'pcb-layer-silkscreen',
        name: 'Silkscreen',
        color: 2,
      },
    ]);
    expect(createPcbLayerStack().map((container) => container.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
    ]);
  });
});
