// @vitest-environment jsdom
//
// Drives RotateSelectionPanel through Testing Library against a small REAL
// @zpd/core history harness (same pattern as align-panel.test.tsx) so the
// #157 acceptance criteria — one undo entry per finalize, Escape leaves zero
// residue, delta idempotence — exercise the actual history reducer, not a
// mock of it.
//
// Harness fidelity (the part two #157 timing bugs hinged on): in the real app
// EVERY history dispatch re-renders Editor, which re-renders this row with
// the committed present as its `doc` prop — while ctx.doc reads Editor's
// docRef, synced in a passive effect AFTER the commit, i.e. one render LATE.
// The Host below reproduces the prop path exactly: each ctx mutator updates
// the reducer-truth history and schedules a re-render that passes the fresh
// `history.present` down, batching with the row's own setState calls just
// like a real event handler's flush. And because the committed doc now
// arrives as a prop, the harness POISONS ctx.doc/ctx.flatLayers outright —
// any regression back to reading the docRef-lagged getters at render time
// (the root cause of both the post-Escape re-bake and the discarded external
// nudge) throws immediately instead of passing by luck of synchronous test
// timing.
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  abortGesture as coreAbortGesture,
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  replace as coreReplace,
  type DocState,
  type HistoryState,
  type Layer,
  type PatternLayer,
  type ShapeLayer,
} from '@zpd/core';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
import { bakeMultiRotate, captureMultiRotateSession } from '../multi-rotate';
import { RotateSelectionPanel } from './rotate-selection-panel';

afterEach(cleanup);

function rect(id: string, x: number, y: number, width: number, height: number): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width, height, color: 1 };
}

function pattern(id: string): PatternLayer {
  return { id, name: id, type: 'pattern', patternType: 'dot-grid', color: 1, params: {}, x: 0, y: 0, size: 10 };
}

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let notify: () => void = () => {};
  const mutate = (next: HistoryState<DocState>) => {
    history = next;
    notify();
  };
  const ctx = {
    get doc(): DocState {
      throw new Error(
        'RotateSelectionPanel must not read ctx.doc — the docRef getter lags a commit by one render; the committed doc arrives as the `doc` prop',
      );
    },
    get flatLayers(): Layer[] {
      throw new Error(
        'RotateSelectionPanel must not read ctx.flatLayers — derive the projection from the `doc` prop instead',
      );
    },
    commit: (next: DocState) => mutate(coreCommit(history, next)),
    replace: (next: DocState) => mutate(coreReplace(history, next)),
    beginGesture: () => mutate(coreBeginGesture(history)),
    abortGesture: () => mutate(coreAbortGesture(history)),
  } as unknown as ToolContext;
  // The Editor stand-in: re-renders on every dispatch and passes the fresh
  // committed present down — the same single-flush batching a real event
  // handler gets (React 18+ batches the reducer dispatch and the row's own
  // setState calls together).
  function Host({ selectedIds }: { selectedIds: readonly string[] }) {
    const [, setTick] = useState(0);
    notify = () => setTick((t) => t + 1);
    return <RotateSelectionPanel ctx={ctx} doc={history.present} selectedIds={selectedIds} />;
  }
  return {
    ctx,
    Host,
    getHistory: () => history,
    getDoc: () => history.present,
    layerById: (id: string) =>
      history.present.layers.find((l) => 'id' in l && l.id === id) as ShapeLayer,
  };
}

const TWO_RECTS_DOC: DocState = {
  panelHp: 12,
  guides: [],
  layers: [rect('a', 0, 0, 10, 10), rect('b', 30, 0, 10, 10)],
};

describe('RotateSelectionPanel — visibility', () => {
  it('renders nothing for a single-leaf selection', () => {
    const { Host } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a']} />);
    expect(screen.queryByLabelText('Rotate selection (°)')).toBeNull();
  });

  it('renders nothing for an all-non-rotatable (pattern-only) combined selection', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: [pattern('p1'), pattern('p2')] };
    const { Host } = makeHarness(doc);
    render(<Host selectedIds={['p1', 'p2']} />);
    expect(screen.queryByLabelText('Rotate selection (°)')).toBeNull();
  });

  it('renders for a combined (2-leaf) rotatable selection, starting at 0.0°', () => {
    const { Host } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;
    expect(input.value).toBe('0.0');
  });
});

describe('RotateSelectionPanel — delta idempotence and lazy gesture', () => {
  it('typing 45 then 45 again bakes exactly 45°, not 90° (never cumulative)', () => {
    const { Host, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45);

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45); // idempotent — re-baked from the SAME frozen start
  });

  it('a zero-net delta never opens a gesture (no history entry written)', () => {
    const { Host, getHistory } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '0' } });
    expect(getHistory().past.length).toBe(baselinePast); // still nothing opened
  });
});

