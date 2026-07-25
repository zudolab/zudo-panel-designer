/**
 * Path Finder — op result → new layer tree (epic #204, sub #213).
 *
 * The op layer (#208) stops at `{ specs, target }`: geometry plus a
 * destination. This module is the other half — minting ids, taking over the
 * frontmost input's z-slot, consuming the inputs, and pruning what that
 * leaves behind. Pure and SYNCHRONOUS: stack in, stack out. The async
 * dispatch, the stale-input guard and the single history commit live in
 * `runner.ts`, so this transform stays testable without a clock or a store.
 *
 * ── Decisions this module owns (issue #213) ───────────────────────────────
 *
 * TREE SHAPE — a multi-piece result becomes ONE group node, not N flat
 * siblings. That is Illustrator's behaviour (Divide / Trim / Crop / Outline
 * all yield a <Group>), it keeps the pieces selectable and movable as the unit
 * the user just created, and it keeps the result one contiguous z-band. A
 * single-spec result is a lone leaf with no wrapper. `shouldGroupResult`
 * (dispatch.ts) is the predicate — the same one the op layer already
 * documents, not a second copy of the rule.
 *
 * ONE UNDO ENTRY — everything below is one stack→stack transform and
 * `runner.ts` hands the whole thing to `commit()` once. zpd's history stores
 * full-document snapshots (core/history.ts), so the new group, the consumed
 * inputs AND the pruned empty groups all revert together: the tree-SHAPE
 * change is inside the snapshot rather than layered on top of it. This is why
 * zpd does not need pgen's `flushSync`-inside-a-reducer ordering dance.
 *
 * EMPTY-GROUP CLEANUP — zpd DOES clean up, unlike pgen. A group is removed
 * when it (a) was an ancestor of a consumed input and (b) has no children
 * left afterwards; the sweep cascades, so a parent emptied only because its
 * own child group was pruned goes too. Groups that were ALREADY empty before
 * the op are deliberately left alone: they are not this op's doing, and
 * folding an unrelated cleanup into this undo entry would make one undo
 * restore something the user never touched here.
 *
 * MULTI-COLOUR ATTRIBUTION — the faces ops attribute each face to a different
 * input, so a cross-material result can carry several colours into one
 * container (the op layer reports that faithfully and left the collapse to
 * this module — see pathfinder/README.md). It is resolved by routing the
 * insertion through `replacePcbNodeWithNodes`, which normalizes every inserted
 * node to the destination container's material exactly like any other
 * insertion. What survives normalization is only the null/non-null
 * distinction: an unfilled spec stays unfilled and an unstroked spec stays
 * unstroked, so Outline's edges keep their single painted channel. Nothing
 * here pre-collapses the colours by hand — using the same core primitive
 * every other write uses is what makes a Path Finder result indistinguishable
 * from a hand-drawn layer in its container.
 */

import {
  deletePcbNodeById,
  findPcbNodeById,
  isGroupNode,
  mintId,
  replacePcbNodeWithNodes,
  type GroupNode,
  type LayerNode,
  type PathLayer,
  type PcbLayerStack,
} from '@zpd/core';
import type { KernelPathSpec } from '../geometry-kernel';
import { shouldGroupResult } from './dispatch';
import type { PathfinderOp, PathfinderOpResult } from './types';

/**
 * Illustrator panel labels, used here to name the container of a multi-piece
 * result (and by the panel sub-issue for its buttons).
 *
 * The ops keep their own private copies for the per-spec layer NAME — those
 * are a property of the geometry each op emits, this one names the group and
 * is the user-facing op label. `mutation.test.ts` pins the two against each
 * other through a real op so the pair cannot drift apart unnoticed.
 */
export const PATHFINDER_OP_LABELS: Record<PathfinderOp, string> = {
  unite: 'Unite',
  minusFront: 'Minus Front',
  intersect: 'Intersect',
  exclude: 'Exclude',
  minusBack: 'Minus Back',
  divide: 'Divide',
  trim: 'Trim',
  merge: 'Merge',
  crop: 'Crop',
  outline: 'Outline',
};

/**
 * One kernel spec → one document leaf. World mm on both sides, so the geometry
 * is copied across verbatim; the only things added are a fresh id and the
 * `path` discriminator. `extraSubpaths` is omitted rather than written empty,
 * matching how every other zpd writer treats that optional field.
 */
