// --- document model ---

export const ZPD_CORE_VERSION = '0.0.0';

export type {
  ColorIndex,
  DocState,
  ImageLayer,
  Layer,
  LayerBase,
  PathLayer,
  PathPoint,
  PatternLayer,
  ShapeLayer,
  TextLayer,
} from './types';
export { mintId } from './types';

export type { PaletteEntry } from './palette';
export { PALETTE, paletteEntry } from './palette';

export type { PanelSize } from './panel-sizes';
export { PANEL_HEIGHT_MM, PANEL_SIZES, panelWidthMm } from './panel-sizes';

export type { PanelConfig } from './serialize';
export { PANEL_CONFIG_VERSION, parsePanelConfig, serializePanelConfig } from './serialize';

export { createDefaultDoc, DEFAULT_PANEL_HP } from './default-doc';

// --- geometry/ops/history ---
