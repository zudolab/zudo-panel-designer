import {
  createDefaultDoc,
  DEFAULT_PANEL_FORMAT,
  DEFAULT_PANEL_HP,
  DEFAULT_PCB_MATERIAL,
} from './default-doc';
import { isGroupNode, MAX_GROUP_DEPTH, normalizeLayerNodeMaterial } from './layer-nodes';
import {
  createPcbLayerContainer,
  PALETTE,
  PCB_LAYER_CONTAINER_IDS,
  PCB_LAYER_ROLES,
  pcbLayerRoleForColor,
} from './palette';
import { panelHeightMm, type PanelFormat } from './panel-templates';
import { MAX_PANEL_HP, panelWidthMm } from './panel-sizes';
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
  PcbLayerSide,
  PcbLayerStack,
  PcbMaterial,
  ShapeLayer,
  TextLayer,
} from './types';

// v6 adds material, panel format, and the back-side layer stack — and is the
// ONLY version this build reads. Pre-v6 support was deleted outright, not
// migrated (epic #226 decision: no users yet, compat cut freely).
export const PANEL_CONFIG_VERSION = 6;

export interface PanelConfig {
  version: 6;
  app: 'zpd';
  panel: { hp: number; format: PanelFormat; widthMm: number; heightMm: number };
  material: PcbMaterial;
  palette: string[];
  layers: PcbLayerStack;
  backLayers: PcbLayerStack;
  guides: Guide[];
}

