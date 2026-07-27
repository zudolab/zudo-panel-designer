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
  PanelSide,
  PathLayer,
  PathPoint,
  PatternLayer,
  PcbLayerContainer,
  PcbLayerContainerId,
  PcbLayerRole,
  PcbLayerSide,
  PcbLayerStack,
  PcbMaterial,
  ShapeLayer,
  TextLayer,
} from './types';
export { mintId } from './types';

export { stackForSide, withStackForSide } from './panel-side';

export type { PcbLayerSlices } from './layer-nodes';
export {
  flattenLayerNodes,
  isGroupNode,
  MAX_GROUP_DEPTH,
  normalizeLayerMaterial,
  normalizeLayerNodeMaterial,
  projectPcbLayerSlices,
  projectPcbLayerStack,
  walkLayerNodes,
  walkPcbLayerNodes,
} from './layer-nodes';

export type { PaletteEntry, PcbLayerDefinition, PcbSubstrate } from './palette';
export {
  createPcbLayerContainer,
  createPcbLayerStack,
  PALETTE,
  paletteEntry,
  PCB_LAYER_CONTAINER_IDS,
  PCB_LAYER_DEFINITIONS,
  PCB_LAYER_ROLES,
  PCB_LAYER_SIDES,
  PCB_SUBSTRATE,
  PCB_SUBSTRATE_ALUMI,
  pcbLayerContainerId,
  pcbLayerDefinition,
  pcbLayerRoleForColor,
  substrateForMaterial,
} from './palette';

export type { PanelSize } from './panel-sizes';
export { MAX_PANEL_HP, PANEL_SIZES, PANEL_THICKNESS_MM, panelWidthMm } from './panel-sizes';

export type { PanelFormat, PanelHole, PanelTemplateProvenance } from './panel-templates';
export {
  PANEL_FORMAT_HEIGHTS,
  panelHeightMm,
  panelHoles,
  panelTemplateProvenance,
  supportedHps,
} from './panel-templates';

export type { MaterialLayerNode, PanelConfig, TryParsePanelConfigResult } from './serialize';
export {
  PANEL_CONFIG_VERSION,
  parseLayerNodeFragment,
  parsePanelConfig,
  serializePanelConfig,
  tryParsePanelConfig,
} from './serialize';

export {
  createDefaultDoc,
  DEFAULT_PANEL_FORMAT,
  DEFAULT_PANEL_HP,
  DEFAULT_PCB_MATERIAL,
} from './default-doc';

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
