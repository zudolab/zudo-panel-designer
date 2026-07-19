// --- document model ---

export const ZPD_CORE_VERSION = '0.0.0';

export type {
  ColorIndex,
  DocState,
  Guide,
  GuideOrientation,
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
export {
  MAX_PANEL_HP,
  PANEL_HEIGHT_MM,
  PANEL_SIZES,
  PANEL_THICKNESS_MM,
  panelWidthMm,
} from './panel-sizes';

export type { PanelConfig, TryParsePanelConfigResult } from './serialize';
export {
  PANEL_CONFIG_VERSION,
  parsePanelConfig,
  serializePanelConfig,
  tryParsePanelConfig,
} from './serialize';

export { createDefaultDoc, DEFAULT_PANEL_HP } from './default-doc';

export type { PatternCoverGeometry } from './pattern-geometry';
export { MAX_PATTERN_SIZE_MM, patternCoverGeometry } from './pattern-geometry';

// --- geometry/ops/history ---

export * from './bbox';
export * from './path-geometry';
export * from './hit-test';
export * from './resize';
export * from './scale';
export * from './snap';
export * from './layer-ops';
export * from './clone';
export * from './align';
export * from './history';