export function serializePanelConfig(doc: DocState): PanelConfig {
  return {
    version: PANEL_CONFIG_VERSION,
    app: 'zpd',
    panel: {
      hp: doc.panelHp,
      format: doc.format,
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: panelHeightMm(doc.format),
    },
    material: doc.material,
    palette: PALETTE.map((entry) => entry.name),
    layers: doc.layers,
    backLayers: doc.backLayers,
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

function parseFormat(value: unknown): PanelFormat {
  return value === '1U' || value === '3U' ? value : DEFAULT_PANEL_FORMAT;
}

function parseMaterial(value: unknown): PcbMaterial {
  return value === 'fr4' || value === 'alumi' ? value : DEFAULT_PCB_MATERIAL;
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
  private readonly used: Set<string>;
  private readonly remainingOriginals = new Map<string, number>();

  // The default reservation is ALL SIX structural container ids (front +
  // back): one shared allocator instance covers a whole document, so ordinary
  // ids can never collide with either stack's containers — or, when seeded
  // with both stacks' original ids, with ordinary nodes on the other side.
  constructor(
    originalIds: readonly string[],
    reservedIds: readonly string[] = PCB_LAYER_CONTAINER_IDS,
  ) {
    this.used = new Set(reservedIds);
    for (const id of originalIds) {
      this.remainingOriginals.set(id, (this.remainingOriginals.get(id) ?? 0) + 1);
    }
  }

  claimOriginal(wanted: string): string {
    const remaining = (this.remainingOriginals.get(wanted) ?? 1) - 1;
    if (remaining > 0) this.remainingOriginals.set(wanted, remaining);
    else this.remainingOriginals.delete(wanted);
    if (!this.used.has(wanted)) {
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

// Recovery routing for an ordinary node found OUTSIDE a valid role container
// (an illegal top-level root, or a child of an unknown/malformed wrapper): the
// whole node lands in ONE container — its first painted role, copper when
// nothing paints — with materials then forced by membership. Deliberately no
// per-color splitting: that was the v1–v4 migration partitioner, deleted with
// the pre-v6 compat cut.
function recoveryRole(node: LayerNode): PcbLayerRole {
  return firstPaintedRole(node) ?? 'copper';
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
  const parsed = value
    .map((entry, index) => parseGuide(entry, index))
    .filter((guide): guide is Guide => guide !== null);
  const ids = new DeterministicIds(
    parsed.map((guide) => guide.id),
    [],
  );
  return parsed.map((guide) => ({ ...guide, id: ids.claimOriginal(guide.id) }));
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

// Field-level recovery for ONE side's raw stack. The caller owns the shared
// DeterministicIds instance — both sides claim from the SAME allocator, so
// ordinary ids stay unique across the whole document and can never take any
// of the six structural container ids.
function parseStack(
  side: PcbLayerSide,
  rawLayers: unknown[],
  panel: PanelDimsMm,
  ids: DeterministicIds,
): PcbLayerStack {
  const buckets: Record<PcbLayerRole, LayerNode[]> = {
    copper: [],
    'solder-mask': [],
    silkscreen: [],
  };
  const hiddenByRole: Partial<Record<PcbLayerRole, boolean>> = {};

  for (const raw of rawLayers) {
    if (!isPlainObject(raw)) continue;
    const ordinary = parseLayerNode(raw, panel, 0);
    if (ordinary) {
      const role = recoveryRole(ordinary);
      buckets[role].push(forceNodeMaterial(ordinary, role, ids));
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
      // rerouted by paint rather than discarded.
      for (const childRaw of childrenRaw) {
        const child = parseLayerNode(childRaw, panel, 0);
        if (child) {
          const role = recoveryRole(child);
          buckets[role].push(forceNodeMaterial(child, role, ids));
        }
      }
    }
  }

  return PCB_LAYER_ROLES.map((role) =>
    createPcbLayerContainer(side, role, buckets[role], hiddenByRole[role]),
  ) as PcbLayerStack;
}

export function parseLayerNodeFragment(input: unknown, hp = DEFAULT_PANEL_HP): LayerNode[] {
  if (!Array.isArray(input)) return [];
  const sanitizedHp = parseHp(hp);
  // Fragments carry no format context; the default format's height only
  // seeds fallback pattern geometry, so the approximation is harmless.
  const panel = { widthMm: panelWidthMm(sanitizedHp), heightMm: panelHeightMm(DEFAULT_PANEL_FORMAT) };
  const parsed = input
    .map((entry) => parseLayerNode(entry, panel, 0))
    .filter((node): node is LayerNode => node !== null);
  const originalIds: string[] = [];
  for (const node of parsed) collectOriginalIds(node, originalIds);
  const ids = new DeterministicIds(originalIds);
  return parsed.map((node) => assignOrdinaryIds(node, ids));
}

// The clipboard envelope's material-tagged ordinary root (see the app's
// use-clipboard module — core only defines the shared shape).
export interface MaterialLayerNode {
  material: PcbLayerRole;
  node: LayerNode;
}

// Never throws. Anything that is not a v6 payload — a non-object, a pre-v6
// document, a future version — becomes a canonical default document (the
// compat cut: pre-v6 is unusable, never half-parsed). Within a v6 payload,
// malformed fields are recovered independently.
export function parsePanelConfig(input: unknown): DocState {
  if (!isPlainObject(input) || input.version !== PANEL_CONFIG_VERSION) return createDefaultDoc();
  const panelValue = isPlainObject(input.panel) ? input.panel : undefined;
  const hp = parseHp(input.hp ?? panelValue?.hp);
  const format = parseFormat(panelValue?.format);
  const panel = { widthMm: panelWidthMm(hp), heightMm: panelHeightMm(format) };
  const rawLayers = Array.isArray(input.layers) ? input.layers : [];
  const rawBackLayers = Array.isArray(input.backLayers) ? input.backLayers : [];

  // ONE allocator for the whole document: seeded with the original ids of
  // both stacks (front first), reserving all six structural ids, then handed
  // to both parseStack calls in that same order — so repeated parses stay
  // byte-identical and a duplicate id across sides de-duplicates exactly like
  // a duplicate within one side.
  const originalIds: string[] = [];
  for (const raw of [rawLayers, rawBackLayers]) {
    for (const root of recoverableOrdinaryRoots(raw, panel)) {
      collectOriginalIds(root, originalIds);
    }
  }
  const ids = new DeterministicIds(originalIds);

  return {
    panelHp: hp,
    format,
    material: parseMaterial(input.material),
    layers: parseStack('front', rawLayers, panel, ids),
    backLayers: parseStack('back', rawBackLayers, panel, ids),
    guides: parseGuides(input.guides),
  };
}

export type TryParsePanelConfigResult = { ok: true; doc: DocState } | { ok: false; reason: string };

export function tryParsePanelConfig(input: unknown): TryParsePanelConfigResult {
  if (!isPlainObject(input)) return { ok: false, reason: 'not an object' };
  if (input.app !== 'zpd') return { ok: false, reason: 'not a zpd panel config (app mismatch)' };
  if (input.version !== PANEL_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `unsupported or missing version (this build reads only v${PANEL_CONFIG_VERSION})`,
    };
  }
  if (!Array.isArray(input.layers)) return { ok: false, reason: 'missing layers array' };
  return { ok: true, doc: parsePanelConfig(input) };
}
