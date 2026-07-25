/**
 * Path Finder — dispatch, stale-input guard, one undo entry (epic #204, #213).
 *
 * Selection + op → new layer tree, committed exactly once. This is the async
 * seam between the pure op layer (#208), the pure tree transform
 * (`mutation.ts`) and whatever holds the document; the panel sub-issue (#214)
 * only wires buttons to `run()`.
 *
 * ── React-free by construction ────────────────────────────────────────────
 * The document is reached through {@link PathfinderHost}, five members that
 * `ToolContext` already satisfies structurally (its `doc` / `selectedIds` are
 * LIVE getters and it carries the synchronous `mutationEpoch` the guard below
 * needs). No React import, no hook, no `flushSync`, nothing that has to run
 * inside a reducer — the whole op is `commit(next)` once, and zpd's history
 * turns one commit into one full-document undo entry (core/history.ts). pgen's
 * ordering dance
 * (`flushContinuous → setLayers → setLabel → commit`) has no analogue here and
 * was deliberately not ported: it depends on a ref captured inside a state
 * updater, which React 19 StrictMode double-invokes.
 *
 * ── The stale-input guard ─────────────────────────────────────────────────
 * Geometry is asynchronous — the boolean kernel is behind a lazy
 * `import('path-bool')` and every op entry point is async. Between the click
 * and the result the user can edit the document, change the selection, or
 * dispatch another op. A late result carries geometry derived from inputs that
 * no longer describe the document, so applying it would silently overwrite
 * whatever happened in the meantime.
 *
 * Three independent checks, all evaluated AFTER the await and before any write:
 *
 *  - SUPERSEDED. Each dispatch takes a sequence number; a result whose number
 *    is no longer the latest is dropped. This is what makes the user's most
 *    recent click win when two ops are in flight at once (and what makes a
 *    double-click apply once, not twice).
 *  - STATE. `doc.layers` identity plus the selection ids, captured at dispatch.
 *    Every core tree op returns a fresh stack on change and the SAME reference
 *    on a no-op, so reference equality is an exact "the geometry these inputs
 *    came from is still the document" test. It names WHICH of the two moved,
 *    which is why it runs before the epoch rather than being subsumed by it.
 *  - EPOCH. `host.mutationEpoch`, which the host bumps SYNCHRONOUSLY inside
 *    every mutator. The two checks above are necessary but not sufficient in
 *    React: `ToolContext.doc` / `.selectedIds` read refs that resync in a
 *    passive effect, so a mutation dispatched while geometry is pending stays
 *    invisible to them until React renders. A continuation resuming inside
 *    that window would see the captured state, pass, and commit a
 *    whole-document snapshot built from the superseded doc — silently
 *    reverting the user's edit. The epoch closes that window because it moves
 *    at call time rather than at flush time, and it also covers undo / redo /
 *    gesture aborts, which never name their own resulting document.
 *
 * The epoch is deliberately COARSE: it counts mutations without describing
 * them, so it cannot tell a guide drag from a layer edit. Against a host that
 * provides one, ANY document or selection mutation landing during the await
 * cancels the op — including one that left `doc.layers` alone. That is the
 * intended trade: a Path Finder op is cheap and repeatable, reverting a user's
 * edit is not, and the window being traded away is the few milliseconds a
 * boolean takes. (A host that leaves the epoch constant still gets the STATE
 * semantics, where a guides-only edit does not cancel.)
 */

import type { DocState, PcbLayerStack } from '@zpd/core';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import { applyPathfinderOp, canApplyPathfinderOp } from './dispatch';
import { applyPathfinderResult } from './mutation';
import { resolvePathfinderInputs } from './selection';
import type { EligibleLeaf, PathfinderOp } from './types';

/**
 * The document surface a run needs — `ToolContext` satisfies it structurally.
 *
 * `doc` and `selectedIds` MUST be live reads (a getter over the committed
 * state); a snapshot captured at construction would make the guard compare a
 * stale value against itself and never fire. `mutationEpoch` MUST change
 * synchronously inside every mutator that can affect either, including ones
 * outside this module — see the EPOCH paragraph in the header for what a
 * constant epoch silently gives up.
 */
export interface PathfinderHost {
  readonly doc: DocState;
  readonly selectedIds: readonly string[];
  readonly mutationEpoch: number;
  commit(next: DocState): void;
  selectIds(ids: readonly string[]): void;
}

/**
 * The identity of "the inputs this op was dispatched against": the host's
 * synchronous mutation counter, the layer tree by reference, and the selected
 * ids. The ids stay an array and are compared element-wise — joining them into
 * one key would let a single id containing the separator collide with two ids
 * that do not, and a persisted document's ids are whatever its file said.
 */
export interface PathfinderRevision {
  epoch: number;
  layers: PcbLayerStack;
  selectedIds: readonly string[];
}

