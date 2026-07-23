import { createDefaultDoc, DEFAULT_PANEL_HP } from './default-doc';
import { isGroupNode, MAX_GROUP_DEPTH, normalizeLayerNodeMaterial } from './layer-nodes';
import {
  createPcbLayerContainer,
  PALETTE,
  PCB_LAYER_DEFINITIONS,
  PCB_LAYER_ROLES,
  pcbLayerRoleForColor,
} from './palette';
import { MAX_PANEL_HP, PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { MAX_PATTERN_SIZE_MM, patternCoverGeometry } from './pattern-geometry';
import type {
  ColorIndex,
  DocState,
  GroupNode,
  Guide,
  ImageLayer,
  Layer,
  LayerNode,
  PathLayer,
  PathPoint,
  PatternLayer,
  PcbLayerRole,
  PcbLayerStack,
  ShapeLayer,
  TextLayer,
} from './types';

// v5 replaces the free ordinary root with the canonical fixed PCB stack.
export const PANEL_CONFIG_VERSION = 5;

export interface PanelConfig {
  version: 5;
  app: 'zpd';
  panel: { hp: number; widthMm: number; heightMm: number };
  palette: string[];
  layers: PcbLayerStack;
  guides: Guide[];
}

export function serializePanelConfig(doc: DocState): PanelConfig {
  return {
    version: PANEL_CONFIG_VERSION,
    app: 'zpd',
    panel: {
      hp: doc.panelHp,
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: PANEL_HEIGHT_MM,
    },
    palette: PALETTE.map((entry) => entry.name),
    layers: doc.layers,
    guides: doc.guides,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function colorIndex(value: unknown): ColorIndex {
  return value === 0 || value === 1 || value === 2 ? value : 0;
}

function handle(value: unknown): { x: number; y: number } | undefined {
  if (!isPlainObject(value)) return undefined;
  const x = optionalNum(value.x);
  const y = optionalNum(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function point(value: unknown): PathPoint | null {
  if (!isPlainObject(value)) return null;
  const parsed: PathPoint = { x: num(value.x, 0), y: num(value.y, 0) };
  const hin = handle(value.hin);
  if (hin) parsed.hin = hin;
  const hout = handle(value.hout);
  if (hout) parsed.hout = hout;
  return parsed;
}

function subpath(value: unknown): PathPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map(point).filter((entry): entry is PathPoint => entry !== null);
}

function parseParams(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) return {};
  const params: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) params[key] = entry;
  }
  return params;
}

interface ParsedBase {
  id: string;
  name: string;
  hidden?: boolean;
}

interface PanelDimsMm {
  widthMm: number;
  heightMm: number;
}

function parseBase(value: Record<string, unknown>, fallbackId: string): ParsedBase {
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : fallbackId;
  const name = str(value.name, '');
  const hidden = optionalBool(value.hidden);
  return hidden === undefined ? { id, name } : { id, name, hidden };
}

function parseHp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_PANEL_HP)
    : DEFAULT_PANEL_HP;
}

function parsePatternGeometry(
  value: Record<string, unknown>,
  panel: PanelDimsMm,
): { x: number; y: number; size: number } {
  const cover = patternCoverGeometry(panel);
  const rawSize = optionalNum(value.size);
  const size =
    rawSize !== undefined && rawSize > 0 ? Math.min(rawSize, MAX_PATTERN_SIZE_MM) : cover.size;
  return {
    x: optionalNum(value.x) ?? (panel.widthMm - size) / 2,
    y: optionalNum(value.y) ?? (panel.heightMm - size) / 2,
    size,
  };
}

