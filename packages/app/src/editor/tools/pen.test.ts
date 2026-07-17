// Proves the pen tool's pure draft-state transitions directly (per the
// editor/README contract, module-scope gesture state should stay testable
// without a canvas), plus the tool's headline guarantee: however many
// clicks/drags build up a path, finishing it (close, Enter, or cancel) is
// exactly one document mutation — one undo entry, or none at all on cancel.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCornerAnchor,
  buildClosedPathLayer,
  buildOpenPathLayer,
  canClosePath,
  canFinishOpen,
  dragLastAnchorHandle,
  isNearFirstAnchor,
  setCursor,
  type PenDraft,
} from './pen';
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
  type PathLayer,
  type Pt,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
import type { PanelDims, ToolContext, ToolKeyEvent, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';

const CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 }; // identity: screen px == mm
const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness() {
  let history: HistoryState<DocState> = createHistory({ panelHp: 12, layers: [] });
  let selectedIds: readonly string[] = [];
  let activeToolId = 'pen';
  let repaintCalls = 0;

  // Same derivation the Editor performs (see Editor.tsx / selection.ts).
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
      history = coreReplace(history, next);
    },
    beginGesture: () => {
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
    setActiveTool: (id) => {
      activeToolId = id;
    },
    requestRepaint: () => {
      repaintCalls += 1;
    },
    openDialog: () => {},
    closeDialog: () => {},
  };

  return {
    ctx,
    getHistory: () => history,
    getSelectedId: () => readSelectedId(),
    getActiveToolId: () => activeToolId,
    getRepaintCalls: () => repaintCalls,
    layerById: (id: string) => history.present.layers.find((l) => l.id === id) as PathLayer,
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

function key(k: string): ToolKeyEvent {
  return {
    key: k,
    code: k,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => {},
  };
}

const pen = getTool('pen')!;

beforeEach(() => {
  // module-scope draft state — reset between tests defensively (no document
  // in the node test environment, so onDeactivate's DOM cleanup is a no-op)
  pen.onDeactivate?.({} as ToolContext);
});

describe('pen tool — pure draft-state transitions', () => {
  it('addCornerAnchor snaps to the 0.1mm grid and starts a draft from null', () => {
    const draft = addCornerAnchor(null, { x: 10.03, y: 20.07 });
    expect(draft.points).toEqual([{ x: 10, y: 20.1 }]);
    expect(draft.cursorMm).toBeNull();
  });

  it('addCornerAnchor appends without mutating the previous draft', () => {
    const first = addCornerAnchor(null, { x: 0, y: 0 });
    const second = addCornerAnchor(first, { x: 10, y: 0 });
    expect(first.points).toHaveLength(1); // original untouched
    expect(second.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('dragLastAnchorHandle mirrors hout/hin around the last anchor', () => {
    const draft = addCornerAnchor(null, { x: 10, y: 10 });
    const dragged = dragLastAnchorHandle(draft, { x: 20, y: 10 });
    expect(dragged.points[0]).toEqual({
      x: 10,
      y: 10,
      hout: { x: 20, y: 10 },
      hin: { x: 0, y: 10 }, // reflected: 10*2-20=0, 10*2-10=10
    });
  });

  it('dragLastAnchorHandle is a no-op on an empty draft', () => {
    const empty: PenDraft = { points: [], cursorMm: null };
    expect(dragLastAnchorHandle(empty, { x: 1, y: 1 })).toBe(empty);
  });

  it('setCursor updates only cursorMm', () => {
    const draft = addCornerAnchor(null, { x: 0, y: 0 });
    const withCursor = setCursor(draft, { x: 5, y: 5 });
    expect(withCursor.points).toBe(draft.points);
    expect(withCursor.cursorMm).toEqual({ x: 5, y: 5 });
  });

  it('isNearFirstAnchor requires >=3 anchors even inside the threshold', () => {
    let draft = addCornerAnchor(null, { x: 0, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 0 });
    // only 2 anchors — a click back on anchor 0 must NOT count as a close
    expect(isNearFirstAnchor(draft, { x: 1, y: 1 }, (p) => p)).toBe(false);
  });

  it('isNearFirstAnchor is true within the screen-space threshold once >=3 anchors exist', () => {
    let draft = addCornerAnchor(null, { x: 0, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 10 });
    expect(isNearFirstAnchor(draft, { x: 3, y: 3 }, (p) => p, 9)).toBe(true);
    expect(isNearFirstAnchor(draft, { x: 20, y: 20 }, (p) => p, 9)).toBe(false);
  });

  it('canClosePath / canFinishOpen thresholds', () => {
    expect(canClosePath(null)).toBe(false);
    let draft: PenDraft | null = addCornerAnchor(null, { x: 0, y: 0 });
    expect(canFinishOpen(draft)).toBe(false); // 1 point
    expect(canClosePath(draft)).toBe(false);
    draft = addCornerAnchor(draft, { x: 1, y: 0 });
    expect(canFinishOpen(draft)).toBe(true); // 2 points
    expect(canClosePath(draft)).toBe(false);
    draft = addCornerAnchor(draft, { x: 1, y: 1 });
    expect(canClosePath(draft)).toBe(true); // 3 points
  });

  it('buildClosedPathLayer fills gold with no stroke', () => {
    let draft = addCornerAnchor(null, { x: 0, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 10 });
    const layer = buildClosedPathLayer(draft);
    expect(layer).toMatchObject({
      closed: true,
      fill: 1,
      stroke: null,
      strokeWidth: 0,
      points: draft.points,
    });
  });

  it('buildOpenPathLayer strokes gold at 0.6mm with no fill', () => {
    let draft = addCornerAnchor(null, { x: 0, y: 0 });
    draft = addCornerAnchor(draft, { x: 10, y: 0 });
    const layer = buildOpenPathLayer(draft);
    expect(layer).toMatchObject({
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 0.6,
      points: draft.points,
    });
  });
});

describe('pen tool — gestures commit exactly one undo entry', () => {
  it('click x3 + click-near-first-anchor closes the path, selects it, and switches to select', () => {
    const { ctx, getHistory, getSelectedId, getActiveToolId, getRepaintCalls, layerById } =
      makeHarness();

    pen.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerDown?.(ptr({ x: 10, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 10, y: 0 }), ctx);
    pen.onPointerDown?.(ptr({ x: 10, y: 10 }), ctx);
    pen.onPointerUp?.(ptr({ x: 10, y: 10 }), ctx);
    // 4th down lands within 9px of the first anchor -> closes instead of adding a 4th point
    pen.onPointerDown?.(ptr({ x: 2, y: 2 }), ctx);

    // each of the 3 anchor placements plus the close all ask for a repaint,
    // so renderDraft/the hint bar stay in sync with the module-scope draft
    expect(getRepaintCalls()).toBe(4);
    expect(getHistory().past).toHaveLength(1); // one commit for the whole draw
    expect(getHistory().present.layers).toHaveLength(1);
    const layer = layerById(getSelectedId()!);
    expect(layer).toMatchObject({ closed: true, fill: 1, stroke: null });
    expect(layer.points).toHaveLength(3);
    expect(getActiveToolId()).toBe('select');
  });

  it('click-drag makes a smooth anchor; Enter finishes an open stroked path', () => {
    const { ctx, getHistory, getSelectedId, layerById } = makeHarness();

    pen.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerMove?.(ptr({ x: 5, y: 0 }), ctx); // drags a handle out of anchor 0
    pen.onPointerUp?.(ptr({ x: 5, y: 0 }), ctx);
    pen.onPointerDown?.(ptr({ x: 20, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 20, y: 0 }), ctx);

    const handled = pen.onKeyDown?.(key('Enter'), ctx);
    expect(handled).toBe(true);

    expect(getHistory().past).toHaveLength(1);
    const layer = layerById(getSelectedId()!);
    expect(layer).toMatchObject({ closed: false, fill: null, stroke: 1, strokeWidth: 0.6 });
    expect(layer.points[0]).toEqual({ x: 0, y: 0, hout: { x: 5, y: 0 }, hin: { x: -5, y: 0 } });
  });

  it('Enter with fewer than 2 anchors is handled but commits nothing', () => {
    const { ctx, getHistory } = makeHarness();
    pen.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 0, y: 0 }), ctx);

    const handled = pen.onKeyDown?.(key('Enter'), ctx);
    expect(handled).toBe(true);
    expect(getHistory().past).toHaveLength(0);
  });

  it('Escape cancels the draft without committing, and the next draft starts fresh', () => {
    const { ctx, getHistory, getSelectedId, layerById } = makeHarness();
    pen.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerDown?.(ptr({ x: 10, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 10, y: 0 }), ctx);

    const handled = pen.onKeyDown?.(key('Escape'), ctx);
    expect(handled).toBe(true);
    expect(getHistory().past).toHaveLength(0);

    // fresh draft after cancel: 2 new clicks then Enter -> exactly those 2
    // points, proving the cancelled anchors were discarded, not carried over
    pen.onPointerDown?.(ptr({ x: 50, y: 50 }), ctx);
    pen.onPointerUp?.(ptr({ x: 50, y: 50 }), ctx);
    pen.onPointerDown?.(ptr({ x: 60, y: 50 }), ctx);
    pen.onPointerUp?.(ptr({ x: 60, y: 50 }), ctx);
    pen.onKeyDown?.(key('Enter'), ctx);

    expect(getHistory().past).toHaveLength(1);
    const layer = layerById(getSelectedId()!);
    expect(layer.points).toEqual([
      { x: 50, y: 50 },
      { x: 60, y: 50 },
    ]);
  });

  it('onDeactivate clears an in-progress draft (tool-switch away discards it)', () => {
    const { ctx, getHistory } = makeHarness();
    pen.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    pen.onPointerUp?.(ptr({ x: 0, y: 0 }), ctx);

    pen.onDeactivate?.(ctx);
    pen.onActivate?.(ctx);

    // Enter right after reactivating has nothing to finish (0 points)
    const handled = pen.onKeyDown?.(key('Enter'), ctx);
    expect(handled).toBe(true);
    expect(getHistory().past).toHaveLength(0);
  });
});
