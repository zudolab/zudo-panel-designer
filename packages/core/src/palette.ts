// Fixed 3-color palette — the physical PCB panel finish decides these:
// black = soldermask, gold = exposed ENIG-plated copper, white = silkscreen.
// The hex values are display approximations for the editor UI; the color
// names are the contract other packages (patterns, serialize, app) rely on.
import type { ColorIndex } from './types';

export interface PaletteEntry {
  index: ColorIndex;
  name: 'black' | 'gold' | 'white';
  hex: string;
  note: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { index: 0, name: 'black', hex: '#151515', note: 'soldermask' },
  { index: 1, name: 'gold', hex: '#d4af37', note: 'exposed copper (ENIG)' },
  { index: 2, name: 'white', hex: '#f2f0e9', note: 'silkscreen' },
] as const;

export function paletteEntry(index: ColorIndex): PaletteEntry {
  return PALETTE[index];
}
