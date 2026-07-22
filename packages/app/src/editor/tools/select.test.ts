// Proves the select tool's own contract, not just the core history reducer
// (already covered in @zpd/core's history.test.ts): a full drag/resize/
// node-edit gesture — however many pointermoves it produces — collapses into
// exactly ONE undo entry, and the tool correctly forwards Alt to
// movePathHandle's mirror flag. Drives the tool's onPointerDown/Move/Up
// handlers directly against a small ToolContext harness backed by the real
// core history functions (not a mock), so this exercises the real gesture
// wiring select.tsx performs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../tools/select'; // registers 'select' as a side effect
import { getTool } from '../registry/tools';
import {
  abortGesture as coreAbortGesture,
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  flattenLayerNodes,
  redo as coreRedo,
  replace as coreReplace,
  reset as coreReset,
  undo as coreUndo,
  type DocState,
  type Guide,
  type HistoryState,
  type ImageLayer,
  type Layer,
  type PathLayer,
  type PatternLayer,
  type Pt,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
import { rotateHandleScreenPos } from '../renderer';
import type { PanelDims, ToolContext, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';
import { projectFlatLayers } from '../flat-projection';
import { resetTextGeometryForTests, setTextMeasureForTests } from '../text-geometry';

const CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 }; // identity: screen px == mm
const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let selectedIds: readonly string[] = [];
  let beginGestureCalls = 0;
  let replaceCalls = 0;

  // Same derivation the Editor performs: selectedIds normalized against the
  // live doc; selectedId/selectedLayer non-null only for exactly one id.
  const readSelectedIds = () =>
    normalizeSelectedIds(selectedIds, flattenLayerNodes(history.present.layers));
  const readSelectedId = () => {
    const ids = readSelectedIds();
    return ids.length === 1 ? ids[0] : null;
  };

  const ctx: ToolContext = {
    get doc() {
      return history.present;
    },
    get camera() {
      return CAMERA;
    },
    get panel() {
      return PANEL;
    },
    get selectedIds() {
      return readSelectedIds();
    },
    get selectedId() {
      return readSelectedId();
    },
    get selectedLayer() {
      return flattenLayerNodes(history.present.layers).find((l) => l.id === readSelectedId()) ?? null;
    },
    get flatLayers() {
      return projectFlatLayers(history.present.layers);
    },
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: (next) => {
      history = coreCommit(history, next);
    },
    replace: (next) => {
      replaceCalls += 1;
      history = coreReplace(history, next);
    },
    reset: (next) => {
      history = coreReset(next);
    },
    beginGesture: () => {
      beginGestureCalls += 1;
      history = coreBeginGesture(history);
    },
    abortGesture: () => {
      history = coreAbortGesture(history);
    },
    undo: () => {
      history = coreUndo(history);
    },
    redo: () => {
      history = coreRedo(history);
    },
    select: (id) => {
      selectedIds = id === null ? [] : [id];
    },
    selectIds: (ids) => {
      selectedIds = ids;
    },
    setCamera: () => {},
    setActiveTool: () => {},
    requestRepaint: () => {},
    evictImageCache: () => {},
    openDialog: () => {},
    closeDialog: () => {},
  };

  return {
    ctx,
    getHistory: () => history,
    getBeginGestureCalls: () => beginGestureCalls,
    getReplaceCalls: () => replaceCalls,
    layerById: (id: string) => history.present.layers.find((l) => l.id === id) as Layer,
  };
}

function ptr(mm: Pt, overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    screen: mm, // identity camera, so screen === mm
    mm,
    button: 0,
    buttons: 1,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    pointerId: 1,
    preventDefault: () => {},
    ...overrides,
  };
}

const select = getTool('select')!;

beforeEach(() => {
  // module-scope drag/gestureOpen state — reset between tests defensively
  select.onDeactivate?.({} as ToolContext);
  resetTextGeometryForTests();
});

afterEach(() => resetTextGeometryForTests());

describe('select tool — canonical rotated-text direct hit (#111)', () => {
  it('uses the measured rotated box and preserves non-pattern-over-pattern ordering', () => {
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width: 40,
      height: 20,
    }));
    const text: TextLayer = {
      id: 'text-hit',
      name: 'Text',
      type: 'text',
      content: 'AAAAA\nBB',
      fontFamily: 'sans-serif',
      sizeMm: 8,
      x: 10,
      y: 20,
      rotation: 90,
      color: 1,
    };
    const pattern: PatternLayer = {
      id: 'cover-pattern',
      name: 'Pattern',
      type: 'pattern',
      patternType: 'dot-grid',
      params: {},
      color: 1,
      x: 0,
      y: 0,
      size: 100,
    };
    const { ctx } = makeHarness({ panelHp: 20, guides: [], layers: [text, pattern] });

    // Inside canonical B0 rotated box (AABB x20..40/y10..50) near its lower
    // left, but outside core's old shorter character-count estimate.
    select.onPointerDown?.(ptr({ x: 21, y: 49 }), ctx);
    select.onPointerUp?.(ptr({ x: 21, y: 49 }), ctx);
    expect(ctx.selectedIds).toEqual([text.id]);
  });
});

