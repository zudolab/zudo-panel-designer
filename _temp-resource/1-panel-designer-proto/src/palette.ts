// Fixed 3-color palette — the physical PCB panel finish decides these:
// black = soldermask, gold = exposed ENIG-plated copper, white = silkscreen.
export interface PaletteEntry {
  name: string;
  hex: string;
  note: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: 'black', hex: '#151515', note: 'soldermask' },
  { name: 'gold', hex: '#d4af37', note: 'exposed copper (ENIG)' },
  { name: 'white', hex: '#f2f0e9', note: 'silkscreen' },
] as const;