function parseLayer(value: unknown, panel: PanelDimsMm): Layer | null {
  if (!isPlainObject(value)) return null;
  const fallback = typeof value.type === 'string' ? value.type : 'layer';
  const base = parseBase(value, fallback);
  switch (value.type) {
    case 'shape': {
      const layer: ShapeLayer = {
        ...base,
        type: 'shape',
        shape: value.shape === 'ellipse' ? 'ellipse' : 'rect',
        x: num(value.x, 0),
        y: num(value.y, 0),
        width: num(value.width, 0),
        height: num(value.height, 0),
        color: colorIndex(value.color),
      };
      const rotation = optionalNum(value.rotation);
      return rotation === undefined ? layer : { ...layer, rotation };
    }
    case 'pattern':
      return {
        ...base,
        type: 'pattern',
        patternType: str(value.patternType, 'unknown'),
        params: parseParams(value.params),
        color: colorIndex(value.color),
        ...parsePatternGeometry(value, panel),
      } satisfies PatternLayer;
    case 'path': {
      const extraSubpaths = Array.isArray(value.extraSubpaths)
        ? value.extraSubpaths.map(subpath)
        : undefined;
      const layer: PathLayer = {
        ...base,
        type: 'path',
        points: subpath(value.points),
        closed: value.closed === true,
        fill: value.fill === null ? null : colorIndex(value.fill),
        stroke: value.stroke === null ? null : colorIndex(value.stroke),
        strokeWidth: num(value.strokeWidth, 0),
      };
      return extraSubpaths === undefined ? layer : { ...layer, extraSubpaths };
    }
    case 'text': {
      const layer: TextLayer = {
        ...base,
        type: 'text',
        content: str(value.content, ''),
        fontFamily: str(value.fontFamily, ''),
        sizeMm: num(value.sizeMm, 0),
        x: num(value.x, 0),
        y: num(value.y, 0),
        color: colorIndex(value.color),
      };
      const rotation = optionalNum(value.rotation);
      return rotation === undefined ? layer : { ...layer, rotation };
    }
    case 'image': {
      const layer: ImageLayer = {
        ...base,
        type: 'image',
        src: str(value.src, ''),
        x: num(value.x, 0),
        y: num(value.y, 0),
        width: num(value.width, 0),
        height: num(value.height, 0),
      };
      const rotation = optionalNum(value.rotation);
      return rotation === undefined ? layer : { ...layer, rotation };
    }
    default:
      return null;
  }
}

function parseLayerNode(value: unknown, panel: PanelDimsMm, depth: number): LayerNode | null {
  if (!isPlainObject(value)) return null;
  if ('kind' in value) {
    if (value.kind !== 'group' || depth > MAX_GROUP_DEPTH) return null;
    const children = (Array.isArray(value.children) ? value.children : [])
      .map((child) => parseLayerNode(child, panel, depth + 1))
      .filter((child): child is LayerNode => child !== null);
    return {
      ...parseBase(value, 'group'),
      kind: 'group',
      children,
    } satisfies GroupNode;
  }
  return parseLayer(value, panel);
}

class DeterministicIds {
  private readonly used = new Set<string>(PCB_LAYER_DEFINITIONS.map((definition) => definition.id));
  private readonly remainingOriginals = new Map<string, number>();

  constructor(originalIds: readonly string[]) {
    for (const id of originalIds) {
      this.remainingOriginals.set(id, (this.remainingOriginals.get(id) ?? 0) + 1);
    }
  }

  claimOriginal(wanted: string): string {
    const remaining = (this.remainingOriginals.get(wanted) ?? 1) - 1;
    if (remaining > 0) this.remainingOriginals.set(wanted, remaining);
    else this.remainingOriginals.delete(wanted);
    return this.allocate(wanted, false);
  }

  claimGenerated(wanted: string): string {
    return this.allocate(wanted, true);
  }

  private allocate(wanted: string, protectOriginals: boolean): string {
    if (!this.used.has(wanted) && (!protectOriginals || !this.remainingOriginals.has(wanted))) {
      this.used.add(wanted);
      return wanted;
    }
    let suffix = 2;
    while (
      this.used.has(`${wanted}-${suffix}`) ||
      this.remainingOriginals.has(`${wanted}-${suffix}`)
    ) {
      suffix += 1;
    }
    const allocated = `${wanted}-${suffix}`;
    this.used.add(allocated);
    return allocated;
  }
}

