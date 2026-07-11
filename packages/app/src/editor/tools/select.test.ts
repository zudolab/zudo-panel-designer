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
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import type { PanelDims, ToolContext, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';

const CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 }; // identity: screen px == mm
const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let selectedId: string | null = null;
  let beginGestureCalls = 0;

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
    get selectedId() {
      return selectedId;
    },
    get selectedLayer() {
      return history.present.layers.find((l) => l.id === selectedId) ?? null;
    },
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: (next) => {
      history = coreCommit(history, next);
    },
    replace: (next) => {
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
      selectedId = id;
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
