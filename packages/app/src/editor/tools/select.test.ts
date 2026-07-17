// Proves the select tool's own contract, not just the core history reducer
// (already covered in @zpd/core's history.test.ts): a full drag/resize/
// node-edit gesture — however many pointermoves it produces — collapses into
// exactly ONE undo entry, and the tool correctly forwards Alt to
// movePathHandle's mirror flag. Drives the tool's onPointerDown/Move/Up
// handlers directly against a small ToolContext harness backed by the real
// core history functions (not a mock), so this exercises the real gesture
// wiring select.tsx performs.
import { beforeEach, describe, expect, it } from 'vitest';
import '../tools/select'; // registers 'select' as a side effect
import { getTool } from '../registry/tools';
import {
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  redo as coreRedo,
  replace as coreReplace,
  undo as coreUndo,
  type DocState,
  type HistoryState,
  type Layer,
  type PathLayer,
  type PatternLayer,
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
import { rotateHandleScreenPos } from '../renderer';
import type { PanelDims, ToolContext, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';

const CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 }; // identity: screen px == mm
const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let selectedIds: readonly string[] = [];
  let beginGestureCalls = 0;
  let replaceCalls = 0;

  // Same derivation the Editor performs: selectedIds normalized against the
  // live doc; selectedId/selectedLayer non-null only for exactly one id.
  const readSelectedIds = () => normalizeSelectedIds(selectedIds, history.present.layers);
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
      return history.present.layers.find((l) => l.id === readSelectedId()) ?? null;
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
    beginGesture: () => {
      beginGestureCalls += 1;
      history = coreBeginGesture(history);
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

const gridPattern = (id: string): PatternLayer => ({
  id,
  name: 'Grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: { pitch: 2.54 },
  color: 1,
});

describe('select tool — multi-selection move (#49)', () => {
  it('dragging one member moves the whole selection as ONE undo entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
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
      layers: [rectAt('s1', 10, 10), path],
    });
    ctx.selectIds(['s1', 'p1']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const movedPath = layerById('p1') as PathLayer;
    expect(movedPath.points[0]).toEqual({ x: 70, y: 65, hout: { x: 75, y: 65 } });
  });

  it('patterns in the selection are skipped — they stay put and stay selected', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
      layers: [gridPattern('g1'), rectAt('s1', 10, 10)],
    });
    ctx.selectIds(['g1', 's1']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // hits s1 (patterns aren't hit-testable)
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    expect(layerById('s1')).toMatchObject({ x: 20, y: 15 });
    expect(layerById('g1')).toEqual(gridPattern('g1')); // untouched
    expect(ctx.selectedIds).toEqual(['g1', 's1']);
  });

  it('a pure click (below threshold) on a member collapses the selection to it', () => {
    const { ctx, getHistory } = makeHarness({
      panelHp: 12,
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['s1']);
    expect(getHistory().past).toHaveLength(0);
  });
});

describe('select tool — Alt-drag duplicate (#49)', () => {
  it('Alt held when the drag crosses the threshold clones the layer above its source and drags the clone', () => {
    const { ctx, getHistory, getBeginGestureCalls } = makeHarness({
      panelHp: 12,
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
      layers: [rectAt('s1', 10, 10), rectAt('s2', 50, 40)],
    });
    ctx.selectIds(['s1', 's2']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const layers = getHistory().present.layers;
    expect(layers).toHaveLength(4);
    expect(layers.map((l) => l.id).filter((id) => id === 's1' || id === 's2')).toEqual(['s1', 's2']);
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
    const { ctx, getHistory, layerById } = makeHarness({ panelHp: 12, layers: [shape] });
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

  it('image layers get NO rotate handle — the grab point is plain empty space', () => {
    const image: Layer = {
      id: 'i1',
      name: 'Img',
      type: 'image',
      src: 'data:,',
      x: 10,
      y: 10,
      width: 20,
      height: 10,
    };
    const { ctx, getHistory } = makeHarness({ panelHp: 12, layers: [image] });
    ctx.select('i1');

    // where a rotate handle WOULD sit for this bbox: (20, -10) — pressing
    // there must fall through to the empty-space path (deselect + marquee arm)
    select.onPointerDown?.(ptr({ x: 20, y: -10 }), ctx);
    select.onPointerUp?.(ptr({ x: 20, y: -10 }), ctx);

    expect(ctx.selectedIds).toEqual([]);
    expect(getHistory().past).toHaveLength(0);
  });
});

describe('select tool — rotated-shape resize (#51, math from #48)', () => {
  it('resizes a 90°-rotated shape from its ROTATED se handle, one undo entry', () => {
    const shape: ShapeLayer = { ...rectAt('s1', 10, 10), rotation: 90 };
    const { ctx, getHistory, getBeginGestureCalls, layerById } = makeHarness({
      panelHp: 12,
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
});

describe('select tool — Shift axis-constrain (#49)', () => {
  it('constrains the move to the dominant axis', () => {
    const { ctx, layerById } = makeHarness({
      panelHp: 12,
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
