// --- document model ---

export const ZPD_CORE_VERSION = '0.0.0';

export type {
  ColorIndex,
  DocState,
  GroupNode,
  Guide,
  GuideOrientation,
  ImageLayer,
  Layer,
  LayerBase,
  LayerNode,
  PathLayer,
  PathPoint,
  PatternLayer,
  PcbLayerContainer,
  PcbLayerRole,
  PcbLayerStack,
  ShapeLayer,
  TextLayer,
} from './types';
export { mintId } from './types';

export {
  flattenLayerNodes,
  isGroupNode,
  MAX_GROUP_DEPTH,
  normalizeLayerMaterial,
  normalizeLayerNodeMaterial,
  projectPcbLayerStack,
  walkLayerNodes,
  walkPcbLayerNodes,
} from './layer-nodes';

export type { PaletteEntry, PcbLayerDefinition } from './palette';
export {
  createPcbLayerContainer,
  createPcbLayerStack,
  PALETTE,
  paletteEntry,
  PCB_LAYER_DEFINITIONS,
  PCB_LAYER_ROLES,
  pcbLayerDefinition,
  pcbLayerRoleForColor,
} from './palette';

export type { PanelSize } from './panel-sizes';
export {
  MAX_PANEL_HP,
  PANEL_HEIGHT_MM,
  PANEL_SIZES,
  PANEL_THICKNESS_MM,
  panelWidthMm,
} from './panel-sizes';

export type { MaterialLayerNode, PanelConfig, TryParsePanelConfigResult } from './serialize';
export {
  PANEL_CONFIG_VERSION,
  parseLayerNodeFragment,
  parseLegacyLayerFragment,
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
export * from './rotate';
export * from './snap';
export * from './layer-ops';
export * from './clone';
export * from './group-ops';
export * from './align';
export * from './history';