type Partitions = Partial<Record<PcbLayerRole, LayerNode>>;

function partitionRoles(node: LayerNode, roles = new Set<PcbLayerRole>()): Set<PcbLayerRole> {
  if (isGroupNode(node)) {
    if (node.children.length === 0) roles.add('copper');
    for (const child of node.children) partitionRoles(child, roles);
  } else if (
    node.type === 'image' ||
    (node.type === 'path' && node.fill === null && node.stroke === null)
  ) {
    roles.add('copper');
  } else if (node.type === 'path') {
    if (node.fill !== null) roles.add(pcbLayerRoleForColor(node.fill));
    if (node.stroke !== null) roles.add(pcbLayerRoleForColor(node.stroke));
  } else {
    roles.add(pcbLayerRoleForColor(node.color));
  }
  return roles;
}

function firstPaintedRole(node: LayerNode): PcbLayerRole | null {
  if (isGroupNode(node)) {
    for (const child of node.children) {
      const role = firstPaintedRole(child);
      if (role) return role;
    }
    return null;
  }
  if (node.type === 'image') return null;
  if (node.type === 'path') {
    if (node.fill !== null) return pcbLayerRoleForColor(node.fill);
    if (node.stroke !== null) return pcbLayerRoleForColor(node.stroke);
    return null;
  }
  return pcbLayerRoleForColor(node.color);
}

function partitionLegacyNode(node: LayerNode, ids: DeterministicIds): Partitions {
  if (!isGroupNode(node)) {
    if (
      node.type === 'image' ||
      (node.type === 'path' && node.fill === null && node.stroke === null)
    ) {
      return { copper: { ...node, id: ids.claimOriginal(node.id) } };
    }
    if (node.type !== 'path') {
      const role = pcbLayerRoleForColor(node.color);
      return { [role]: { ...node, id: ids.claimOriginal(node.id) } };
    }

    const fillRole = node.fill === null ? null : pcbLayerRoleForColor(node.fill);
    const strokeRole = node.stroke === null ? null : pcbLayerRoleForColor(node.stroke);
    if (fillRole === strokeRole) {
      const role = fillRole ?? 'copper';
      return { [role]: { ...node, id: ids.claimOriginal(node.id) } };
    }
    const result: Partitions = {};
    if (fillRole) {
      result[fillRole] = {
        ...node,
        id: ids.claimOriginal(node.id),
        stroke: null,
      };
    }
    if (strokeRole) {
      result[strokeRole] = {
        ...node,
        id: fillRole ? ids.claimGenerated(`${node.id}-${strokeRole}`) : ids.claimOriginal(node.id),
        fill: null,
      };
    }
    return result;
  }

  const roles = partitionRoles(node);
  const keeper = firstPaintedRole(node) ?? 'copper';
  const groupIds = new Map<PcbLayerRole, string>();
  for (const role of [keeper, ...PCB_LAYER_ROLES.filter((entry) => entry !== keeper)]) {
    if (roles.has(role)) {
      groupIds.set(
        role,
        role === keeper ? ids.claimOriginal(node.id) : ids.claimGenerated(`${node.id}-${role}`),
      );
    }
  }

  const childrenByRole = new Map<PcbLayerRole, LayerNode[]>();
  for (const child of node.children) {
    const partitions = partitionLegacyNode(child, ids);
    for (const role of PCB_LAYER_ROLES) {
      const partition = partitions[role];
      if (!partition) continue;
      const children = childrenByRole.get(role) ?? [];
      children.push(partition);
      childrenByRole.set(role, children);
    }
  }

  const result: Partitions = {};
  for (const role of roles) {
    const children = childrenByRole.get(role) ?? [];
    // A role discovered from paint always has content. Colorless-only and
    // empty groups intentionally retain their shell in Copper.
    if (children.length === 0 && !(role === 'copper' && roles.size === 1)) continue;
    result[role] = { ...node, id: groupIds.get(role)!, children };
  }
  return result;
}

