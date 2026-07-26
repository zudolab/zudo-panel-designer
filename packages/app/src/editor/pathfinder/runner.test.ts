// Dispatch → stale guard → one undo entry.
//
// The host below is a real @zpd/core history (createHistory/commit/undo), not
// a spy: "exactly one undo entry" and "one undo reverts the whole tree-shape
// change" are only meaningful against the reducer the app actually uses.
//
// Geometry is injected. The stale paths are races by definition — a result
// arriving after the document moved on — and the only way to test them without
// flake is to hold the op's promise open, mutate the host, then resolve. The
// real ten-op dispatcher runs in the integration block at the bottom.
import {
  createDefaultDoc,
  commit as commitHistory,
  createHistory,
  createPcbLayerStack,
  findPcbNodeById,
  projectPcbLayerStack,
  undo as undoHistory,
  type DocState,
  type GroupNode,
  type HistoryState,
  type LayerNode,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import { describe, expect, it } from 'vitest';
import type { BooleanEngine, KernelPathSpec } from '../geometry-kernel';
import type { ToolContext } from '../types';
import { PATHFINDER_OP_LABELS } from './mutation';
import { createPathfinderRunner, pathfinderRevision, type PathfinderHost } from './runner';
import { rectPoints } from './test-fixtures';
import type { PathfinderOpResult } from './types';

function shape(id: string, x: number): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y: 0, width: 10, height: 10, color: 1 };
}

function group(id: string, children: LayerNode[]): GroupNode {
  return { kind: 'group', id, name: id, children };
}

function doc(layers: PcbLayerStack, extra: Partial<DocState> = {}): DocState {
  return { ...createDefaultDoc(), panelHp: 20, layers, guides: [], ...extra };
}

function spec(name: string): KernelPathSpec {
  return {
    points: rectPoints(0, 0, 5, 5),
    closed: true,
    fill: 1,
    stroke: null,
    strokeWidth: 0,
    name,
  };
}

function opResult(specs: KernelPathSpec[], frontmostLeafId: string): PathfinderOpResult {
  return { specs, target: { role: 'copper', frontmostLeafId } };
}

interface TestHost {
  host: PathfinderHost;
  history: HistoryState<DocState>;
  selection: readonly string[];
  commits: number;
  /** An outside edit, exactly as any other action would make it. */
  edit(next: DocState): void;
  undo(): void;
  /** `lagReads` only: let the live getters catch up, as React's effect would. */
  flush(): void;
}

/**
 * `lagReads` models the editor's ToolContext: `doc` / `selectedIds` read refs
 * that resync in a passive effect, so between a mutator call and React's flush
 * they still report the PRE-mutation state — while `mutationEpoch` moves at
 * call time. Off by default, since most cases do not need the delay.
 */
