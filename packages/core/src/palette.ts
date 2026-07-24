// Fixed 3-color palette — the physical PCB panel finish decides these:
// black routes to the solder-mask container, where it OPENS the mask
// (reveals copper, or bare substrate, beneath) rather than painting mask on;
// gold = exposed copper with the product's HASL finish; white = silkscreen.
// The hex values are display approximations for the editor UI; the color
// names are the contract other packages (patterns, serialize, app) rely on.
import type { ColorIndex, PcbLayerContainer, PcbLayerRole, PcbLayerStack } from './types';

export interface PaletteEntry {
  index: ColorIndex;
  name: 'black' | 'gold' | 'white';
  hex: string;
  note: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, name: 'black', hex: '#151515', note: 'solder-mask opening (reveals copper beneath)' },
  { index: 1, name: 'gold', hex: '#d4af37', note: 'exposed copper (gold/HASL)' },
  { index: 2, name: 'white', hex: '#f2f0e9', note: 'silkscreen' },
] as const;

export function paletteEntry(index: ColorIndex): PaletteEntry {
  return PALETTE[index];
}

export interface PcbLayerDefinition<R extends PcbLayerRole = PcbLayerRole> {
  readonly role: R;
  readonly id: `pcb-layer-${R}`;
  readonly name: 'Copper' | 'Solder mask' | 'Silkscreen';
  readonly color: ColorIndex;
}

export const PCB_LAYER_DEFINITIONS: readonly [
  PcbLayerDefinition<'copper'>,
  PcbLayerDefinition<'solder-mask'>,
  PcbLayerDefinition<'silkscreen'>,
] = [
  { role: 'copper', id: 'pcb-layer-copper', name: 'Copper', color: 1 },
  { role: 'solder-mask', id: 'pcb-layer-solder-mask', name: 'Solder mask', color: 0 },
  { role: 'silkscreen', id: 'pcb-layer-silkscreen', name: 'Silkscreen', color: 2 },
] as const;

export const PCB_LAYER_ROLES = PCB_LAYER_DEFINITIONS.map(
  (definition) => definition.role,
) as unknown as readonly ['copper', 'solder-mask', 'silkscreen'];

export function pcbLayerDefinition<R extends PcbLayerRole>(role: R): PcbLayerDefinition<R> {
  return PCB_LAYER_DEFINITIONS.find(
    (definition) => definition.role === role,
  ) as PcbLayerDefinition<R>;
}

export function pcbLayerRoleForColor(color: ColorIndex): PcbLayerRole {
  return color === 1 ? 'copper' : color === 2 ? 'silkscreen' : 'solder-mask';
}

// Bare FR4 laminate visible through a solder-mask opening with no copper
// beneath it. Not a PaletteEntry: it has no ColorIndex/palette slot — it
// never appears as a drawable layer color, only as a renderer fill value.
export const PCB_SUBSTRATE: { hex: string; note: string } = {
  hex: '#a8946a',
  note: 'bare FR4 laminate under mask openings',
};

export function createPcbLayerContainer<R extends PcbLayerRole>(
  role: R,
  children: PcbLayerContainer<R>['children'] = [],
  hidden?: boolean,
): PcbLayerContainer<R> {
  const definition = pcbLayerDefinition(role);
  const container: PcbLayerContainer<R> = {
    kind: 'pcb-layer',
    id: definition.id,
    role,
    children,
  };
  return hidden === undefined ? container : { ...container, hidden };
}

export function createPcbLayerStack(
  children: Partial<Record<PcbLayerRole, PcbLayerContainer['children']>> = {},
): PcbLayerStack {
  return [
    createPcbLayerContainer('copper', children.copper ?? []),
    createPcbLayerContainer('solder-mask', children['solder-mask'] ?? []),
    createPcbLayerContainer('silkscreen', children.silkscreen ?? []),
  ];
}