function forceNodeMaterial(node: LayerNode, role: PcbLayerRole, ids: DeterministicIds): LayerNode {
  const id = ids.claimOriginal(node.id);
  if (!isGroupNode(node)) {
    return normalizeLayerNodeMaterial({ ...node, id }, role);
  }
  return {
    ...node,
    id,
    children: node.children.map((child) => forceNodeMaterial(child, role, ids)),
  };
}

function assignOrdinaryIds(node: LayerNode, ids: DeterministicIds): LayerNode {
  const id = ids.claimOriginal(node.id);
  return isGroupNode(node)
    ? { ...node, id, children: node.children.map((child) => assignOrdinaryIds(child, ids)) }
    : { ...node, id };
}

function parseGuide(value: unknown, index: number): Guide | null {
  if (!isPlainObject(value)) return null;
  const orientation =
    value.orientation === 'horizontal' || value.orientation === 'vertical'
      ? value.orientation
      : null;
  const position = optionalNum(value.position);
  if (!orientation || position === undefined) return null;
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : `guide-${index + 1}`;
  const hidden = optionalBool(value.hidden);
  const guide: Guide = { id, orientation, position };
  return hidden === undefined ? guide : { ...guide, hidden };
}

function parseGuides(value: unknown): Guide[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => parseGuide(entry, index))
    .filter((guide): guide is Guide => guide !== null);
}

function appendPartitions(
  buckets: Record<PcbLayerRole, LayerNode[]>,
  partitions: Partitions,
): void {
  for (const role of PCB_LAYER_ROLES) {
    const node = partitions[role];
    if (node) buckets[role].push(node);
  }
}

function collectOriginalIds(node: LayerNode, output: string[]): void {
  output.push(node.id);
  if (isGroupNode(node)) {
    for (const child of node.children) collectOriginalIds(child, output);
  }
}

function recoverableOrdinaryRoots(rawLayers: unknown[], panel: PanelDimsMm): LayerNode[] {
  const roots: LayerNode[] = [];
  for (const raw of rawLayers) {
    const ordinary = parseLayerNode(raw, panel, 0);
    if (ordinary) {
      roots.push(ordinary);
      continue;
    }
    if (!isPlainObject(raw) || !Array.isArray(raw.children)) continue;
    for (const childRaw of raw.children) {
      const child = parseLayerNode(childRaw, panel, 0);
      if (child) roots.push(child);
    }
  }
  return roots;
}

function parseStack(rawLayers: unknown[], version: number, panel: PanelDimsMm): PcbLayerStack {
  const originalIds: string[] = [];
  for (const root of recoverableOrdinaryRoots(rawLayers, panel)) {
    collectOriginalIds(root, originalIds);
  }
  const ids = new DeterministicIds(originalIds);
  const buckets: Record<PcbLayerRole, LayerNode[]> = {
    copper: [],
    'solder-mask': [],
    silkscreen: [],
  };
  const hiddenByRole: Partial<Record<PcbLayerRole, boolean>> = {};

  if (version < PANEL_CONFIG_VERSION) {
    for (const raw of rawLayers) {
      const node = parseLayerNode(raw, panel, 0);
      if (node) appendPartitions(buckets, partitionLegacyNode(node, ids));
    }
  } else {
    for (const raw of rawLayers) {
      if (!isPlainObject(raw)) continue;
      const ordinary = parseLayerNode(raw, panel, 0);
      if (ordinary) {
        appendPartitions(buckets, partitionLegacyNode(ordinary, ids));
        continue;
      }

      const childrenRaw = Array.isArray(raw.children) ? raw.children : null;
      if (!childrenRaw) continue;
      const validRole = PCB_LAYER_ROLES.includes(raw.role as PcbLayerRole)
        ? (raw.role as PcbLayerRole)
        : null;
      if (validRole) {
        if (hiddenByRole[validRole] === undefined) {
          hiddenByRole[validRole] = optionalBool(raw.hidden);
        } else if (raw.hidden === true) {
          hiddenByRole[validRole] = true;
        }
        for (const childRaw of childrenRaw) {
          const child = parseLayerNode(childRaw, panel, 0);
          if (child) buckets[validRole].push(forceNodeMaterial(child, validRole, ids));
        }
      } else {
        // Unknown or malformed wrapper: its recoverable ordinary children are
        // legacy-partitioned rather than discarded.
        for (const childRaw of childrenRaw) {
          const child = parseLayerNode(childRaw, panel, 0);
          if (child) appendPartitions(buckets, partitionLegacyNode(child, ids));
        }
      }
    }
  }

  return PCB_LAYER_ROLES.map((role) =>
    createPcbLayerContainer(role, buckets[role], hiddenByRole[role]),
  ) as PcbLayerStack;
}

