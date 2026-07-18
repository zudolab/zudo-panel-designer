// Actual product widths from the Takazudo Modular blank-panel spec tables —
// real panels are undersized vs the nominal HP*5.08mm for mounting clearance.
export const PANEL_HEIGHT_MM = 128.5; // 3U Eurorack panel height

export interface PanelSize {
  hp: number;
  widthMm: number;
}

export const PANEL_SIZES: readonly PanelSize[] = [
  { hp: 1, widthMm: 5.0 },
  { hp: 2, widthMm: 9.8 },
  { hp: 3, widthMm: 14.9 },
  { hp: 4, widthMm: 20.0 },
  { hp: 5, widthMm: 25.0 },
  { hp: 6, widthMm: 30.0 },
  { hp: 8, widthMm: 40.3 },
  { hp: 10, widthMm: 50.5 },
  { hp: 12, widthMm: 60.6 },
  { hp: 14, widthMm: 70.8 },
  { hp: 16, widthMm: 80.9 },
  { hp: 20, widthMm: 101.3 },
] as const;

// Imported documents are allowed to use unlisted in-range HP values, but the
// largest real product size is the safe upper bound for derived geometry.
export const MAX_PANEL_HP = Math.max(...PANEL_SIZES.map((size) => size.hp));

// Nominal Eurorack module pitch. Used as a fallback for HP values that have
// no entry in the spec table above (no real product measurement exists for
// them). This is wider than a real spec width would be — the table values
// are undersized on purpose for mounting clearance — so treat the fallback
// as an approximation, not an order-ready dimension.
const NOMINAL_HP_PITCH_MM = 5.08;

export function panelWidthMm(hp: number): number {
  const found = PANEL_SIZES.find((s) => s.hp === hp);
  if (found) return found.widthMm;
  return hp * NOMINAL_HP_PITCH_MM;
}
