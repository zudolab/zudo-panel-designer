// @vitest-environment jsdom
//
// Drives RotateSelectionPanel through Testing Library against a small REAL
// @zpd/core history harness (same pattern as align-panel.test.tsx) so the
// #157 acceptance criteria — one undo entry per finalize, Escape leaves zero
// residue, delta idempotence — exercise the actual history reducer, not a
// mock of it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  abortGesture as coreAbortGesture,
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  replace as coreReplace,
  type DocState,
  type HistoryState,
  type PatternLayer,
  type ShapeLayer,
} from '@zpd/core';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
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
  const ctx = {
    get doc() {
      return history.present;
    },
    get flatLayers() {
      return projectFlatLayers(history.present.layers);
    },
    commit: (next: DocState) => {
      history = coreCommit(history, next);
    },
    replace: (next: DocState) => {
      history = coreReplace(history, next);
    },
    beginGesture: () => {
      history = coreBeginGesture(history);
    },
    abortGesture: () => {
      history = coreAbortGesture(history);
    },
  } as unknown as ToolContext;
  return {
    ctx,
    getHistory: () => history,
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
    const { ctx } = makeHarness(TWO_RECTS_DOC);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a']} />);
    expect(screen.queryByLabelText('Rotate selection (°)')).toBeNull();
  });

  it('renders nothing for an all-non-rotatable (pattern-only) combined selection', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: [pattern('p1'), pattern('p2')] };
    const { ctx } = makeHarness(doc);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['p1', 'p2']} />);
    expect(screen.queryByLabelText('Rotate selection (°)')).toBeNull();
  });

  it('renders for a combined (2-leaf) rotatable selection, starting at 0.0°', () => {
    const { ctx } = makeHarness(TWO_RECTS_DOC);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;
    expect(input.value).toBe('0.0');
  });
});

describe('RotateSelectionPanel — delta idempotence and lazy gesture', () => {
  it('typing 45 then 45 again bakes exactly 45°, not 90° (never cumulative)', () => {
    const { ctx, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45);

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45); // idempotent — re-baked from the SAME frozen start
  });

  it('a zero-net delta never opens a gesture (no history entry written)', () => {
    const { ctx, getHistory } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '0' } });
    expect(getHistory().past.length).toBe(baselinePast); // still nothing opened
  });
});

describe('RotateSelectionPanel — finalize (Enter/blur) == one undo entry', () => {
  it('Enter finalizes with exactly one past entry for the whole gesture', () => {
    const { ctx, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(getHistory().past.length).toBe(baselinePast + 1); // ONE entry, not one per keystroke
    expect(layerById('a').rotation).toBe(30);
  });

  it('blur finalizes the same way as Enter', () => {
    const { ctx, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);

    expect(getHistory().past.length).toBe(baselinePast + 1);
    expect(layerById('a').rotation).toBe(15);
  });
});

describe('RotateSelectionPanel — Escape via abortGesture', () => {
  it('zero-delta Escape restores the captured snapshots verbatim, no history residue', () => {
    const { ctx, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.change(input, { target: { value: '45' } });
    expect(layerById('a').rotation).toBe(45);
    expect(getHistory().past.length).toBe(baselinePast + 1); // gesture opened

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(getHistory().past.length).toBe(baselinePast); // the phantom entry is gone
    expect(layerById('a').rotation).toBeUndefined(); // exact pre-edit snapshot restored
    expect(ctx.doc.layers).toEqual(TWO_RECTS_DOC.layers); // deep-equal against the captures
  });

  it('Escape after a finalize rolls back only the post-finalize edit', () => {
    const { ctx, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
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
    const { ctx, getHistory } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getHistory().past.length).toBe(baselinePast);
  });

  it('full type -> Escape -> type -> Enter cycle leaves exactly one entry, no residue', () => {
    const { ctx, getHistory, layerById } = makeHarness(TWO_RECTS_DOC);
    const baselinePast = getHistory().past.length;
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
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
    const { ctx, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '20' } });
    expect(layerById('a').rotation).toBe(20);

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe(''); // draft shows what was typed
    expect(layerById('a').rotation).toBe(20); // doc untouched — still the last valid bake
  });

  it('finalizing on an empty/invalid draft keeps the last applied bake as the new baseline', () => {
    const { ctx, layerById } = makeHarness(TWO_RECTS_DOC);
    render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
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
    const { ctx, layerById } = makeHarness(doc);
    const { rerender } = render(<RotateSelectionPanel ctx={ctx} selectedIds={['a', 'b']} />);
    const input = () => screen.getByLabelText('Rotate selection (°)') as HTMLInputElement;

    fireEvent.change(input(), { target: { value: '15' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(layerById('a').rotation).toBe(15);

    rerender(<RotateSelectionPanel ctx={ctx} selectedIds={['b', 'c']} />);
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