export function parseLayerNodeFragment(input: unknown, hp = DEFAULT_PANEL_HP): LayerNode[] {
  if (!Array.isArray(input)) return [];
  const sanitizedHp = parseHp(hp);
  const panel = { widthMm: panelWidthMm(sanitizedHp), heightMm: PANEL_HEIGHT_MM };
  const parsed = input
    .map((entry) => parseLayerNode(entry, panel, 0))
    .filter((node): node is LayerNode => node !== null);
  const originalIds: string[] = [];
  for (const node of parsed) collectOriginalIds(node, originalIds);
  const ids = new DeterministicIds(originalIds);
  return parsed.map((node) => assignOrdinaryIds(node, ids));
}

export interface MaterialLayerNode {
  material: PcbLayerRole;
  node: LayerNode;
}

export function parseLegacyLayerFragment(
  input: unknown,
  hp = DEFAULT_PANEL_HP,
): MaterialLayerNode[] {
  if (!Array.isArray(input)) return [];
  const sanitizedHp = parseHp(hp);
  const panel = { widthMm: panelWidthMm(sanitizedHp), heightMm: PANEL_HEIGHT_MM };
  const parsed = input
    .map((entry) => parseLayerNode(entry, panel, 0))
    .filter((node): node is LayerNode => node !== null);
  const originalIds: string[] = [];
  for (const node of parsed) collectOriginalIds(node, originalIds);
  const ids = new DeterministicIds(originalIds);
  const output: MaterialLayerNode[] = [];
  for (const node of parsed) {
    const partitions = partitionLegacyNode(node, ids);
    for (const material of PCB_LAYER_ROLES) {
      const partition = partitions[material];
      if (partition) output.push({ material, node: partition });
    }
  }
  return output;
}

// Never throws. Invalid non-object input becomes a canonical default document;
// malformed document fields are recovered independently.
export function parsePanelConfig(input: unknown): DocState {
  if (!isPlainObject(input)) return createDefaultDoc();
  const panelValue = isPlainObject(input.panel) ? input.panel : undefined;
  const hp = parseHp(input.hp ?? panelValue?.hp);
  const panel = { widthMm: panelWidthMm(hp), heightMm: PANEL_HEIGHT_MM };
  const version =
    typeof input.version === 'number' && Number.isInteger(input.version) ? input.version : 4;
  const rawLayers = Array.isArray(input.layers) ? input.layers : [];
  return {
    panelHp: hp,
    layers: parseStack(rawLayers, version, panel),
    guides: parseGuides(input.guides),
  };
}

export type TryParsePanelConfigResult = { ok: true; doc: DocState } | { ok: false; reason: string };

const MIN_PANEL_CONFIG_VERSION = 1;

export function tryParsePanelConfig(input: unknown): TryParsePanelConfigResult {
  if (!isPlainObject(input)) return { ok: false, reason: 'not an object' };
  if (input.app !== 'zpd') return { ok: false, reason: 'not a zpd panel config (app mismatch)' };
  const version = input.version;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < MIN_PANEL_CONFIG_VERSION ||
    version > PANEL_CONFIG_VERSION
  ) {
    return { ok: false, reason: 'unsupported or missing version' };
  }
  if (!Array.isArray(input.layers)) return { ok: false, reason: 'missing layers array' };
  return { ok: true, doc: parsePanelConfig(input) };
}