describe('select tool — one gesture == one undo entry', () => {
  it('a move drag (down, multiple moves, up) is exactly one undo entry', () => {
    const shape: ShapeLayer = {
      id: 's1',
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      color: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside the rect
    select.onPointerMove?.(ptr({ x: 17, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 20, y: 18 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const moved = layerById('s1') as ShapeLayer;
    // total offset is (final - drag start) = (25-15, 20-15) = (10, 5)
    expect(moved.x).toBe(20);
    expect(moved.y).toBe(15);

    ctx.undo();
    const reverted = layerById('s1') as ShapeLayer;
    expect(reverted.x).toBe(10);
    expect(reverted.y).toBe(10);
  });

  it('a zero-delta drag (sub-snap jitter) leaves history untouched — no phantom entry', () => {
    const shape: ShapeLayer = {
      id: 's1',
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      color: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    // press inside the rect, then jitter by less than the 0.1mm snap step both
    // moves — every snapped delta is 0, so nothing should be committed
    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 15.02, y: 15.03 }), ctx);
    select.onPointerMove?.(ptr({ x: 14.98, y: 15.01 }), ctx);
    select.onPointerUp?.(ptr({ x: 14.98, y: 15.01 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    const unmoved = layerById('s1') as ShapeLayer;
    expect(unmoved).toMatchObject({ x: 10, y: 10 });
  });

  it('a real move after a zero-delta jitter is still exactly one undo entry', () => {
    const shape: ShapeLayer = {
      id: 's1',
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      color: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 15.02, y: 15.01 }), ctx); // jitter — no entry yet
    select.onPointerMove?.(ptr({ x: 20, y: 18 }), ctx); // real move — opens the entry
    select.onPointerUp?.(ptr({ x: 20, y: 18 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const moved = layerById('s1') as ShapeLayer;
    expect(moved).toMatchObject({ x: 15, y: 13 }); // (20-15, 18-15) = (+5, +3)
  });

  it('a resize drag (8-handle) is exactly one undo entry', () => {
    const shape: ShapeLayer = {
      id: 's1',
      name: 'Rect',
      type: 'shape',
      shape: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      color: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    // 'se' handle sits at the bbox's bottom-right corner (30, 20)
    select.onPointerDown?.(ptr({ x: 30, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 34, y: 24 }), ctx);
    select.onPointerMove?.(ptr({ x: 40, y: 30 }), ctx);
    select.onPointerUp?.(ptr({ x: 40, y: 30 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const resized = layerById('s1') as ShapeLayer;
    expect(resized.width).toBe(30);
    expect(resized.height).toBe(20);
    expect(resized.x).toBe(10); // 'se' keeps the opposite (nw) corner fixed
    expect(resized.y).toBe(10);

    ctx.undo();
    const reverted = layerById('s1') as ShapeLayer;
    expect(reverted).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
  });

  it('a path anchor drag (node edit) is exactly one undo entry', () => {
    const path: PathLayer = {
      id: 'p1',
      name: 'Path',
      type: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [path],
    });
    ctx.select('p1');

    select.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx); // grabs anchor 0 (within ANCHOR_GRAB_PX)
    select.onPointerMove?.(ptr({ x: 5, y: 5 }), ctx);
    select.onPointerMove?.(ptr({ x: 8, y: 8 }), ctx);
    select.onPointerUp?.(ptr({ x: 8, y: 8 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const moved = layerById('p1') as PathLayer;
    expect(moved.points[0]).toEqual({ x: 8, y: 8 });

    ctx.undo();
    const reverted = layerById('p1') as PathLayer;
    expect(reverted.points[0]).toEqual({ x: 0, y: 0 });
  });

  // Handles sit 15mm from the anchor — well outside ANCHOR_GRAB_PX (7px) —
  // so a pointerDown at the handle's own position unambiguously grabs the
  // handle, not the anchor (they'd otherwise overlap: HANDLE_GRAB_PX is 6px
  // and a too-close handle would fall inside the anchor's own grab radius).
  it('a handle drag without Alt mirrors the opposite handle, in one undo entry', () => {
    const path: PathLayer = {
      id: 'p1',
      name: 'Path',
      type: 'path',
      points: [{ x: 20, y: 0, hin: { x: 5, y: 0 }, hout: { x: 35, y: 0 } }],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [path],
    });
    ctx.select('p1');

    select.onPointerDown?.(ptr({ x: 35, y: 0 }), ctx); // grabs hout
    select.onPointerMove?.(ptr({ x: 35, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 35, y: 20 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const moved = layerById('p1') as PathLayer;
    expect(moved.points[0].hout).toEqual({ x: 35, y: 20 });
    // mirrored: reflected about the anchor (20,0)
    expect(moved.points[0].hin).toEqual({ x: 5, y: -20 });
  });

  it('a handle drag WITH Alt breaks mirroring, in one undo entry', () => {
    const path: PathLayer = {
      id: 'p1',
      name: 'Path',
      type: 'path',
      points: [{ x: 20, y: 0, hin: { x: 5, y: 0 }, hout: { x: 35, y: 0 } }],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [path],
    });
    ctx.select('p1');

    select.onPointerDown?.(ptr({ x: 35, y: 0 }), ctx); // grabs hout
    select.onPointerMove?.(ptr({ x: 35, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 35, y: 20 }, { altKey: true }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const moved = layerById('p1') as PathLayer;
    expect(moved.points[0].hout).toEqual({ x: 35, y: 20 });
    expect(moved.points[0].hin).toEqual({ x: 5, y: 0 }); // unchanged — mirror broken
  });
});

// --- multi-move / Alt-duplicate / Shift-constrain (#49) ---------------------

const rectAt = (id: string, x: number, y: number): ShapeLayer => ({
  id,
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: 20,
  height: 10,
  color: 1,
});

// Same 20x10 dims as rectAt, so the rotate/resize geometry below reuses the
// exact same expected numbers as the shape tests (#147: images rotate too).
const imageAt = (id: string, x: number, y: number): ImageLayer => ({
  id,
  name: 'Img',
  type: 'image',
  src: 'data:,',
  x,
  y,
  width: 20,
  height: 10,
});

const gridPattern = (id: string): PatternLayer => ({
  id,
  name: 'Grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: { pitch: 2.54 },
  color: 1,
  x: 0,
  y: 0,
  size: 128.5,
});

describe('select tool — multi-selection move (#49)', () => {
  it('dragging one member moves the whole selection as ONE undo entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside s1
    select.onPointerMove?.(ptr({ x: 20, y: 18 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 22 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 22 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    // both moved by (25-15, 22-15) = (+10, +7)
    expect(layerById('s1')).toMatchObject({ x: 20, y: 17 });
    expect(layerById('s2')).toMatchObject({ x: 60, y: 47 });
    // selection survives the drag
    expect(ctx.selectedIds).toEqual(['s1', 's2']);

    ctx.undo();
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10 });
    expect(layerById('s2')).toMatchObject({ x: 50, y: 40 });
  });

  it('a multi-selection move translates path members (points + handles)', () => {
    const path: PathLayer = {
      id: 'p1',
      name: 'Path',
      type: 'path',
      points: [{ x: 60, y: 60, hout: { x: 65, y: 60 } }],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10), path],
    });
    ctx.selectIds(['s1', 'p1']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const movedPath = layerById('p1') as PathLayer;
    expect(movedPath.points[0]).toEqual({ x: 70, y: 65, hout: { x: 75, y: 65 } });
  });

  // #97 (movable pattern square): pattern members now MOVE with the group —
  // this test previously proved the exact opposite (patterns stayed put).
  it('pattern members move with the group by the same delta, size untouched', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [gridPattern('g1'), rectAt('s1', 10, 10)],
    });
    ctx.selectIds(['g1', 's1']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // hits s1 (tier 1 wins over the pattern)
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 20, y: 15 });
    expect(layerById('g1')).toMatchObject({ x: 10, y: 5, size: 128.5 }); // same (+10, +5) delta
    expect(ctx.selectedIds).toEqual(['g1', 's1']);

    ctx.undo();
    expect(layerById('g1')).toEqual(gridPattern('g1')); // ONE entry restores both
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10 });
  });

  it('a pure click (below threshold) on a member collapses the selection to it', () => {
    const { ctx, getHistory } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['s1']);
    expect(getHistory().past).toHaveLength(0);
  });
});

// #97 (movable pattern square): a SELECTED pattern drags like any layer —
// the unselected-pattern-drag=marquee rule lives in select-marquee.test.ts.
describe('select tool — selected pattern square move (#97)', () => {
  it('a drag on a SELECTED pattern moves its square as ONE undo entry; undo restores', () => {
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [gridPattern('g1')],
    });
    ctx.select('g1');

    select.onPointerDown?.(ptr({ x: 60, y: 60 }), ctx); // inside the square, tier-2 hit
    select.onPointerMove?.(ptr({ x: 70, y: 65 }), ctx);
    select.onPointerMove?.(ptr({ x: 75, y: 70 }), ctx);
    select.onPointerUp?.(ptr({ x: 75, y: 70 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    expect(layerById('g1')).toMatchObject({ x: 15, y: 10, size: 128.5 });
    expect(ctx.selectedIds).toEqual(['g1']);

    ctx.undo();
    expect(layerById('g1')).toEqual(gridPattern('g1'));
  });

  it('Shift axis-constrain applies to a pattern drag too', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [gridPattern('g1')],
    });
    ctx.select('g1');

    select.onPointerDown?.(ptr({ x: 60, y: 60 }), ctx);
    select.onPointerMove?.(ptr({ x: 72, y: 63 }, { shiftKey: true }), ctx); // dx dominates
    select.onPointerUp?.(ptr({ x: 72, y: 63 }, { shiftKey: true }), ctx);

    expect(layerById('g1')).toMatchObject({ x: 12, y: 0 });
  });
});

describe('select tool — Alt-drag duplicate (#49)', () => {
  it('Alt held when the drag crosses the threshold clones the layer above its source and drags the clone', () => {
    const { ctx, getHistory, getBeginGestureCalls } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { altKey: true }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);

    const layers = getHistory().present.layers;
    expect(layers).toHaveLength(2);
    // original stays put, at its original index
    expect(layers[0]).toMatchObject({ id: 's1', x: 10, y: 10 });
    // the clone sits directly above its source with a FRESH id, and the drag
    // was re-targeted to it: moved by (+10, +5)
    const clone = layers[1] as ShapeLayer;
    expect(clone.id).not.toBe('s1');
    expect(clone).toMatchObject({ x: 20, y: 15, width: 20, height: 10 });
    // selection follows the clone
    expect(ctx.selectedIds).toEqual([clone.id]);
    // clone + move is ONE undo entry
    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    ctx.undo();
    expect(getHistory().present.layers).toHaveLength(1);
    expect(getHistory().present.layers[0]).toMatchObject({ id: 's1', x: 10, y: 10 });
  });

  it('Alt-drag on a multi-selection clones each member directly above its source', () => {
    const { ctx, getHistory, getBeginGestureCalls } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const layers = getHistory().present.layers;
    expect(layers).toHaveLength(4);
    expect(layers.map((l) => l.id).filter((id) => id === 's1' || id === 's2')).toEqual([
      's1',
      's2',
    ]);
    // interleaved: [s1, clone-of-s1, s2, clone-of-s2]
    expect(layers[0].id).toBe('s1');
    expect(layers[2].id).toBe('s2');
    const c1 = layers[1] as ShapeLayer;
    const c2 = layers[3] as ShapeLayer;
    // originals untouched, clones moved by (+10, +5)
    expect(layers[0]).toMatchObject({ x: 10, y: 10 });
    expect(layers[2]).toMatchObject({ x: 50, y: 40 });
    expect(c1).toMatchObject({ x: 20, y: 15 });
    expect(c2).toMatchObject({ x: 60, y: 45 });
    expect(new Set([c1.id, c2.id]).size).toBe(2); // fresh, distinct ids
    expect(ctx.selectedIds).toEqual([c1.id, c2.id]);
    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    ctx.undo();
    expect(getHistory().present.layers.map((l) => l.id)).toEqual(['s1', 's2']);
  });

  it('Alt is sampled AT the threshold crossing — pressing it later does not duplicate', () => {
    const { ctx, getHistory } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx); // crossing moment: no Alt
    select.onPointerMove?.(ptr({ x: 30, y: 25 }, { altKey: true }), ctx); // too late
    select.onPointerUp?.(ptr({ x: 30, y: 25 }), ctx);

    expect(getHistory().present.layers).toHaveLength(1);
    expect(getHistory().present.layers[0]).toMatchObject({ id: 's1', x: 25, y: 20 });
  });

  it('an Alt-click that never crosses the threshold duplicates NOTHING and writes NO history', () => {
    const { ctx, getHistory, getBeginGestureCalls } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    // sub-threshold jiggle (< 4 client px from the down point), Alt held throughout
    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { altKey: true }), ctx);
    select.onPointerMove?.(ptr({ x: 16, y: 16 }, { altKey: true }), ctx);
    select.onPointerMove?.(ptr({ x: 15.5, y: 14.5 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 15.5, y: 14.5 }, { altKey: true }), ctx);

    expect(getHistory().present.layers).toHaveLength(1);
    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect(getHistory().present.layers[0]).toMatchObject({ id: 's1', x: 10, y: 10 });
  });
});