function createTestHost(
  initial: DocState,
  selectedIds: readonly string[],
  options: { lagReads?: boolean } = {},
): TestHost {
  const state = {
    history: createHistory(initial),
    selection: selectedIds,
    commits: 0,
    epoch: 0,
  };
  let visible = { doc: state.history.present, selection: state.selection };
  const flush = () => {
    visible = { doc: state.history.present, selection: state.selection };
  };
  const publish = () => {
    if (!options.lagReads) flush();
  };
  const host: PathfinderHost = {
    get doc() {
      return visible.doc;
    },
    get selectedIds() {
      return visible.selection;
    },
    get mutationEpoch() {
      return state.epoch;
    },
    commit(next) {
      state.epoch += 1;
      state.history = commitHistory(state.history, next);
      state.commits += 1;
      publish();
    },
    selectIds(ids) {
      state.epoch += 1;
      state.selection = [...ids];
      publish();
    },
  };
  return {
    host,
    get history() {
      return state.history;
    },
    get selection() {
      return state.selection;
    },
    get commits() {
      return state.commits;
    },
    edit(next) {
      state.epoch += 1;
      state.history = commitHistory(state.history, next);
      publish();
    },
    undo() {
      state.epoch += 1;
      state.history = undoHistory(state.history);
      publish();
    },
    flush,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const fakeEngine = {} as BooleanEngine;
const createFakeEngine = () => Promise.resolve(fakeEngine);

/** A runner whose geometry resolves immediately with `result`. */
function immediateRunner(host: PathfinderHost, result: PathfinderOpResult) {
  return createPathfinderRunner(host, {
    createEngine: createFakeEngine,
    apply: () => Promise.resolve(result),
  });
}

describe('PathfinderHost', () => {
  it('is a port the editor’s ToolContext already satisfies', () => {
    // Compile-time, not runtime: `pnpm typecheck` fails if the port ever
    // drifts from ToolContext. That structural fit is why this module can take
    // five members instead of importing the editor context — and it is what
    // keeps runner.ts free of React.
    const satisfied: ToolContext extends PathfinderHost ? true : never = true;
    expect(satisfied).toBe(true);
  });
});

describe('pathfinderRevision', () => {
  it('keys on the layer tree reference and the selection ids', () => {
    const stack = createPcbLayerStack({ copper: [shape('a', 0)] });
    const test = createTestHost(doc(stack), ['a']);
    const first = pathfinderRevision(test.host);

    expect(pathfinderRevision(test.host)).toEqual(first);

    test.edit(doc(stack, { panelHp: 30 }));
    expect(pathfinderRevision(test.host).layers).toBe(first.layers);

    test.edit(doc(createPcbLayerStack({ copper: [shape('a', 5)] })));
    expect(pathfinderRevision(test.host).layers).not.toBe(first.layers);
  });

  it('captures the selection by value, so a later mutation cannot rewrite it', () => {
    const test = createTestHost(doc(createPcbLayerStack({ copper: [shape('a', 0)] })), ['a']);
    const captured = pathfinderRevision(test.host);
    test.host.selectIds(['b']);
    expect(captured.selectedIds).toEqual(['a']);
  });

  it('records the host epoch even when nothing observable changed', () => {
    const stack = createPcbLayerStack({ copper: [shape('a', 0)] });
    const test = createTestHost(doc(stack), ['a'], { lagReads: true });
    const before = pathfinderRevision(test.host);

    test.edit(doc(createPcbLayerStack({ copper: [shape('a', 9)] })));
    const after = pathfinderRevision(test.host);

    expect(after.layers).toBe(before.layers); // reads have not caught up
    expect(after.epoch).not.toBe(before.epoch); // but the epoch has
  });
});

describe('createPathfinderRunner — applying', () => {
  it('commits once and selects the result', async () => {
    const test = createTestHost(
      doc(createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] })),
      ['back', 'front'],
    );
    const outcome = await immediateRunner(test.host, opResult([spec('Unite')], 'front')).run(
      'unite',
    );

    expect(outcome.status).toBe('applied');
    expect(test.commits).toBe(1);
    expect(projectPcbLayerStack(test.host.doc.layers).map((l) => l.name)).toEqual(['Unite']);
    expect(test.selection).toEqual(outcome.status === 'applied' ? outcome.selectionIds : []);
  });

  it('is ONE undo entry, and that undo restores the whole tree shape', async () => {
    // Multi-piece + a group emptied by the op: the undo has to bring back the
    // consumed leaves AND the group that held them, not just layer contents.
    const before = createPcbLayerStack({
      copper: [group('g', [shape('back', 0)]), shape('front', 5)],
    });
    const test = createTestHost(doc(before), ['back', 'front']);

    const outcome = await immediateRunner(
      test.host,
      opResult([spec('Divide 1'), spec('Divide 2')], 'front'),
    ).run('divide');

    expect(outcome).toMatchObject({ status: 'applied', prunedGroupIds: ['g'] });
    expect(test.history.past).toHaveLength(1);
    expect(findPcbNodeById(test.host.doc.layers, 'g')).toBeNull();

    test.undo();
    expect(test.history.past).toHaveLength(0);
    expect(test.host.doc.layers).toEqual(before);
    const restored = findPcbNodeById(test.host.doc.layers, 'g')!.node as GroupNode;
    expect(restored.children.map((child) => child.id)).toEqual(['back']);
  });

  it('cancels rather than commits when a non-geometry edit lands mid-flight', async () => {
    // A panelHp/guide edit leaves `doc.layers` alone, so the STATE check would
    // let this through — the coarse epoch is what stops it. Cancelling costs a
    // re-click; committing would write a whole-document snapshot built before
    // the edit and silently revert it. This asserts the edit survives intact.
    const stack = createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] });
    const test = createTestHost(doc(stack), ['back', 'front']);
    const gate = deferred<PathfinderOpResult>();
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gate.promise,
    });

    const running = runner.run('unite');
    test.edit(doc(stack, { panelHp: 42 }));
    gate.resolve(opResult([spec('Unite')], 'front'));

    expect(await running).toEqual({ status: 'stale', op: 'unite', reason: 'host-changed' });
    expect(test.commits).toBe(0);
    expect(test.host.doc.panelHp).toBe(42);
    expect(test.host.doc.layers).toBe(stack);
  });

  it('tracks in-flight dispatches for a busy indicator', async () => {
    const test = createTestHost(
      doc(createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] })),
      ['back', 'front'],
    );
    const gate = deferred<PathfinderOpResult>();
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gate.promise,
    });

    expect(runner.pending).toBe(0);
    const running = runner.run('unite');
    await Promise.resolve();
    expect(runner.pending).toBe(1);

    gate.resolve(opResult([spec('Unite')], 'front'));
    await running;
    expect(runner.pending).toBe(0);
  });
});

