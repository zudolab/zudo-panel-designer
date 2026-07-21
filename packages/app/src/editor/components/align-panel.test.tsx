// @vitest-environment jsdom
// Drives the component through Testing Library against a small real-history
// harness (same pattern as tools/select.test.ts) so "ONE undo entry per
// press" exercises the actual @zpd/core reducer, not a mock.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  commit as coreCommit,
  createHistory,
  type DocState,
  type HistoryState,
  type Layer,
  type PathLayer,
  type ShapeLayer,
} from '@zpd/core';
import type { PanelDims, ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';
import { AlignPanel } from './align-panel';

afterEach(cleanup);

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  const ctx = {
    get doc() {
      return history.present;
    },
    get flatLayers() {
      return projectFlatLayers(history.present.layers);
    },
    get panel() {
      return PANEL;
    },
    commit: (next: DocState) => {
      history = coreCommit(history, next);
    },
  } as unknown as ToolContext;
  return {
    ctx,
    getHistory: () => history,
    layerById: (id: string) => history.present.layers.find((l) => l.id === id) as Layer,
  };
}

function rect(id: string, x: number, y: number, width: number, height: number): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width, height, color: 1 };
}

// No jest-dom matchers configured in this project (see sidebar.test.tsx's
// plain `.checked` reads) — read the DOM property directly instead of
// `toBeDisabled()`.
function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled;
}

describe('AlignPanel — enable/disable per selection count and reference mode', () => {
  it('align buttons are disabled under 2 selected layers (selection reference)', () => {
    const { ctx } = makeHarness({ panelHp: 12, guides: [], layers: [rect('a', 0, 0, 10, 10)] });
    render(<AlignPanel ctx={ctx} selectedIds={['a']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(true);
  });

  it('align buttons enable with 2+ selected layers (selection reference)', () => {
    const { ctx } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 30, 20, 20, 5)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(false);
  });

  it('distribute buttons stay disabled at 2 selected — need 3+ (selection reference)', () => {
    const { ctx } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 30, 20, 20, 5)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Distribute Horizontally' }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: 'Distribute Vertically' }))).toBe(true);
  });

  it('distribute buttons enable at 3+ selected (selection reference)', () => {
    const { ctx } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 15, 0, 10, 10), rect('c', 50, 0, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b', 'c']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Distribute Horizontally' }))).toBe(false);
  });

  it('switching the reference to Panel enables align/distribute from a single selected layer', () => {
    const { ctx } = makeHarness({ panelHp: 12, guides: [], layers: [rect('a', 0, 0, 10, 10)] });
    render(<AlignPanel ctx={ctx} selectedIds={['a']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(true);

    fireEvent.change(screen.getByLabelText('Align to'), { target: { value: 'panel' } });

    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(false);
    expect(isDisabled(screen.getByRole('button', { name: 'Distribute Horizontally' }))).toBe(false);
  });

  it('pattern layers are excluded from the eligible count (position-pinned backgrounds)', () => {
    const pattern: Layer = {
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
    const { ctx } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), pattern],
    });
    // 2 selected total, but only 1 eligible (pattern excluded) — align still needs 2.
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'p']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(true);
  });
});

