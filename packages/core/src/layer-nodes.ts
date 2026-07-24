// The recursive layer tree: GroupNode wraps LayerNode children, leaves stay
// Layer as before. This module owns the two structural primitives every
// consumer needs at the flatten boundary — walk (read) and flatten
// (project to the flat Layer[] the rest of the app already understands).
import { pcbLayerDefinition } from './palette';
import type {
  GroupNode,
  Layer,
  LayerNode,
  PcbLayerContainer,
  PcbLayerRole,
  PcbLayerStack,
} from './types';

// Root nodes are depth 0. The cap is a stack-overflow / degenerate-JSON
// defense (see serialize.ts's depth-drop) and a plausible ceiling for what a
// human could build via the panel UI — cheap to relax later if needed.
export const MAX_GROUP_DEPTH = 8;

export function isGroupNode(node: LayerNode): node is GroupNode {
  return 'kind' in node && node.kind === 'group';
}

// DFS, left-to-right, matching flatten's z-order semantics.
export function walkLayerNodes(
  nodes: LayerNode[],
  visitor: (node: LayerNode, depth: number) => void,
  depth = 0,
): void {
  for (const node of nodes) {
    visitor(node, depth);
    if (isGroupNode(node)) walkLayerNodes(node.children, visitor, depth + 1);
  }
}

function flattenInner(nodes: LayerNode[], ancestorHidden: boolean): Layer[] {
  const out: Layer[] = [];
  for (const node of nodes) {
    const hidden = ancestorHidden || node.hidden === true;
    if (isGroupNode(node)) {
      out.push(...flattenInner(node.children, hidden));
    } else {
      // Set-only-if-true: never write `hidden: false` onto a leaf. If the
      // leaf is already hidden (or nothing folds in), return it unchanged —
      // this is what keeps the identity fast path below cheap.
      out.push(hidden && !node.hidden ? { ...node, hidden: true } : node);
    }
  }
  return out;
}

// Pure, non-mutating projection from the tree to the flat Layer[] every
// existing `switch (layer.type)` consumer expects. DFS left-to-right, so
// tree reading order IS the z-order (index 0 renders first; a group is a
// contiguous z-band). `hidden` folds down as OR, set-only-if-true.
//
// Identity fast path: a group-free input has no ancestor to fold `hidden`
// from, so every leaf is already exactly what flatten would produce — return
// the SAME array reference with the SAME leaf references. This makes a
// per-render flatten call free (=== equality) for legacy, group-free docs.
export function flattenLayerNodes(nodes: LayerNode[]): Layer[] {
  if (nodes.every((node) => !isGroupNode(node))) return nodes as Layer[];
  return flattenInner(nodes, false);
}

export function normalizeLayerMaterial<R extends PcbLayerRole>(layer: Layer, role: R): Layer {
  if (layer.type === 'image') return layer;
  const color = pcbLayerDefinition(role).color;
  if (layer.type === 'path') {
    const fill = layer.fill === null ? null : color;
    const stroke = layer.stroke === null ? null : color;
    return fill === layer.fill && stroke === layer.stroke ? layer : { ...layer, fill, stroke };
  }
  return layer.color === color ? layer : { ...layer, color };
}

export function normalizeLayerNodeMaterial(node: LayerNode, role: PcbLayerRole): LayerNode {
  if (!isGroupNode(node)) return normalizeLayerMaterial(node, role);
  let changed = false;
  const children = node.children.map((child) => {
    const normalized = normalizeLayerNodeMaterial(child, role);
    if (normalized !== child) changed = true;
    return normalized;
  });
  return changed ? { ...node, children } : node;
}

export function walkPcbLayerNodes(
  stack: PcbLayerStack,
  visitor: (
    node: LayerNode,
    role: PcbLayerRole,
    container: PcbLayerContainer,
    depth: number,
  ) => void,
): void {
  for (const container of stack) {
    walkLayerNodes(container.children, (node, depth) =>
      visitor(node, container.role, container, depth),
    );
  }
}

// Effective read projection used by every downstream renderer/manufacturing
// consumer. Membership is authoritative for paint and physical stack order;
// fixed/group hidden state folds into leaves. A WeakMap makes repeated reads
// of the same committed stack return the exact same array reference.
const projectionCache = new WeakMap<PcbLayerStack, Layer[]>();

export function projectPcbLayerStack(stack: PcbLayerStack): Layer[] {
  const cached = projectionCache.get(stack);
  if (cached) return cached;

  const projected: Layer[] = [];
  for (const container of stack) {
    for (const layer of flattenLayerNodes(container.children)) {
      const materialized = normalizeLayerMaterial(layer, container.role);
      projected.push(
        container.hidden === true && materialized.hidden !== true
          ? { ...materialized, hidden: true }
          : materialized,
      );
    }
  }
  projectionCache.set(stack, projected);
  return projected;
}

export interface PcbLayerSlices {
  flat: Layer[];
  copper: Layer[];
  solderMask: Layer[];
  silkscreen: Layer[];
  solderMaskHidden: boolean;
}

// Role-aware view over projectPcbLayerStack's flat array for renderers that
// need to composite per-role (inverted solder-mask punching, surface maps).
// Slices are derived by re-walking each container's own child count against
// the SAME flat array `projectPcbLayerStack` returns — never by re-deriving
// role from color, which is unreliable (image layers skip material
// normalization; hidden-folding overwrites nothing about color).
const slicesCache = new WeakMap<PcbLayerStack, PcbLayerSlices>();

export function projectPcbLayerSlices(stack: PcbLayerStack): PcbLayerSlices {
  const cached = slicesCache.get(stack);
  if (cached) return cached;

  const flat = projectPcbLayerStack(stack);
  const slicesByRole: Record<PcbLayerRole, Layer[]> = {
    copper: [],
    'solder-mask': [],
    silkscreen: [],
  };
  let offset = 0;
  let solderMaskHidden = false;
  for (const container of stack) {
    const count = flattenLayerNodes(container.children).length;
    slicesByRole[container.role] = flat.slice(offset, offset + count);
    if (container.role === 'solder-mask') solderMaskHidden = container.hidden === true;
    offset += count;
  }

  const slices: PcbLayerSlices = {
    flat,
    copper: slicesByRole.copper,
    solderMask: slicesByRole['solder-mask'],
    silkscreen: slicesByRole.silkscreen,
    solderMaskHidden,
  };
  slicesCache.set(stack, slices);
  return slices;
}