describe('RotateSelectionPanel — finalize (Enter/blur) == one undo entry', () => {
  it('Enter finalizes with exactly one past entry for the whole gesture', () => {
    const { Host, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(getHistory().past.length).toBe(baselinePast + 1); // ONE entry, not one per keystroke
    expect(layerById('a').rotation).toBe(30);
  });

  it('blur finalizes the same way as Enter', () => {
    const { Host, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);

    expect(getHistory().past.length).toBe(baselinePast + 1);
    expect(layerById('a').rotation).toBe(15);
  });
});

describe('RotateSelectionPanel — Escape via abortGesture', () => {
  it('zero-delta Escape restores the captured snapshots verbatim, no history residue', () => {
    const { Host, getHistory, getDoc, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45);
    expect(getHistory().past.length).toBe(baselinePast + 1); // gesture opened

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(getHistory().past.length).toBe(baselinePast); // the phantom entry is gone
    expect(layerById('a').rotation).toBeUndefined(); // exact pre-edit snapshot restored
    expect(getDoc().layers).toEqual(TWO_RECTS_DOC.layers); // deep-equal against the captures
  });

  it('Escape after a finalize rolls back only the post-finalize edit', () => {
    const { Host, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // finalize: 30° stands, new baseline
    expect(getHistory().past.length).toBe(baselinePast + 1);
    expect(layerById('a').rotation).toBe(30);

    fireEvent.change(input, { target: { value: '60' } }); // post-finalize edit: +60 from the 30° baseline
    expect(layerById('a').rotation).toBe(90);
    expect(getHistory().past.length).toBe(baselinePast + 2); // its own new gesture

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(getHistory().past.length).toBe(baselinePast + 1); // only the finalize entry remains
    expect(layerById('a').rotation).toBe(30); // rolled back to the finalized state, not to 0
  });

  it('Escape with no open gesture (input never left 0) is a true no-op', () => {
    const { Host, getHistory } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getHistory().past.length).toBe(baselinePast);
  });

  it('full type -> Escape -> type -> Enter cycle leaves exactly one entry, no residue', () => {
    const { Host, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getHistory().past.length).toBe(baselinePast); // aborted cleanly

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(getHistory().past.length).toBe(baselinePast + 1); // exactly one entry total
    expect(getHistory().future).toEqual([]);
    expect(layerById('a').rotation).toBe(12);
  });
});

describe('RotateSelectionPanel — invalid/empty input', () => {
  it('an empty draft holds the last applied bake instead of snapping to 0', () => {
    const { Host, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '20' } });
    expect(layerById('a').rotation).toBe(20);

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe(''); // draft shows what was typed
    expect(layerById('a').rotation).toBe(20); // doc untouched — still the last valid bake
  });

  it('finalizing on an empty/invalid draft keeps the last applied bake as the new baseline', () => {
    const { Host, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(layerById('a').rotation).toBe(20);
    expect(input.value).toBe('0.0'); // field resets — ready for a fresh delta from the new baseline
  });
});

