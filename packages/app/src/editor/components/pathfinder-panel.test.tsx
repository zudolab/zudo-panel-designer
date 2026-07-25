// @vitest-environment jsdom
// Gating per the min-input table (#208) + a real-geometry, real-history
// integration pass proving every one of the ten buttons actually reaches
// createPathfinderRunner (runner.ts) and lands its ONE undo entry — not just
// that the button exists. Same harness shape as align-panel.test.tsx
// (real @zpd/core history, not a commit spy) plus the fake-host pattern from
// pathfinder/runner.test.ts, since the runner's own stale-input guard reads
// doc/selectedIds/mutationEpoch live off the host it is given.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  commit as coreCommit,
  createHistory,
  createPcbLayerStack,
  type DocState,
  type HistoryState,
  type LayerNode,
  type ShapeLayer,
} from '@zpd/core';
import { PATHFINDER_OP_LABELS, PATHFINDER_OPS } from '../pathfinder';
import { dismissToast, getToasts } from '../registry/toasts';
import type { ToolContext } from '../types';
import { PathfinderPanel } from './pathfinder-panel';

afterEach(() => {
  cleanup();
  for (const t of getToasts()) dismissToast(t.id);
});

function rect(id: string, x: number, y: number, w = 10, h = 10): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width: w, height: h, color: 1 };
}

// Mirrors the PathfinderHost shape runner.ts needs — `doc`/`selectedIds` are
// LIVE getters over one history instance, `mutationEpoch` bumps on every
// mutator, exactly like Editor.tsx's real ctx (see runner.ts's header for
// why the epoch has to move at call time, not at React's flush).
function makeHarness(layers: LayerNode[], selectedIds: readonly string[]) {
  let history: HistoryState<DocState> = createHistory({
    panelHp: 12,
    guides: [],
    layers: createPcbLayerStack({ copper: layers }),
  });
  let epoch = 0;
  let selection = selectedIds;
  const ctx = {
    get doc() {
      return history.present;
    },
    get selectedIds() {
      return selection;
    },
    get mutationEpoch() {
      return epoch;
    },
    commit: (next: DocState) => {
      epoch += 1;
      history = coreCommit(history, next);
    },
    selectIds: (ids: readonly string[]) => {
      epoch += 1;
      selection = ids;
    },
  } as unknown as ToolContext;
  return { ctx, getHistory: () => history };
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

describe('PathfinderPanel — button rows', () => {
  it('renders "Shape Modes:" and "Pathfinders:" labels with one button per op', () => {
    const { ctx } = makeHarness([rect('a', 0, 0), rect('b', 5, 5)], ['a', 'b']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a', 'b']} />);

    expect(screen.getByText('Shape Modes:')).toBeTruthy();
    expect(screen.getByText('Pathfinders:')).toBeTruthy();
    for (const op of PATHFINDER_OPS) {
      expect(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] })).toBeTruthy();
    }
    // minusBack renders in the Pathfinders row, not Shape Modes, even though
    // it is engine-wise a shape mode (Illustrator's grouping — README.md).
    const pathfindersRow = screen.getByText('Pathfinders:').parentElement!;
    expect(
      pathfindersRow.querySelector(`[aria-label="${PATHFINDER_OP_LABELS.minusBack}"]`),
    ).toBeTruthy();
    const shapeModesRow = screen.getByText('Shape Modes:').parentElement!;
    expect(
      shapeModesRow.querySelector(`[aria-label="${PATHFINDER_OP_LABELS.minusBack}"]`),
    ).toBeNull();
  });
});

