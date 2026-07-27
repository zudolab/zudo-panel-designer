import { describe, expect, it } from 'vitest';
import {
  createPcbLayerContainer,
  createPcbLayerStack,
  PALETTE,
  paletteEntry,
  PCB_LAYER_CONTAINER_IDS,
  PCB_LAYER_DEFINITIONS,
  PCB_SUBSTRATE,
  PCB_SUBSTRATE_ALUMI,
  pcbLayerContainerId,
  substrateForMaterial,
} from './palette';

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

describe('structural container ids', () => {
  it('derives per-side ids and exposes all SIX unique structural ids', () => {
    expect(pcbLayerContainerId('front', 'copper')).toBe('pcb-layer-copper');
    expect(pcbLayerContainerId('back', 'copper')).toBe('pcb-layer-back-copper');
    expect(PCB_LAYER_CONTAINER_IDS).toEqual([
      'pcb-layer-copper',
      'pcb-layer-solder-mask',
      'pcb-layer-silkscreen',
      'pcb-layer-back-copper',
      'pcb-layer-back-solder-mask',
      'pcb-layer-back-silkscreen',
    ]);
    expect(new Set(PCB_LAYER_CONTAINER_IDS).size).toBe(6);
  });

  it('builds side-aware containers and stacks (side-less form stays front)', () => {
    expect(createPcbLayerContainer('copper').id).toBe('pcb-layer-copper');
    expect(createPcbLayerContainer('back', 'copper').id).toBe('pcb-layer-back-copper');
    expect(createPcbLayerContainer('back', 'solder-mask', [], true)).toEqual({
      kind: 'pcb-layer',
      id: 'pcb-layer-back-solder-mask',
      role: 'solder-mask',
      children: [],
      hidden: true,
    });
    expect(createPcbLayerStack().map((container) => container.id)).toEqual([
      'pcb-layer-copper',
      'pcb-layer-solder-mask',
      'pcb-layer-silkscreen',
    ]);
    expect(createPcbLayerStack('back').map((container) => container.id)).toEqual([
      'pcb-layer-back-copper',
      'pcb-layer-back-solder-mask',
      'pcb-layer-back-silkscreen',
    ]);
    expect(createPcbLayerStack('back').map((container) => container.role)).toEqual(
      createPcbLayerStack('front').map((container) => container.role),
    );
  });
});

describe('PCB_SUBSTRATE', () => {
  it('is a non-drawable constant, not a PaletteEntry', () => {
    expect(PCB_SUBSTRATE.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(PCB_SUBSTRATE).not.toHaveProperty('index');
    expect(PCB_SUBSTRATE).not.toHaveProperty('name');
    expect(PALETTE).not.toContainEqual(expect.objectContaining({ hex: PCB_SUBSTRATE.hex }));
  });

  it('selects the substrate by document material', () => {
    expect(PCB_SUBSTRATE_ALUMI.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(PCB_SUBSTRATE_ALUMI.hex).not.toBe(PCB_SUBSTRATE.hex);
    expect(substrateForMaterial('fr4')).toBe(PCB_SUBSTRATE);
    expect(substrateForMaterial('alumi')).toBe(PCB_SUBSTRATE_ALUMI);
  });
});