// --- rotate handle + rotated resize (#51) -----------------------------------

describe('select tool — rotate handle (#51)', () => {
  // Identity camera: rotateHandleScreenPos returns screen px == mm, so the
  // same point feeds ptr() for both spaces.
  const handleAt = (shape: ShapeLayer): Pt =>
    rotateHandleScreenPos(
      { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
      shape.rotation ?? 0,
      CAMERA,
    );

  it('a rotate drag is exactly ONE undo entry and rotates about the bbox center', () => {
    const shape = rectAt('s1', 10, 10); // bbox center (20, 15)
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    // handle sits 20px above the top-edge midpoint: (20, -10)
    select.onPointerDown?.(ptr(handleAt(shape)), ctx);
    // pointer at 45° below-right of the center: start angle was -90°, so this
    // streams through +90+45 … final position is due east → delta +90°
    select.onPointerMove?.(ptr({ x: 30, y: -5 }), ctx);
    select.onPointerMove?.(ptr({ x: 45, y: 15 }), ctx); // atan2(0, 25) = 0°
    select.onPointerUp?.(ptr({ x: 45, y: 15 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    expect((layerById('s1') as ShapeLayer).rotation).toBe(90);

    ctx.undo();
    expect((layerById('s1') as ShapeLayer).rotation).toBeUndefined();
  });

  it('Shift snaps to 45° increments measured FROM the drag-start rotation', () => {
    const shape: ShapeLayer = { ...rectAt('s1', 10, 10), rotation: 30 };
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    // The handle direction is always (rotation − 90°) from the center, so the
    // start pointer angle here is −60°. Move to −10° (delta 50°) with Shift:
    // snapped to +45° FROM the start rotation → 30 + 45 = 75, not a multiple
    // of 45 from zero.
    const center = { x: 20, y: 15 };
    const r = 25;
    const rad = (-10 * Math.PI) / 180;
    const end = { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) };
    select.onPointerDown?.(ptr(handleAt(shape)), ctx);
    select.onPointerMove?.(ptr(end, { shiftKey: true }), ctx);
    select.onPointerUp?.(ptr(end, { shiftKey: true }), ctx);

    expect(getHistory().past).toHaveLength(1);
    expect((layerById('s1') as ShapeLayer).rotation).toBe(75);
  });

  it('a pure click on the rotate handle writes NO history and keeps the selection', () => {
    const shape = rectAt('s1', 10, 10);
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    const h = handleAt(shape);
    select.onPointerDown?.(ptr(h), ctx);
    select.onPointerMove?.(ptr({ x: h.x + 1, y: h.y + 1 }), ctx); // sub-threshold jiggle
    select.onPointerUp?.(ptr({ x: h.x + 1, y: h.y + 1 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect((layerById('s1') as ShapeLayer).rotation).toBeUndefined();
    expect(ctx.selectedIds).toEqual(['s1']);
  });

  it('a HIDDEN selected layer exposes no grab targets — its invisible knob must not eat clicks', () => {
    // The chrome pass (selectionBboxes) skips hidden layers, so no handle is
    // drawn — pressing where the rotate knob WOULD be must fall through to
    // the empty-space path instead of rotating an invisible layer.
    const shape: ShapeLayer = { ...rectAt('s1', 10, 10), hidden: true };
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    const h = handleAt(shape);
    select.onPointerDown?.(ptr(h), ctx);
    select.onPointerUp?.(ptr(h), ctx);

    expect(getHistory().past).toHaveLength(0);
    expect((layerById('s1') as ShapeLayer).rotation).toBeUndefined();
    expect(ctx.selectedIds).toEqual([]); // empty-space click deselected
  });

  // #147: images joined canRotate/layerRotation, so a selected image now gets
  // the same rotate handle + drag contract as a shape — same geometry as the
  // "rotates about the bbox center" shape test above, applied to an image.
  it('an image gets a rotate handle too; drag updates rotation, one undo entry', () => {
    const image = imageAt('i1', 10, 10); // bbox center (20, 15)
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [image],
    });
    ctx.select('i1');

    const handleAt = (layer: ImageLayer): Pt =>
      rotateHandleScreenPos(
        { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
        layer.rotation ?? 0,
        CAMERA,
      );

    select.onPointerDown?.(ptr(handleAt(image)), ctx);
    select.onPointerMove?.(ptr({ x: 30, y: -5 }), ctx);
    select.onPointerMove?.(ptr({ x: 45, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 45, y: 15 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    expect((layerById('i1') as ImageLayer).rotation).toBe(90);

    ctx.undo();
    expect((layerById('i1') as ImageLayer).rotation).toBeUndefined();
  });
});

describe('select tool — rotated-shape resize (#51, math from #48)', () => {
  it('resizes a 90°-rotated shape from its ROTATED se handle, one undo entry', () => {
    const shape: ShapeLayer = { ...rectAt('s1', 10, 10), rotation: 90 };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [shape],
    });
    ctx.select('s1');

    // raw se corner (30, 20) rotated 90° cw about the center (20, 15) lands
    // at (15, 25) — the handle rides the oriented chrome, not the AABB.
    select.onPointerDown?.(ptr({ x: 15, y: 25 }), ctx);
    // screen drag (0, +5) → local frame (+5, 0): width grows by 5, and the
    // anchored nw corner stays visually fixed via resizeRotatedRect (#48)
    select.onPointerMove?.(ptr({ x: 15, y: 30 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 30 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const resized = layerById('s1') as ShapeLayer;
    expect(resized).toMatchObject({ x: 7.5, y: 12.5, width: 25, height: 10, rotation: 90 });

    ctx.undo();
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
  });

  // #147: images resize through the same resizeRotatedRect path as shapes —
  // identical geometry to the shape test above, applied to an image.
  it('resizes a 90°-rotated image from its ROTATED se handle, one undo entry', () => {
    const image: ImageLayer = { ...imageAt('i1', 10, 10), rotation: 90 };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [image],
    });
    ctx.select('i1');

    select.onPointerDown?.(ptr({ x: 15, y: 25 }), ctx);
    select.onPointerMove?.(ptr({ x: 15, y: 30 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 30 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    const resized = layerById('i1') as ImageLayer;
    expect(resized).toMatchObject({ x: 7.5, y: 12.5, width: 25, height: 10, rotation: 90 });

    ctx.undo();
    expect(layerById('i1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
  });
});

describe('select tool — Shift axis-constrain (#49)', () => {
  it('constrains the move to the dominant axis', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    // dx=10 dy=3 → x dominates, y is pinned
    select.onPointerMove?.(ptr({ x: 25, y: 18 }, { shiftKey: true }), ctx);
    expect(layerById('s1')).toMatchObject({ x: 20, y: 10 });
    // dx=3 dy=13 → y dominates now; the axis re-evaluates live mid-drag
    select.onPointerMove?.(ptr({ x: 18, y: 28 }, { shiftKey: true }), ctx);
    expect(layerById('s1')).toMatchObject({ x: 10, y: 23 });
    select.onPointerUp?.(ptr({ x: 18, y: 28 }, { shiftKey: true }), ctx);
  });

  it('releasing Shift mid-drag returns to free movement', () => {
    const { ctx, getHistory, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 18 }, { shiftKey: true }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 18 }), ctx); // Shift released
    select.onPointerUp?.(ptr({ x: 25, y: 18 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 20, y: 13 }); // full (+10, +3)
    expect(getHistory().past).toHaveLength(1); // still one entry
  });
});

describe('select tool — replace composition (#49 review)', () => {
  it('the Alt-crossing move issues exactly ONE replace (clone + move composed)', () => {
    // The real Editor's ctx.doc getter reads a ref that only re-syncs after
    // React renders — a second replace in the same event would rebuild from
    // the pre-clone layer list and silently drop the clones. Guard the
    // invariant: clone insertion and the move are one composed replacement.
    const { ctx, getReplaceCalls, getHistory } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { altKey: true }), ctx);
    expect(getReplaceCalls()).toBe(0);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    expect(getReplaceCalls()).toBe(1);
    expect(getHistory().present.layers).toHaveLength(2);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
  });

  it('one snapped gesture delta applies to every member — off-grid spacing is preserved', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10.03, 10), rectAt('s2', 50.08, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25.06, y: 15 }), ctx); // dx 10.06 → snaps to 10.1
    select.onPointerUp?.(ptr({ x: 25.06, y: 15 }), ctx);

    // both members moved by the SAME snapped delta (10.1, 0) — per-member
    // absolute re-snapping would have shifted them by different amounts
    expect(layerById('s1')).toMatchObject({ x: 20.13, y: 10 });
    expect(layerById('s2')).toMatchObject({ x: 60.18, y: 40 });
  });
});

// Combined-bbox multi-resize (#52). rectAt makes 20×10 rects, so s1 (10,10)
// + s2 (40,30) give a combined bbox of (10,10,50,30): se corner (60,40),
// nw anchor (10,10), centre (35,25). The identity camera keeps handle grabs
// at the literal mm corners.
describe('select tool — multi-resize via the combined bbox (#52)', () => {
  const twoRects = () =>
    makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10, 10), rectAt('s2', 40, 30)],
    });

  it('dragging the se corner scales BOTH members uniformly about the nw corner, ONE undo entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    // corner (60,40), anchor (10,10), diagonal v0 = (50,30). Dragging by
    // 0.5·v0 = (+25,+15) projects to factor 1.5 exactly.
    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 70, y: 46 }), ctx); // mid-drag stream
    select.onPointerMove?.(ptr({ x: 85, y: 55 }), ctx);
    select.onPointerUp?.(ptr({ x: 85, y: 55 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    // s1 touches the anchor so it grows in place; s2's offset from the anchor
    // scales by the same 1.5 — the group stays rigid.
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 30, height: 15 });
    expect(layerById('s2')).toMatchObject({ x: 55, y: 40, width: 30, height: 15 });
    // selection survives the gesture (no collapse — that's a move-click rule)
    expect(ctx.selectedIds).toEqual(['s1', 's2']);

    ctx.undo();
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
    expect(layerById('s2')).toMatchObject({ x: 40, y: 30, width: 20, height: 10 });
  });

  it('Alt scales about the combined bbox CENTRE', () => {
    const { ctx, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    // centre anchor (35,25): corner offset v0 = (25,15). The same (+25,+15)
    // drag now doubles the offset → factor 2.
    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 85, y: 55 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 85, y: 55 }, { altKey: true }), ctx);

    expect(layerById('s1')).toMatchObject({ x: -15, y: -5, width: 40, height: 20 });
    expect(layerById('s2')).toMatchObject({ x: 45, y: 35, width: 40, height: 20 });
  });

  it('Shift is a NO-OP — identical result to the plain drag (aspect locked by construction)', () => {
    const { ctx, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 85, y: 55 }, { shiftKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 85, y: 55 }, { shiftKey: true }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 30, height: 15 });
    expect(layerById('s2')).toMatchObject({ x: 55, y: 40, width: 30, height: 15 });
  });

  it('patterns in the selection are unaffected and stay selected', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [gridPattern('g1'), rectAt('s1', 10, 10), rectAt('s2', 40, 30)],
    });
    ctx.selectIds(['g1', 's1', 's2']);

    // the pattern's bbox is its own 128.5mm square at the origin (#96), so
    // the combined bbox is that square; its se corner is (128.5,128.5) and
    // dragging by 0.5·v0 projects to factor 1.5 again (anchor stays (0,0)).
    select.onPointerDown?.(ptr({ x: 128.5, y: 128.5 }), ctx);
    select.onPointerMove?.(ptr({ x: 192.75, y: 192.75 }), ctx);
    select.onPointerUp?.(ptr({ x: 192.75, y: 192.75 }), ctx);

    expect(layerById('g1')).toEqual(gridPattern('g1')); // untouched
    expect(layerById('s1')).toMatchObject({ x: 15, y: 15, width: 30, height: 15 });
    expect(layerById('s2')).toMatchObject({ x: 60, y: 45, width: 30, height: 15 });
    expect(ctx.selectedIds).toEqual(['g1', 's1', 's2']);
  });

  it('edge midpoints offer NO handle for a multi-selection — corner-only by design', () => {
    const { ctx, getHistory, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    // the 'n' edge midpoint of the combined bbox, (35,10), is empty canvas:
    // a press there must fall through to the empty-space path (deselect +
    // marquee), never start a scale gesture.
    select.onPointerDown?.(ptr({ x: 35, y: 10 }), ctx);
    select.onPointerMove?.(ptr({ x: 35, y: 14 }), ctx);
    select.onPointerUp?.(ptr({ x: 35, y: 14 }), ctx);

    expect(getHistory().past).toHaveLength(0);
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
    expect(layerById('s2')).toMatchObject({ x: 40, y: 30, width: 20, height: 10 });
    expect(ctx.selectedIds).toEqual([]); // the empty-space click deselected
  });

  it('the shared factor bottoms out at the GROUP floor — members stay rigid at min size', () => {
    const { ctx, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    // Drag the se corner all the way onto the anchor: the raw projected
    // factor is 0, but the group floor is MIN_RESIZE_MM / 10 (the smallest
    // member dim, height 10) = 0.05 — ONE factor for both members, so their
    // relative spacing scales by exactly 0.05 too (rigidity at the clamp).
    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 10, y: 10 }), ctx);
    select.onPointerUp?.(ptr({ x: 10, y: 10 }), ctx);

    const s1 = layerById('s1') as ShapeLayer;
    const s2 = layerById('s2') as ShapeLayer;
    expect(s1.width).toBeCloseTo(1);
    expect(s1.height).toBeCloseTo(0.5); // exactly the MIN_RESIZE_MM floor
    expect(s2.width).toBeCloseTo(1);
    expect(s2.height).toBeCloseTo(0.5);
    expect(s1.x).toBeCloseTo(10);
    expect(s1.y).toBeCloseTo(10);
    expect(s2.x).toBeCloseTo(11.5); // 10 + 30·0.05
    expect(s2.y).toBeCloseTo(11); // 10 + 20·0.05
  });

  it('a group already thinner than the min-size floor cannot be ENLARGED by a shrink drag', () => {
    // Two 10mm vertical line paths 0.1mm apart: the combined bbox is 0.1×10,
    // so the raw width floor would be MIN_RESIZE_MM/0.1 = 5 — without the
    // identity cap, ANY drag (including this shrink attempt) would blow the
    // group up 5×. Capped at 1 the shrink is simply refused: no change, no
    // history entry.
    const line = (id: string, x: number): PathLayer => ({
      id,
      name: id,
      type: 'path',
      points: [
        { x, y: 10 },
        { x, y: 20 },
      ],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    });
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [line('p1', 10), line('p2', 10.1)],
    });
    ctx.selectIds(['p1', 'p2']);

    // se corner of the combined bbox is (10.1, 20); drag toward the anchor
    select.onPointerDown?.(ptr({ x: 10.1, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 6, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 6, y: 15 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect((layerById('p1') as PathLayer).points).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect((layerById('p2') as PathLayer).points).toEqual([
      { x: 10.1, y: 10 },
      { x: 10.1, y: 20 },
    ]);

    // growing is still allowed — the cap only forbids shrinking below the floor
    select.onPointerDown?.(ptr({ x: 10.1, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 14.1, y: 25 }), ctx);
    select.onPointerUp?.(ptr({ x: 14.1, y: 25 }), ctx);
    expect(getBeginGestureCalls()).toBe(1);
    expect((layerById('p1') as PathLayer).points[1].y).toBeGreaterThan(20);
  });

  it('a sub-threshold press or a perpendicular drag writes NO history (lazy undo)', () => {
    const { ctx, getHistory, getBeginGestureCalls, layerById } = twoRects();
    ctx.selectIds(['s1', 's2']);

    // sub-threshold jitter on the corner: below DRAG_THRESHOLD_PX, gated out
    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 62, y: 41 }), ctx);
    select.onPointerUp?.(ptr({ x: 62, y: 41 }), ctx);
    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);

    // perpendicular drag: past the threshold but orthogonal to the diagonal
    // v0 = (50,30), so the projected factor stays exactly 1 — still no entry
    select.onPointerDown?.(ptr({ x: 60, y: 40 }), ctx);
    select.onPointerMove?.(ptr({ x: 57, y: 45 }), ctx); // delta (-3,+5) ⊥ (50,30)
    select.onPointerUp?.(ptr({ x: 57, y: 45 }), ctx);
    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
    expect(layerById('s2')).toMatchObject({ x: 40, y: 30, width: 20, height: 10 });
  });
});