describe('RotateSelectionPanel — baseline reset on selection change', () => {
  it('re-captures fresh starts (and resets the draft) when the selection set changes', () => {
    const doc: DocState = {
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 30, 0, 10, 10), rect('c', 60, 0, 10, 10)],
    };
    const { Host, layerById } = makeHarness(doc);
    const { rerender } = render(<Host selectedIds={['a', 'b']} />);
    const input = () => screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;

    fireEvent.change(input(), { target: { value: '15' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(layerById('a').rotation).toBe(15);

    rerender(<Host selectedIds={['b', 'c']} />);
    expect(input().value).toBe('0.0'); // fresh row state for the new selection

    fireEvent.change(input(), { target: { value: '20' } });
    // 'b' was already finalized at 15° (member of the FIRST gesture too) —
    // the new capture uses that as ITS baseline, so +20 lands at 35°, while
    // fresh 'c' (baseline 0°) lands at exactly 20°.
    expect(layerById('b').rotation).toBe(35);
    expect(layerById('a').rotation).toBe(15); // untouched — 'a' left the selection
    expect(layerById('c').rotation).toBe(20);
  });
});

// Regression for a codex-review P1 finding: an unchanged selection must not
// pin a stale session across an EXTERNAL doc edit (another tool's move/align)
// that lands between two visits to this row. Gated on !gestureOpen so it
// never fires mid-edit against the row's OWN replace() stream.
describe('RotateSelectionPanel — re-captures on an external doc edit under an unchanged selection', () => {
  it('bakes the next delta from the moved position, not the stale pre-move snapshot', () => {
    const { ctx, Host, getDoc, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);

    // An external edit (e.g. a plain drag-move tool) commits directly —
    // never through this row — moving 'a' far from its captured position.
    // The Host re-renders on the dispatch, exactly like the real Editor.
    const movedLayers = getDoc().layers.map((l) =>
      'id' in l && l.id === 'a' ? { ...l, x: 200 } : l,
    );
    act(() => ctx.commit({ ...getDoc(), layers: movedLayers }));

    const input = screen.getByLabelText('Rotate selection (°)');
    fireEvent.change(input, { target: { value: '10' } });

    // Ground truth: a session captured FRESH from the moved doc, baked at the
    // same delta — this is what a correct re-capture must match.
    const freshSession = captureMultiRotateSession(
      movedLayers,
      ['a', 'b'],
      projectFlatLayers(movedLayers),
    );
    if (!freshSession) throw new Error('expected a capturable session for two rotatable rects');
    const expected = bakeMultiRotate(movedLayers, freshSession, 10);
    const expectedA = expected.find((l) => 'id' in l && l.id === 'a') as ShapeLayer;

    expect(layerById('a').x).toBeCloseTo(expectedA.x, 6);
    expect(layerById('a').rotation).toBe(10);
  });

  it('does NOT re-capture mid-gesture — an external edit while this row is actively editing is ignored', () => {
    const { ctx, Host, getDoc, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '5' } }); // opens the gesture, session frozen
    expect(layerById('a').rotation).toBe(5);

    // An external edit lands mid-gesture — this row must keep baking from ITS
    // OWN frozen session, not silently re-capture from the mutated doc.
    const externallyMoved = getDoc().layers.map((l) =>
      'id' in l && l.id === 'b' ? { ...l, x: 999 } : l,
    );
    act(() => ctx.replace({ ...getDoc(), layers: externallyMoved }));

    fireEvent.change(input, { target: { value: '10' } });
    // Still baked from the ORIGINAL start snapshot (b at x=30), so 'a' — which
    // never moved externally — lands exactly where a fresh 10° bake from the
    // untouched original doc would put it.
    const freshFromOriginal = captureMultiRotateSession(
      TWO_RECTS_DOC.layers,
      ['a', 'b'],
      projectFlatLayers(TWO_RECTS_DOC.layers),
    );
    if (!freshFromOriginal) throw new Error('expected a capturable session for two rotatable rects');
    const expected = bakeMultiRotate(TWO_RECTS_DOC.layers, freshFromOriginal, 10);
    const expectedA = expected.find((l) => 'id' in l && l.id === 'a') as ShapeLayer;
    expect(layerById('a').x).toBeCloseTo(expectedA.x, 6);
    expect(layerById('a').rotation).toBe(10);
  });
});

// Behavioral regressions for the two #157 timing bugs that hinged on this row
// once sourcing its tree from the docRef-lagged ctx.doc (see the harness
// comment at the top): typing immediately after an Escape must not bake on
// top of the aborted delta (found by #158's e2e pass), and typing immediately
// after an external nudge must not discard the nudge (found by codex's epic
// review). Prop-sourcing the committed doc closes both — the poisoned ctx
// getters in makeHarness keep it closed.
describe('RotateSelectionPanel — commit-render timing regressions', () => {
  it('typing right after an external nudge bakes from the nudged doc, not the stale pre-nudge session', () => {
    const { ctx, Host, getDoc, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    // The external nudge commits; the very next user action is typing into
    // this row — no other render lands in between.
    const movedLayers = getDoc().layers.map((l) =>
      'id' in l && l.id === 'a' ? { ...l, x: 200 } : l,
    );
    act(() => ctx.commit({ ...getDoc(), layers: movedLayers }));

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const freshSession = captureMultiRotateSession(
      movedLayers,
      ['a', 'b'],
      projectFlatLayers(movedLayers),
    );
    if (!freshSession) throw new Error('expected a capturable session for two rotatable rects');
    const expected = bakeMultiRotate(movedLayers, freshSession, 10);
    const expectedA = expected.find((l) => 'id' in l && l.id === 'a') as ShapeLayer;
    expect(layerById('a').x).toBeCloseTo(expectedA.x, 6); // the nudge survives
    expect(layerById('a').rotation).toBe(10);
  });

  it('typing right after an Escape bakes from the pre-gesture baseline, not on the aborted delta', () => {
    const { Host, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<Host selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.change(input, { target: { value: '47' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getHistory().past.length).toBe(baselinePast); // abort itself worked...
    expect(layerById('a').rotation).toBeUndefined(); // ...and the doc reverted

    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(layerById('a').rotation).toBe(45); // NOT 92 (= 47 + 45 baked on the aborted delta)
    expect(layerById('b').rotation).toBe(45);
    expect(getHistory().past.length).toBe(baselinePast + 1);
  });
});