describe('createPathfinderRunner — stale input is discarded', () => {
  function stalingRunner(selectedIds: readonly string[]) {
    const stack = createPcbLayerStack({
      copper: [shape('back', 0), shape('front', 5), shape('other', 20)],
    });
    const test = createTestHost(doc(stack), selectedIds);
    const gate = deferred<PathfinderOpResult>();
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gate.promise,
    });
    return { test, gate, runner, stack };
  }

  it('drops a result that arrives after the DOCUMENT changed', async () => {
    const { test, gate, runner } = stalingRunner(['back', 'front']);
    const running = runner.run('unite');

    // The user edits while path-bool is still loading.
    const edited = createPcbLayerStack({
      copper: [shape('back', 0), shape('front', 5), shape('added', 40)],
    });
    test.edit(doc(edited));
    gate.resolve(opResult([spec('Unite')], 'front'));

    expect(await running).toEqual({ status: 'stale', op: 'unite', reason: 'document-changed' });
    expect(test.commits).toBe(0);
    expect(test.host.doc.layers).toBe(edited);
    expect(projectPcbLayerStack(test.host.doc.layers).map((l) => l.id)).toEqual([
      'back',
      'front',
      'added',
    ]);
  });

  it('drops a result that arrives after the SELECTION changed', async () => {
    const { test, gate, runner } = stalingRunner(['back', 'front']);
    const running = runner.run('unite');

    test.host.selectIds(['front', 'other']);
    gate.resolve(opResult([spec('Unite')], 'front'));

    expect(await running).toEqual({ status: 'stale', op: 'unite', reason: 'selection-changed' });
    expect(test.commits).toBe(0);
    expect(projectPcbLayerStack(test.host.doc.layers)).toHaveLength(3);
  });

  it('drops a result when only the host EPOCH moved (React has not flushed yet)', async () => {
    // The regression this epoch exists for: a mutator queues its React update
    // synchronously, but ToolContext's doc/selectedIds refs resync in a passive
    // effect. A continuation resuming in that window sees the pre-edit document
    // through both, so without the epoch it would pass the guard and commit a
    // whole-document snapshot built from the superseded doc — reverting the
    // user's delete.
    const stack = createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] });
    const test = createTestHost(doc(stack), ['back', 'front'], { lagReads: true });
    const gate = deferred<PathfinderOpResult>();
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gate.promise,
    });

    const running = runner.run('unite');
    test.edit(doc(createPcbLayerStack({ copper: [shape('back', 0)] })));
    expect(test.host.doc.layers).toBe(stack); // the reads still lag, as in React

    gate.resolve(opResult([spec('Unite')], 'front'));
    expect(await running).toEqual({ status: 'stale', op: 'unite', reason: 'host-changed' });
    expect(test.commits).toBe(0);

    test.flush();
    expect(projectPcbLayerStack(test.host.doc.layers).map((l) => l.id)).toEqual(['back']);
  });

  it('does not confuse two selections that a joined key would collide', async () => {
    // Layer ids come from whatever a persisted document contained, so any
    // single separator can appear inside one: ['a<NUL>b', 'c'] and
    // ['a', 'b', 'c'] join to the same NUL-delimited key. Comparing the arrays
    // element-wise is what keeps the selection check exact.
    const nul = String.fromCharCode(0);
    const stack = createPcbLayerStack({
      copper: [shape(`a${nul}b`, 0), shape('c', 5)],
    });
    const test = createTestHost(doc(stack), [`a${nul}b`, 'c']);
    const gate = deferred<PathfinderOpResult>();
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gate.promise,
    });

    const running = runner.run('unite');
    test.host.selectIds(['a', 'b', 'c']);
    gate.resolve(opResult([spec('Unite')], 'c'));

    expect(await running).toEqual({ status: 'stale', op: 'unite', reason: 'selection-changed' });
    expect(test.commits).toBe(0);
  });

  it('drops a result SUPERSEDED by a later dispatch, and applies the later one', async () => {
    const stack = createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] });
    const test = createTestHost(doc(stack), ['back', 'front']);
    const first = deferred<PathfinderOpResult>();
    const second = deferred<PathfinderOpResult>();
    const gates = [first, second];
    let dispatched = 0;
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gates[dispatched++]!.promise,
    });

    const running1 = runner.run('unite');
    const running2 = runner.run('intersect');
    await Promise.resolve();

    // The older op finishes FIRST — nothing in the document has changed yet,
    // so only the sequence check can tell that it is no longer wanted.
    first.resolve(opResult([spec('Unite')], 'front'));
    expect(await running1).toEqual({ status: 'stale', op: 'unite', reason: 'superseded' });
    expect(test.commits).toBe(0);

    second.resolve(opResult([spec('Intersect')], 'front'));
    expect((await running2).status).toBe('applied');
    expect(test.commits).toBe(1);
    expect(projectPcbLayerStack(test.host.doc.layers).map((l) => l.name)).toEqual(['Intersect']);
  });

  it('applies a repeated identical click only once', async () => {
    const stack = createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] });
    const test = createTestHost(doc(stack), ['back', 'front']);
    const gates = [deferred<PathfinderOpResult>(), deferred<PathfinderOpResult>()];
    let dispatched = 0;
    const runner = createPathfinderRunner(test.host, {
      createEngine: createFakeEngine,
      apply: () => gates[dispatched++]!.promise,
    });

    const runs = [runner.run('unite'), runner.run('unite')];
    await Promise.resolve();
    for (const gate of gates) gate.resolve(opResult([spec('Unite')], 'front'));

    const outcomes = await Promise.all(runs);
    expect(outcomes.map((o) => o.status)).toEqual(['stale', 'applied']);
    expect(test.commits).toBe(1);
    expect(test.history.past).toHaveLength(1);
  });
});