// Guide snapping (#55): wires #53's layered snap (grid first, guides win
// ties) into move/resize. The identity CAMERA (pxPerMm: 1) makes the
// select-tool's zoom-scaled catch radius (GUIDE_SNAP_PX / pxPerMm) exactly
// 8mm here — every guide below is placed within that radius of the candidate
// it's meant to catch, and every "grid wins" case places the guide well
// outside it.
describe('select tool — guide snapping (#55)', () => {
  const vGuide = (position: number, hidden = false): Guide => ({
    id: `g-${position}`,
    orientation: 'vertical',
    position,
    hidden,
  });
  const hGuide = (position: number, hidden = false): Guide => ({
    id: `h-${position}`,
    orientation: 'horizontal',
    position,
    hidden,
  });

  it('move: a guide within range overrides the grid — guides win ties', () => {
    // Left edge (x=10) moves to 15 on the raw drag; the grid would leave it
    // there (already a 0.1 multiple), but a guide at 15.05 is in range and
    // wins the tie, so the layer lands on the guide instead of the grid line.
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(15.05)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    // dx=5 (clears the 4px drag threshold) -> grid alone would give x=15
    select.onPointerMove?.(ptr({ x: 20, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 20, y: 15 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 15.05, y: 10 });
  });

  it('move: a guide outside the catch radius is ignored — falls back to the grid', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(50)], // 35mm+ away from every candidate — well outside the 8mm radius
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 20.02, y: 15 }), ctx); // dx=5.02 -> grid gives 5.0
    select.onPointerUp?.(ptr({ x: 20.02, y: 15 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 15, y: 10 });
  });

  it('move: a hidden guide never snaps', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(15.05, true)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 20, y: 15 }), ctx); // dx=5 -> would catch 15.05 if visible
    select.onPointerUp?.(ptr({ x: 20, y: 15 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 15, y: 10 }); // grid only
  });

  it('move: a drag that nets zero effective change after guide-snap leaves history untouched', () => {
    // Guide sits exactly at the layer's current left edge (x=10). The raw
    // drag (dx=5, clearing the 4px threshold) would open a real
    // grid-snapped entry on its own, but the guide pulls the edge straight
    // back to the pointerdown position, so the NET change is zero and no
    // undo entry may open.
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(10)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 20, y: 15 }), ctx); // dx=5 -> grid alone would give x=15
    select.onPointerUp?.(ptr({ x: 20, y: 15 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10 });
  });

  it('move: Shift axis-lock keeps a guide on the locked axis from injecting movement', () => {
    // dx dominates so Shift pins y to 0; a horizontal guide sitting right
    // where the (unmoved) top edge already is must NOT be allowed to nudge y.
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [hGuide(10.3)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 15.2 }, { shiftKey: true }), ctx); // dx=10 dy=0.2 -> x dominates
    select.onPointerUp?.(ptr({ x: 25, y: 15.2 }, { shiftKey: true }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 20, y: 10 }); // y pinned, guide ignored
  });

  it('multi-move: a caught guide still applies ONE shared delta to every member', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(44.8)],
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    // combined bbox is (10,10,60,40): edges 10/70, centre 40. Raw dx=5
    // (clears the 4px threshold) moves the centre to 45, 0.2mm from the
    // guide — caught, delta -0.2.
    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside s1
    select.onPointerMove?.(ptr({ x: 20, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 20, y: 15 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 14.8, y: 10 });
    expect(layerById('s2')).toMatchObject({ x: 54.8, y: 40 });
  });

  it('resize: the "se" free edges snap to guides; the nw anchor stays exact', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(42.3)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    // 'se' handle at (30, 20); dragging to (42, 25) puts the raw right edge
    // at 42, 0.3mm from the guide.
    select.onPointerDown?.(ptr({ x: 30, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 42, y: 25 }), ctx);
    select.onPointerUp?.(ptr({ x: 42, y: 25 }), ctx);

    const resized = layerById('s1') as ShapeLayer;
    expect(resized.x).toBe(10); // anchor (nw) untouched
    expect(resized.y).toBe(10);
    expect(resized.width).toBeCloseTo(32.3, 6); // right edge lands on the guide (42.3)
    expect(resized.height).toBe(15);
  });

  it('resize: an off-grid origin with NO guide in range is untouched — bit-identical to the pre-#55 baseline', () => {
    // Regression for a review finding: computing the free edge's size from
    // the RAW (unsnapped) anchor while returning the INDEPENDENTLY-rounded
    // anchor would make x + width land short of the intended edge whenever
    // the origin isn't already grid-aligned (numeric inspectors allow one).
    // With no guide in range, resizeSnapPatch must not touch x/width at all.
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [],
      layers: [rectAt('s1', 10.03, 10)],
    });
    ctx.select('s1');

    // 'se' handle at (30.03, 20); dx=5 clears the 4px threshold.
    select.onPointerDown?.(ptr({ x: 30.03, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 35.03, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 35.03, y: 20 }), ctx);

    const resized = layerById('s1') as ShapeLayer;
    expect(resized.x).toBe(10); // snap(10.03), same as before #55
    expect(resized.width).toBe(25); // snap(25) — untouched, NOT 24.97
    expect(resized.x + resized.width).toBe(35); // edges add up
  });

  it('resize: an off-grid origin with a guide in range still lands the edge exactly on the guide', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(42.3)],
      layers: [rectAt('s1', 10.03, 10)],
    });
    ctx.select('s1');

    // 'se' handle at (30.03, 20); dx=12 puts the raw right edge at 42.03,
    // 0.27mm from the guide.
    select.onPointerDown?.(ptr({ x: 30.03, y: 20 }), ctx);
    select.onPointerMove?.(ptr({ x: 42.03, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 42.03, y: 20 }), ctx);

    const resized = layerById('s1') as ShapeLayer;
    // width must be derived from the SAME (rounded) x that's returned, so
    // the actual right edge lands exactly on the guide, not 0.03mm short.
    expect(resized.x + resized.width).toBeCloseTo(42.3, 6);
  });

  it('resize: the "nw" free edges snap to guides; the se anchor stays exact', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(7.2)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    // 'nw' handle at (10, 10); dragging to (5, 10) — clearing the 4px
    // threshold — puts the raw left edge at 5, 2.2mm from the guide (within
    // the 8mm radius). The se corner (30, 20) must stay exactly put.
    select.onPointerDown?.(ptr({ x: 10, y: 10 }), ctx);
    select.onPointerMove?.(ptr({ x: 5, y: 10 }), ctx);
    select.onPointerUp?.(ptr({ x: 5, y: 10 }), ctx);

    const resized = layerById('s1') as ShapeLayer;
    expect(resized.x).toBeCloseTo(7.2, 6); // left edge lands on the guide
    expect(resized.width).toBeCloseTo(22.8, 6);
    expect(resized.x + resized.width).toBeCloseTo(30, 6); // se anchor unmoved
    expect(resized.y).toBe(10);
    expect(resized.height).toBe(10);
  });

  it('resize: a drag that nets zero effective change after guide-snap leaves history untouched', () => {
    // Guide sits exactly at the layer's current right edge (x=30). Dragging
    // the se handle out a little would open a real grid-snapped entry on its
    // own, but the guide pulls the edge straight back to 30 — net zero.
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
      guides: [vGuide(30)],
      layers: [rectAt('s1', 10, 10)],
    });
    ctx.select('s1');

    select.onPointerDown?.(ptr({ x: 30, y: 20 }), ctx);
    // dx=5 (clears the 4px threshold) -> grid alone would give width 25
    select.onPointerMove?.(ptr({ x: 35, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 35, y: 20 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect(layerById('s1')).toMatchObject({ x: 10, y: 10, width: 20, height: 10 });
  });
});