export function specToPathLayer(spec: KernelPathSpec): PathLayer {
  return {
    id: mintId('path'),
    type: 'path',
    name: spec.name,
    points: spec.points,
    ...(spec.extraSubpaths && spec.extraSubpaths.length > 0
      ? { extraSubpaths: spec.extraSubpaths }
      : {}),
    closed: spec.closed,
    fill: spec.fill,
    stroke: spec.stroke,
    strokeWidth: spec.strokeWidth,
  };
}

export interface PathfinderApplyResult {
  stack: PcbLayerStack;
  /** What the caller should select: the group when grouped, else every new leaf. */
  selectionIds: string[];
  /** Ids of the leaves created, in spec order — the group's children when grouped. */
  createdLeafIds: string[];
  /** The wrapper group's id; null for a single-piece result (or the depth fallback). */
  groupId: string | null;
  /** Groups removed because consuming the inputs emptied them. */
  prunedGroupIds: string[];
}

/** Every group id enclosing any of `ids`, read against the PRE-mutation stack. */
function ancestorGroupIds(stack: PcbLayerStack, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const found = findPcbNodeById(stack, id);
    if (!found) continue;
    // pathIds is root→target and only ever contains groups, so this is the
    // full ancestor chain with the target itself excluded.
    for (const groupId of found.pathIds) out.add(groupId);
  }
  return [...out];
}

/**
 * Drops every candidate group that has no children left, repeating until a
 * pass changes nothing — pruning an inner group can empty its parent, and the
 * parent is already a candidate (ancestor chains are collected whole).
 */
function pruneEmptyGroups(
  stack: PcbLayerStack,
  candidateIds: readonly string[],
): { stack: PcbLayerStack; prunedIds: string[] } {
  let next = stack;
  const prunedIds: string[] = [];
  const pruned = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of candidateIds) {
      if (pruned.has(id)) continue;
      const found = findPcbNodeById(next, id);
      if (!found || !isGroupNode(found.node) || found.node.children.length > 0) continue;
      next = deletePcbNodeById(next, id);
      pruned.add(id);
      prunedIds.push(id);
      changed = true;
    }
  }
  return { stack: next, prunedIds };
}

/**
 * Commit one op result into the layer tree.
 *
 * The result takes over the frontmost input's exact slot — same container,
 * same parent group, same sibling index — via `replacePcbNodeWithNodes`, which
 * is what makes the cross-material destination rule (#208) hold without this
 * module re-deriving it: `target.frontmostLeafId` already names the node whose
 * place the result inherits. The remaining inputs are then deleted wherever
 * they live, and any group they emptied is pruned.
 *
 * Returns null (no change at all) when there is nothing to commit: an empty
 * result, or a `frontmostLeafId` that is no longer in the stack.
 */
export function applyPathfinderResult(
  stack: PcbLayerStack,
  op: PathfinderOp,
  result: PathfinderOpResult,
  consumedIds: readonly string[],
): PathfinderApplyResult | null {
  const { specs, target } = result;
  if (specs.length === 0 || target === null) return null;

  const anchorId = target.frontmostLeafId;
  if (!findPcbNodeById(stack, anchorId)) return null;

  const leaves = specs.map(specToPathLayer);
  const group: GroupNode | null = shouldGroupResult(result)
    ? { kind: 'group', id: mintId('group'), name: PATHFINDER_OP_LABELS[op], children: leaves }
    : null;

  // Ancestors must be read BEFORE the tree changes — after the deletions the
  // consumed leaves are gone and their chains are unrecoverable.
  const emptyCandidates = ancestorGroupIds(stack, consumedIds);

  const grouped: LayerNode[] = group ? [group] : leaves;
  let next = replacePcbNodeWithNodes(stack, anchorId, grouped);
  let groupId = group ? group.id : null;
  if (next === stack && group !== null) {
    // The only way the grouped insert can be refused is MAX_GROUP_DEPTH: the
    // anchor already sits as deep as the tree allows. Flat siblings in the
    // same slot are a worse layer tree but a far better outcome than silently
    // dropping the user's op.
    next = replacePcbNodeWithNodes(stack, anchorId, leaves);
    groupId = null;
  }
  if (next === stack) return null;

  for (const id of consumedIds) {
    if (id === anchorId) continue;
    next = deletePcbNodeById(next, id);
  }

  const swept = pruneEmptyGroups(next, emptyCandidates);
  const createdLeafIds = leaves.map((leaf) => leaf.id);
  return {
    stack: swept.stack,
    selectionIds: groupId === null ? createdLeafIds : [groupId],
    createdLeafIds,
    groupId,
    prunedGroupIds: swept.prunedIds,
  };
}