describe('createPathfinderRunner — nothing to do', () => {
  it('reports insufficient inputs without touching the kernel', async () => {
    const test = createTestHost(doc(createPcbLayerStack({ copper: [shape('only', 0)] })), ['only']);
    let engineRequested = false;
    const runner = createPathfinderRunner(test.host, {
      createEngine: () => {
        engineRequested = true;
        return createFakeEngine();
      },
      apply: () => Promise.reject(new Error('must not run')),
    });

    expect(await runner.run('unite')).toEqual({
      status: 'no-op',
      op: 'unite',
      reason: 'insufficient-inputs',
    });
    expect(engineRequested).toBe(false);
    expect(test.commits).toBe(0);
  });

  it('reports an empty geometric result without committing', async () => {
    const test = createTestHost(
      doc(createPcbLayerStack({ copper: [shape('back', 0), shape('front', 40)] })),
      ['back', 'front'],
    );
    const outcome = await immediateRunner(test.host, { specs: [], target: null }).run('intersect');

    expect(outcome).toEqual({ status: 'no-op', op: 'intersect', reason: 'empty-result' });
    expect(test.commits).toBe(0);
  });

  it('retries the engine after a failed load instead of caching the failure', async () => {
    const test = createTestHost(
      doc(createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] })),
      ['back', 'front'],
    );
    let attempts = 0;
    const runner = createPathfinderRunner(test.host, {
      createEngine: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('chunk load failed')) : createFakeEngine();
      },
      apply: () => Promise.resolve(opResult([spec('Unite')], 'front')),
    });

    await expect(runner.run('unite')).rejects.toThrow('chunk load failed');
    expect(runner.pending).toBe(0);
    expect((await runner.run('unite')).status).toBe('applied');
    expect(attempts).toBe(2);
  });
});

describe('createPathfinderRunner — with the real ten-op dispatcher', () => {
  it('unites two overlapping copper rects into one layer, one undo entry', async () => {
    const before = createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5)] });
    const test = createTestHost(doc(before), ['back', 'front']);
    const runner = createPathfinderRunner(test.host);

    const outcome = await runner.run('unite');

    expect(outcome.status).toBe('applied');
    const leaves = projectPcbLayerStack(test.host.doc.layers);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].name).toBe(PATHFINDER_OP_LABELS.unite);
    expect(leaves[0].type).toBe('path');
    expect(test.history.past).toHaveLength(1);

    test.undo();
    expect(test.host.doc.layers).toEqual(before);
  });

  it('groups a multi-piece Divide and reverts it in one undo', async () => {
    // Two rects crossing in a plus sign: Divide splits them into more than one
    // painted face, so the result exercises the grouping branch for real.
    const before = createPcbLayerStack({
      copper: [
        { ...shape('h', 0), width: 30, height: 10, y: 10 },
        { ...shape('v', 10), width: 10, height: 30, y: 0 },
      ],
    });
    const test = createTestHost(doc(before), ['h', 'v']);

    const outcome = await createPathfinderRunner(test.host).run('divide');

    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.groupId).not.toBeNull();
    expect(projectPcbLayerStack(test.host.doc.layers).length).toBeGreaterThan(1);
    expect(test.history.past).toHaveLength(1);

    test.undo();
    expect(test.host.doc.layers).toEqual(before);
  });

  it('resolves inputs from the live selection, so an op reads the current tree', async () => {
    const test = createTestHost(
      doc(createPcbLayerStack({ copper: [shape('back', 0), shape('front', 5), shape('far', 90)] })),
      ['back', 'front'],
    );
    const runner = createPathfinderRunner(test.host);

    await runner.run('unite');
    const names = projectPcbLayerStack(test.host.doc.layers).map((l) => l.name);
    expect(names).toEqual([PATHFINDER_OP_LABELS.unite, 'far']);
  });
});