describe('AlignPanel — align/distribute apply expected dx/dy in ONE undo entry', () => {
  it('align-left moves every rect to the combined bbox min x', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 30, 20, 20, 5)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align Left' }));

    expect(getHistory().past).toHaveLength(1);
    expect((layerById('a') as ShapeLayer).x).toBe(0);
    expect((layerById('b') as ShapeLayer).x).toBe(0);
  });

  it('distribute-h spaces the middle rect with equal gaps, endpoints unmoved, one undo entry', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('x0', 0, 0, 10, 10), rect('x1', 15, 0, 10, 10), rect('x2', 50, 0, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['x0', 'x1', 'x2']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Horizontally' }));

    expect(getHistory().past).toHaveLength(1);
    // span 0..60, total width 30 -> gap = (60-0-30)/2 = 15
    expect((layerById('x0') as ShapeLayer).x).toBe(0); // first anchored
    expect((layerById('x2') as ShapeLayer).x).toBe(50); // last anchored
    expect((layerById('x1') as ShapeLayer).x).toBe(25); // 0 + 10 + 15
  });

  it('a rotated shape aligns by its rotation-aware AABB, not its raw x/y/width/height', () => {
    // A 10x10 square rotated 45deg about its own center (5,5) has an
    // axis-aligned bbox of side 10*sqrt(2), centered on the same point — its
    // rotation-aware left edge (5 - half) sits left of its raw x (0). A far
    // anchor rect ('c') forces the combined bbox's min x to a value neither
    // shape's own bbox reaches, so the square's delta is only correct if its
    // own AlignRect used the rotated AABB (not the raw x/width) as the base
    // to shift from — a raw-bbox bug would compute a different, wrong dx.
    const half = (10 * Math.sqrt(2)) / 2;
    const rotatedSquare: ShapeLayer = {
      id: 'r',
      name: 'r',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 45,
      color: 1,
    };
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rotatedSquare, rect('c', -100, 0, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['r', 'c']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align Left' }));

    expect(getHistory().past).toHaveLength(1);
    // combined bbox min x = -100 (from 'c'); rotation-aware dx for the square
    // = -100 - (5 - half); its raw x (originally 0) shifts by that same dx.
    const expectedDx = -100 - (5 - half);
    const moved = layerById('r') as ShapeLayer;
    expect(moved.x).toBeCloseTo(expectedDx, 5);
    // and its resulting AABB left edge lands exactly on the combined min.
    expect(moved.x + moved.width / 2 - half).toBeCloseTo(-100, 5);
  });

  it('panel reference aligns against the panel mm bounds, not the selection bbox', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 10, 10, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a']} />);
    fireEvent.change(screen.getByLabelText('Align to'), { target: { value: 'panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align Right' }));

    expect(getHistory().past).toHaveLength(1);
    // PANEL.widthMm = 100 -> right edge at 100 -> x = 100 - width(10) = 90
    expect((layerById('a') as ShapeLayer).x).toBe(90);
  });

  it('distribute panel reference works from a single selected layer (centers it with equal gaps)', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a']} />);
    fireEvent.change(screen.getByLabelText('Align to'), { target: { value: 'panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Distribute Horizontally' }));

    expect(getHistory().past).toHaveLength(1);
    // gap on each side = (100 - 10) / 2 = 45
    expect((layerById('a') as ShapeLayer).x).toBe(45);
  });

  it('a path layer moves via translatePathLayer — its points shift by dx/dy', () => {
    const path: PathLayer = {
      id: 'p1',
      name: 'Path',
      type: 'path',
      points: [
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 20 },
      ],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [path, rect('a', 30, 0, 10, 10)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['p1', 'a']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align Top' }));

    expect(getHistory().past).toHaveLength(1);
    // combined bbox minY = 0 (from 'a'); path's bbox minY was 10 -> dy = -10
    const moved = layerById('p1') as PathLayer;
    expect(moved.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect((layerById('a') as ShapeLayer).y).toBe(0); // already at the min, unchanged
  });
});

describe('AlignPanel — no-op presses do not touch history', () => {
  it('aligning already-flush-left rects creates no undo entry (and does not clear redo)', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 0, 0, 10, 10), rect('b', 0, 20, 20, 5)],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align Left' }));

    // both rects were already flush left (x=0) -> every delta is zero -> no commit
    expect(getHistory().past).toHaveLength(0);
    expect((layerById('a') as ShapeLayer).x).toBe(0);
    expect((layerById('b') as ShapeLayer).x).toBe(0);
  });
});

describe('AlignPanel — geometry-free paths are excluded from the eligible set', () => {
  it('a path with zero points does not count toward the eligible selection', () => {
    const emptyPath: PathLayer = {
      id: 'empty',
      name: 'Empty path',
      type: 'path',
      points: [],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 10, 10, 10, 10), emptyPath],
    });
    // 2 selected total, but the empty path has no real geometry -> only 1
    // eligible layer -> align (needs 2) stays disabled.
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'empty']} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Align Left' }))).toBe(true);
  });

  it("a geometry-free path is not dragged toward the origin when it doesn't count as a target", () => {
    const emptyPath: PathLayer = {
      id: 'empty',
      name: 'Empty path',
      type: 'path',
      points: [],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rect('a', 10, 10, 10, 10), rect('b', 40, 30, 10, 10), emptyPath],
    });
    render(<AlignPanel ctx={ctx} selectedIds={['a', 'b', 'empty']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align Left' }));

    // Combined bbox must come only from 'a'/'b' (min x = 10), NOT from the
    // empty path's synthetic (0,0,0,0) bbox — a pre-fix bug would drag both
    // rects toward x=0 instead.
    expect(getHistory().past).toHaveLength(1);
    expect((layerById('a') as ShapeLayer).x).toBe(10);
    expect((layerById('b') as ShapeLayer).x).toBe(10);
  });
});
