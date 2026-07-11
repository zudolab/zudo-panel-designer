// Actual product widths from the Takazudo Modular blank-panel spec tables —
// real panels are undersized vs the nominal HP*5.08mm for mounting clearance.
export const PANEL_HEIGHT_MM = 128.5; // 3U Eurorack panel height

export interface PanelSize {
  hp: number;
  widthMm: number;
}

export const PANEL_SIZES: PanelSize[] = [
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
];

export function panelSizeByHp(hp: number): PanelSize {
  const found = PANEL_SIZES.find((s) => s.hp === hp);
  if (!found) throw new Error(`unknown panel size: ${hp}HP`);
  return found;
}