export function pathfinderRevision(host: PathfinderHost): PathfinderRevision {
  return {
    epoch: host.mutationEpoch,
    layers: host.doc.layers,
    selectedIds: [...host.selectedIds],
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Why a run wrote nothing even though its inputs were valid at dispatch.
 * `host-changed` is the epoch check firing alone: the host recorded a mutation
 * its own `doc` / `selectedIds` reads had not caught up with yet, so there is
 * nothing more specific to name.
 */
export type PathfinderStaleReason =
  'superseded' | 'document-changed' | 'selection-changed' | 'host-changed';

/**
 *  - `insufficient-inputs` — fewer eligible leaves than the op's minimum.
 *  - `empty-result` — the op ran and its true result is empty (disjoint
 *    Intersect, a subtract that removes everything, an all-sliver result).
 *  - `not-applicable` — the result could not be placed (its anchor left the
 *    tree between the guard and the write; not reachable in practice).
 */
export type PathfinderNoOpReason = 'insufficient-inputs' | 'empty-result' | 'not-applicable';

export type PathfinderRunOutcome =
  | {
      status: 'applied';
      op: PathfinderOp;
      selectionIds: string[];
      groupId: string | null;
      prunedGroupIds: string[];
    }
  | { status: 'no-op'; op: PathfinderOp; reason: PathfinderNoOpReason }
  | { status: 'stale'; op: PathfinderOp; reason: PathfinderStaleReason };

export interface PathfinderRunnerOptions {
  /**
   * Injection seam for tests: defaults to the real ten-op dispatcher. Lets a
   * test hold a result open across a document edit and prove the late result
   * is discarded, which is impossible to schedule reliably against the real
   * kernel.
   */
  apply?: typeof applyPathfinderOp;
  /** Defaults to the kernel's lazy factory; the engine is created once and reused. */
  createEngine?: () => Promise<BooleanEngine>;
}

export interface PathfinderRunner {
  run(op: PathfinderOp): Promise<PathfinderRunOutcome>;
  /** Dispatches still awaiting geometry — the panel's busy state. */
  readonly pending: number;
}

export function createPathfinderRunner(
  host: PathfinderHost,
  options: PathfinderRunnerOptions = {},
): PathfinderRunner {
  const apply = options.apply ?? applyPathfinderOp;
  const createEngine = options.createEngine ?? (() => createBooleanEngine());

  let enginePromise: Promise<BooleanEngine> | null = null;
  let dispatchSeq = 0;
  let pending = 0;

  // One engine per runner, so a batch of ops shares the arrangement backend.
  // A failed load must not be cached: clear the slot on rejection so the next
  // click retries instead of replaying the same error forever.
  function engine(): Promise<BooleanEngine> {
    enginePromise ??= createEngine().catch((err: unknown) => {
      enginePromise = null;
      throw err;
    });
    return enginePromise;
  }

  // The whole asynchronous window the guard below has to cover: loading the
  // kernel AND running the op. `pending` brackets both, so a panel spinner
  // stays up across the very first (slowest) dispatch, not just the boolean.
  async function geometry(op: PathfinderOp, inputs: EligibleLeaf[]) {
    pending += 1;
    try {
      return await apply(op, inputs, await engine());
    } finally {
      pending -= 1;
    }
  }

  async function run(op: PathfinderOp): Promise<PathfinderRunOutcome> {
    dispatchSeq += 1;
    const seq = dispatchSeq;

    const inputs = resolvePathfinderInputs(host.doc.layers, host.selectedIds);
    if (!canApplyPathfinderOp(op, inputs.length)) {
      return { status: 'no-op', op, reason: 'insufficient-inputs' };
    }
    const captured = pathfinderRevision(host);
    const consumedIds = inputs.map((input) => input.id);

    const result = await geometry(op, inputs);

    // Superseded first: a newer dispatch is a newer intent, and it may not
    // have changed the document yet (both results are still in flight), so
    // the revision check alone would let this older one land.
    if (seq !== dispatchSeq) return { status: 'stale', op, reason: 'superseded' };
    const now = pathfinderRevision(host);
    if (now.layers !== captured.layers) {
      return { status: 'stale', op, reason: 'document-changed' };
    }
    if (!sameIds(now.selectedIds, captured.selectedIds)) {
      return { status: 'stale', op, reason: 'selection-changed' };
    }
    // Last, so the two specific reasons above win when the host's reads HAVE
    // caught up. Reaching here means they have not: something mutated, and
    // only the epoch can see it yet.
    if (now.epoch !== captured.epoch) {
      return { status: 'stale', op, reason: 'host-changed' };
    }

    if (result.specs.length === 0 || result.target === null) {
      return { status: 'no-op', op, reason: 'empty-result' };
    }

    const applied = applyPathfinderResult(host.doc.layers, op, result, consumedIds);
    if (applied === null) return { status: 'no-op', op, reason: 'not-applicable' };

    // ONE commit: the new group, the consumed inputs and the pruned groups are
    // a single full-document snapshot, so one undo reverts the whole shape
    // change. Selection is Editor state, not DocState — selecting the result
    // afterwards adds no second undo entry.
    host.commit({ ...host.doc, layers: applied.stack });
    host.selectIds(applied.selectionIds);
    return {
      status: 'applied',
      op,
      selectionIds: applied.selectionIds,
      groupId: applied.groupId,
      prunedGroupIds: applied.prunedGroupIds,
    };
  }

  return {
    run,
    get pending() {
      return pending;
    },
  };
}