describe('PathfinderPanel — enable/disable per the min-input table (#208)', () => {
  it('every op is disabled with zero eligible leaves', () => {
    const { ctx } = makeHarness([], []);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={[]} />);
    for (const op of PATHFINDER_OPS) {
      expect(isDisabled(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] }))).toBe(
        true,
      );
    }
  });

  it('divide and outline enable at ONE eligible leaf; the other eight stay disabled', () => {
    const { ctx } = makeHarness([rect('a', 0, 0)], ['a']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a']} />);
    for (const op of PATHFINDER_OPS) {
      const enabled = op === 'divide' || op === 'outline';
      expect(isDisabled(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] }))).toBe(
        !enabled,
      );
    }
  });

  it('all ten ops enable at two eligible leaves', () => {
    const { ctx } = makeHarness([rect('a', 0, 0), rect('b', 5, 5)], ['a', 'b']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a', 'b']} />);
    for (const op of PATHFINDER_OPS) {
      expect(isDisabled(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] }))).toBe(
        false,
      );
    }
  });

  it('a non-path/shape leaf (pattern) does not count toward the eligible total', () => {
    const pattern: LayerNode = {
      id: 'p',
      name: 'Pattern',
      type: 'pattern',
      patternType: 'dots',
      params: {},
      color: 0,
      x: 0,
      y: 0,
      size: 128.5,
    };
    const { ctx } = makeHarness([rect('a', 0, 0), pattern], ['a', 'p']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a', 'p']} />);
    // 2 selected total, but only 1 eligible (pattern excluded) -> unite (needs 2) stays disabled.
    expect(isDisabled(screen.getByRole('button', { name: 'Unite' }))).toBe(true);
    // ...while divide (needs only 1) is enabled.
    expect(isDisabled(screen.getByRole('button', { name: 'Divide' }))).toBe(false);
  });

  // Regression for a real bug caught in review: Editor.tsx's ctx.doc reads a
  // ref that resyncs in a passive effect, one render BEHIND the doc a commit
  // just produced (see rotate-selection-panel.tsx's identical doc-prop
  // comment). A Path Finder op mints brand-new leaf ids and reselects them in
  // the SAME commit, so gating that read ctx.doc directly would resolve the
  // freshly-selected ids against the stale pre-op tree and find zero eligible
  // leaves — every button, including Divide/Outline, would render disabled
  // right after a successful op. The panel must gate on the `doc` PROP
  // instead (Editor's own committed-state React value, never ref-lagged).
  it("gates on the doc PROP, not ctx.doc — correct even while ctx.doc is stale (Editor's real lag pattern)", () => {
    const staleDoc: DocState = {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({ copper: [] }),
    };
    const freshDoc: DocState = {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({ copper: [rect('r1', 0, 0), rect('r2', 5, 5)] }),
    };
    const ctx = {
      // Deliberately frozen at the pre-op (empty) tree, as ctx.doc would be
      // for the one render right after a commit — see comment above.
      get doc() {
        return staleDoc;
      },
      get selectedIds() {
        return ['r1', 'r2'];
      },
      get mutationEpoch() {
        return 0;
      },
      commit: () => {},
      selectIds: () => {},
    } as unknown as ToolContext;

    render(<PathfinderPanel ctx={ctx} doc={freshDoc} selectedIds={['r1', 'r2']} />);

    // If gating incorrectly read ctx.doc (empty tree), every button — even
    // Divide/Outline (min 1) — would be disabled. Reading the `doc` prop
    // instead correctly resolves 2 eligible leaves.
    for (const op of PATHFINDER_OPS) {
      expect(isDisabled(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] }))).toBe(
        false,
      );
    }
  });
});

describe('PathfinderPanel — wired to the real runner (not a hand-rolled dispatch)', () => {
  it.each(PATHFINDER_OPS)('clicking %s commits exactly once through createPathfinderRunner', async (op) => {
    const { ctx, getHistory } = makeHarness([rect('a', 0, 0), rect('b', 5, 5)], ['a', 'b']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a', 'b']} />);

    fireEvent.click(screen.getByRole('button', { name: PATHFINDER_OP_LABELS[op] }));

    // Real geometry is async (lazy `import('path-bool')`) — wait for the
    // runner's single commit to land rather than asserting synchronously.
    await waitFor(() => expect(getHistory().past).toHaveLength(1));
    // One commit, not a click-per-commit accumulation from a re-render loop.
    expect(getHistory().past).toHaveLength(1);
  });

  it('a disabled button does not dispatch (no commit) — under-minimum selection', async () => {
    const { ctx, getHistory } = makeHarness([rect('a', 0, 0)], ['a']);
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a']} />);

    const uniteBtn = screen.getByRole('button', { name: 'Unite' });
    expect(isDisabled(uniteBtn)).toBe(true);
    fireEvent.click(uniteBtn);

    // Give any accidental async dispatch a turn to (not) run, then confirm nothing committed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getHistory().past).toHaveLength(0);
  });

  it('a click that produces an empty result (no-op) surfaces a toast instead of silently doing nothing', async () => {
    // Two disjoint rects, far apart — Intersect's true result is empty.
    const { ctx, getHistory } = makeHarness(
      [rect('a', 0, 0), rect('b', 1000, 1000)],
      ['a', 'b'],
    );
    render(<PathfinderPanel ctx={ctx} doc={ctx.doc} selectedIds={['a', 'b']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Intersect' }));

    await waitFor(() =>
      expect(getToasts().some((t) => t.message === 'Intersect produced no result')).toBe(true),
    );
    // No-op means no commit, either.
    expect(getHistory().past).toHaveLength(0);
  });
});
