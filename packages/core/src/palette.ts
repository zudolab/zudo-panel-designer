// Fixed 3-color palette — the physical PCB panel finish decides these:
// black routes to the solder-mask container, where it OPENS the mask
// (reveals copper, or bare substrate, beneath) rather than painting mask on;
// gold = exposed copper with the product's HASL finish; white = silkscreen.
// The hex values are display approximations for the editor UI; the color
// names are the contract other packages (patterns, serialize, app) rely on.
import type {
  ColorIndex,
  PcbLayerContainer,
  PcbLayerContainerId,
  PcbLayerRole,
  PcbLayerSide,
  PcbLayerStack,
  PcbMaterial,
} from './types';

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
  // The FRONT container id (definitions are per-role, side-agnostic
  // otherwise) — derive any side's id via pcbLayerContainerId(side, role).
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

export const PCB_LAYER_SIDES: readonly ['front', 'back'] = ['front', 'back'];

export function pcbLayerContainerId<R extends PcbLayerRole>(
  side: PcbLayerSide,
  role: R,
): PcbLayerContainerId<R> {
  return side === 'back' ? `pcb-layer-back-${role}` : `pcb-layer-${role}`;
}

// All SIX structural container ids (3 front + 3 back). The single reserved-id
// authority for deterministic-id allocation: parsing/de-duplication seeds from
// this list so an ordinary node can never take a structural id on either side.
export const PCB_LAYER_CONTAINER_IDS: readonly PcbLayerContainerId[] = PCB_LAYER_SIDES.flatMap(
  (side) => PCB_LAYER_ROLES.map((role) => pcbLayerContainerId(side, role)),
);

export function pcbLayerDefinition<R extends PcbLayerRole>(role: R): PcbLayerDefinition<R> {
  return PCB_LAYER_DEFINITIONS.find(
    (definition) => definition.role === role,
  ) as PcbLayerDefinition<R>;
}

export function pcbLayerRoleForColor(color: ColorIndex): PcbLayerRole {
  return color === 1 ? 'copper' : color === 2 ? 'silkscreen' : 'solder-mask';
}

export interface PcbSubstrate {
  hex: string;
  note: string;
}

// Bare substrate visible through a solder-mask opening with no copper
// beneath it. Not a PaletteEntry: it has no ColorIndex/palette slot — it
// never appears as a drawable layer color, only as a renderer fill value.
export const PCB_SUBSTRATE: PcbSubstrate = {
  hex: '#a8946a',
  note: 'bare FR4 laminate under mask openings',
};

// Cool neutral gray chosen to read as brushed aluminum next to the warm FR4
// tan above; the 3D preview owns the actual shiny metal material.
export const PCB_SUBSTRATE_ALUMI: PcbSubstrate = {
  hex: '#b3b6ba',
  note: 'bare aluminum under mask openings',
};

export function substrateForMaterial(material: PcbMaterial): PcbSubstrate {
  return material === 'alumi' ? PCB_SUBSTRATE_ALUMI : PCB_SUBSTRATE;
}

type PcbStackChildren = Partial<Record<PcbLayerRole, PcbLayerContainer['children']>>;

function isPcbLayerSide(value: unknown): value is PcbLayerSide {
  return value === 'front' || value === 'back';
}

function buildPcbLayerContainer<R extends PcbLayerRole>(
  side: PcbLayerSide,
  role: R,
  children: PcbLayerContainer<R>['children'],
  hidden?: boolean,
): PcbLayerContainer<R> {
  const container: PcbLayerContainer<R> = {
    kind: 'pcb-layer',
    id: pcbLayerContainerId(side, role),
    role,
    children,
  };
  return hidden === undefined ? container : { ...container, hidden };
}

// Canonical form is side-first; the side-less overload builds the FRONT
// container and exists so the pervasive pre-back-stack call sites (and the
// common front-only case) read unchanged. Side/role string sets are disjoint,
// so the first argument discriminates safely at runtime.
export function createPcbLayerContainer<R extends PcbLayerRole>(
  role: R,
  children?: PcbLayerContainer<R>['children'],
  hidden?: boolean,
): PcbLayerContainer<R>;
export function createPcbLayerContainer<R extends PcbLayerRole>(
  side: PcbLayerSide,
  role: R,
  children?: PcbLayerContainer<R>['children'],
  hidden?: boolean,
): PcbLayerContainer<R>;
export function createPcbLayerContainer<R extends PcbLayerRole>(
  sideOrRole: PcbLayerSide | R,
  roleOrChildren?: R | PcbLayerContainer<R>['children'],
  childrenOrHidden?: PcbLayerContainer<R>['children'] | boolean,
  maybeHidden?: boolean,
): PcbLayerContainer<R> {
  if (isPcbLayerSide(sideOrRole)) {
    return buildPcbLayerContainer(
      sideOrRole,
      roleOrChildren as R,
      (childrenOrHidden as PcbLayerContainer<R>['children'] | undefined) ?? [],
      maybeHidden,
    );
  }
  return buildPcbLayerContainer(
    'front',
    sideOrRole,
    (roleOrChildren as PcbLayerContainer<R>['children'] | undefined) ?? [],
    childrenOrHidden as boolean | undefined,
  );
}

// Same overload convention as createPcbLayerContainer: side-first is the
// canonical form, the side-less form builds the FRONT stack.
export function createPcbLayerStack(children?: PcbStackChildren): PcbLayerStack;
export function createPcbLayerStack(side: PcbLayerSide, children?: PcbStackChildren): PcbLayerStack;
export function createPcbLayerStack(
  sideOrChildren?: PcbLayerSide | PcbStackChildren,
  maybeChildren?: PcbStackChildren,
): PcbLayerStack {
  const side = isPcbLayerSide(sideOrChildren) ? sideOrChildren : 'front';
  const children = (isPcbLayerSide(sideOrChildren) ? maybeChildren : sideOrChildren) ?? {};
  return [
    buildPcbLayerContainer(side, 'copper', children.copper ?? []),
    buildPcbLayerContainer(side, 'solder-mask', children['solder-mask'] ?? []),
    buildPcbLayerContainer(side, 'silkscreen', children.silkscreen ?? []),
  ];
}
