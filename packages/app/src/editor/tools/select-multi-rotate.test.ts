// Multi/group rotate gesture lifecycle through the REAL select tool handlers
// (#152): knob grab (shared gate with the chrome), frozen pivot capture,
// delta unwrap past ±180°, Shift delta-snap coexisting with the single-rotate
// snap, ONE undo entry per gesture, zero-change drags writing NO history,
// pattern exclusion from pivot/bounds, group-id vs flat-selection parity, and
// pointercancel-as-pointerup. Same real-history harness style as
// select.test.ts / select-groups.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import './select'; // registers 'select' as a side effect
import { getTool } from '../registry/tools';
import {
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  redo as coreRedo,
  replace as coreReplace,
  reset as coreReset,
  undo as coreUndo,
  type DocState,
  type GroupNode,
  type HistoryState,
  type Layer,
  type LayerNode,
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
import { multiRotateKnobScreenPos, rotateHandleScreenPos } from '../renderer';
import type { PanelDims, ToolContext, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';
import { projectFlatLayers } from '../flat-projection';
import { resetTextGeometryForTests } from '../text-geometry';

const CAMERA: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 }; // identity: screen px == mm
const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function makeHarness(initialDoc: DocState) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let selectedIds: readonly string[] = [];
  let beginGestureCalls = 0;

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
      return (
        projectFlatLayers(history.present.layers).find((l) => l.id === readSelectedId()) ?? null
      );
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
      history = coreReplace(history, next);
    },
    reset: (next) => {
      history = coreReset(next);
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
    evictImageCache: () => {},
    openDialog: () => {},
    closeDialog: () => {},
  };

  return {
    ctx,
    getHistory: () => history,
    getBeginGestureCalls: () => beginGestureCalls,
    leafById: (id: string) =>
      projectFlatLayers(history.present.layers).find((l) => l.id === id) as Layer,
  };
}

function ptr(mm: Pt, overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    screen: mm,
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

const rectAt = (id: string, x: number, y: number, extra: Partial<ShapeLayer> = {}): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: 10,
  height: 10,
  color: 1,
  ...extra,
});

const patternAt = (id: string, x: number, y: number, size: number): Layer => ({
  id,
  name: id,
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x,
  y,
  size,
});

const group = (id: string, children: LayerNode[]): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
});

const doc = (layers: LayerNode[]): DocState => ({ panelHp: 20, guides: [], layers });

// a(10,10)+b(30,10), both 10×10 → combined bbox (10,10)-(40,20), pivot
// (25,15), knob 20px above the top-center: (25, -10). Identity camera, so the
// same coordinates feed screen and mm.
const twoShapes = () => [rectAt('a', 10, 10), rectAt('b', 30, 10)];
const KNOB: Pt = { x: 25, y: -10 }; // start pointer angle about (25,15): -90°

beforeEach(() => {
  select.onDeactivate?.({} as ToolContext);
  resetTextGeometryForTests();
});

describe('multi-rotate gesture (#152) — knob grab + bake', () => {
  it('rotates every member about the frozen combined pivot: ONE undo entry, full revert', () => {
    const { ctx, getHistory, getBeginGestureCalls, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr({ x: 45, y: -5 }), ctx); // stream a partial tick
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx); // due east of pivot → delta +90°
    select.onPointerUp?.(ptr({ x: 65, y: 15 }), ctx);

    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    // a: center (15,15) orbits (25,15) by 90° cw → (25,5) → x 20, y 0.
    const a = leafById('a') as ShapeLayer;
    expect(a.x).toBeCloseTo(20);
    expect(a.y).toBeCloseTo(0);
    expect(a.rotation).toBe(90);
    // b: center (35,15) → (25,25) → x 20, y 20.
    const b = leafById('b') as ShapeLayer;
    expect(b.x).toBeCloseTo(20);
    expect(b.y).toBeCloseTo(20);
    expect(b.rotation).toBe(90);

    // ONE undo fully reverts every member.
    ctx.undo();
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
    expect(leafById('b')).toMatchObject({ x: 30, y: 10 });
    expect((leafById('a') as ShapeLayer).rotation).toBeUndefined();
  });

  it('re-bakes from the captured start each tick: a drag out and back to 0° restores start geometry', () => {
    const { ctx, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx); // +90°
    select.onPointerMove?.(ptr({ x: 25, y: -40 }), ctx); // back to the start ray → 0°
    select.onPointerUp?.(ptr({ x: 25, y: -40 }), ctx);

    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
    expect(leafById('b')).toMatchObject({ x: 30, y: 10 });
  });

  it('unwraps the delta past ±180°: the badge delta keeps accumulating (+270, not -90)', () => {
    const { ctx, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx); // +90°
    select.onPointerMove?.(ptr({ x: 25, y: 55 }), ctx); // due south → +180°
    select.onPointerMove?.(ptr({ x: -15, y: 15 }), ctx); // due west: raw reads +270 via the cut
    // The live chrome reads the SIGNED accumulated delta, not the mod-360 flip.
    expect(select.multiRotateChrome?.(ctx)?.deltaDeg).toBe(270);
    select.onPointerUp?.(ptr({ x: -15, y: 15 }), ctx);
    // Baked rotation is inspector-normalized to [-180, 180).
    expect((leafById('a') as ShapeLayer).rotation).toBe(-90);
  });

  it('Shift snaps the DELTA to 45° steps — and the single-rotate keeps its own #51 snap', () => {
    const { ctx, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    // ~+50° of pointer travel about the pivot, Shift held → snaps to +45°.
    const rad = ((-90 + 50) * Math.PI) / 180;
    const p = { x: 25 + 25 * Math.cos(rad), y: 15 + 25 * Math.sin(rad) };
    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr(p, { shiftKey: true }), ctx);
    select.onPointerUp?.(ptr(p, { shiftKey: true }), ctx);
    expect((leafById('a') as ShapeLayer).rotation).toBe(45);

    // Coexistence: the SINGLE-layer rotate still snaps 45° steps from its own
    // start rotation (#51 — byte-identical behavior, untouched by #152).
    ctx.undo();
    ctx.selectIds(['a']);
    const single = leafById('a') as ShapeLayer;
    const singleKnob = rotateHandleScreenPos(
      { x: single.x, y: single.y, width: single.width, height: single.height },
      0,
      CAMERA,
    );
    // ~+50° about a's own center (15,15), Shift held → rotation 45.
    const srad = ((-90 + 50) * Math.PI) / 180;
    const sp = { x: 15 + 25 * Math.cos(srad), y: 15 + 25 * Math.sin(srad) };
    select.onPointerDown?.(ptr(singleKnob), ctx);
    select.onPointerMove?.(ptr(sp, { shiftKey: true }), ctx);
    select.onPointerUp?.(ptr(sp, { shiftKey: true }), ctx);
    expect((leafById('a') as ShapeLayer).rotation).toBe(45);
  });

  it('a zero-change drag (pointer stays on the start ray) writes NO history entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    // 30px of travel (well past the 4px click threshold) but the same angle.
    select.onPointerMove?.(ptr({ x: 25, y: -40 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: -40 }), ctx);

    expect(getBeginGestureCalls()).toBe(0);
    expect(getHistory().past).toHaveLength(0);
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
  });

  it('a pure click on the knob writes NO history and keeps the selection', () => {
    const { ctx, getHistory } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerUp?.(ptr(KNOB), ctx);

    expect(getHistory().past).toHaveLength(0);
    expect([...ctx.selectedIds].sort()).toEqual(['a', 'b']);
  });
});

describe('multi-rotate eligibility (#152 shared gate)', () => {
  it('an all-non-rotatable (pattern-only) selection offers no grab: nothing rotates, no history', () => {
    const layers = [patternAt('g1', 0, 0, 50), patternAt('g2', 60, 0, 50)];
    const { ctx, getHistory, leafById } = makeHarness(doc(layers));
    ctx.selectIds(['g1', 'g2']);

    // Where the knob WOULD be for the combined bbox (0,0)-(110,50) — but no
    // knob is drawn (multiRotateBbox is null), so the grab must fall through.
    select.onPointerDown?.(ptr({ x: 55, y: -20 }), ctx);
    select.onPointerMove?.(ptr({ x: 80, y: 25 }), ctx);
    select.onPointerUp?.(ptr({ x: 80, y: 25 }), ctx);

    expect(getHistory().past).toHaveLength(0);
    expect(leafById('g1')).toMatchObject({ x: 0, y: 0 });
    expect(leafById('g2')).toMatchObject({ x: 60, y: 0 });
  });

  it('pivot and bounds exclude patterns: the knob rides the full combined bbox, the pivot does not', () => {
    // Pattern square (0,0)-(100,100) dwarfs the 10×10 shape. The knob sits
    // above the FULL chrome bbox; the gesture pivot is the SHAPE's center.
    const layers = [patternAt('g', 0, 0, 100), rectAt('a', 10, 10)];
    const { ctx, leafById } = makeHarness(doc(layers));
    ctx.selectIds(['g', 'a']);

    const knob = { x: 50, y: -20 }; // above the (0,0)-(100,100) union
    select.onPointerDown?.(ptr(knob), ctx);
    // start angle about the shape-only pivot (15,15): atan2(-35,35) = -45°;
    // move to +45° → delta +90.
    select.onPointerMove?.(ptr({ x: 50, y: 50 }), ctx);
    select.onPointerUp?.(ptr({ x: 50, y: 50 }), ctx);

    // The shape's center IS the pivot (sole rotatable member), so it rotates
    // in place — its origin must not be displaced toward the pattern's bbox.
    const a = leafById('a') as ShapeLayer;
    expect(a.x).toBeCloseTo(10);
    expect(a.y).toBeCloseTo(10);
    expect(a.rotation).toBe(90);
    // The pattern is untouched — position, size and (absent) rotation.
    expect(leafById('g')).toEqual(layers[0]);
  });

  it('a lone GROUP id rotates identically to the equivalent flat multi-selection', () => {
    const grouped = makeHarness(doc([group('G', [rectAt('a', 10, 10), rectAt('b', 30, 10)])]));
    grouped.ctx.selectIds(['G']);
    select.onPointerDown?.(ptr(KNOB), grouped.ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), grouped.ctx);
    select.onPointerUp?.(ptr({ x: 65, y: 15 }), grouped.ctx);

    const flat = makeHarness(doc(twoShapes()));
    flat.ctx.selectIds(['a', 'b']);
    select.onPointerDown?.(ptr(KNOB), flat.ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), flat.ctx);
    select.onPointerUp?.(ptr({ x: 65, y: 15 }), flat.ctx);

    expect(projectFlatLayers(grouped.getHistory().present.layers)).toEqual(
      projectFlatLayers(flat.getHistory().present.layers),
    );
    // …and the selection stays the group id — the gesture never dissolves it.
    expect(grouped.ctx.selectedIds).toEqual(['G']);
  });

  it('a ONE-CHILD group still gets the rotate gesture (combined mode, single leaf)', () => {
    const { ctx, leafById, getHistory } = makeHarness(
      doc([group('G', [rectAt('a', 10, 10)])]),
    );
    ctx.selectIds(['G']);

    // Knob above a's bbox (10,10)-(20,20): (15, -10); pivot (15,15).
    select.onPointerDown?.(ptr({ x: 15, y: -10 }), ctx);
    select.onPointerMove?.(ptr({ x: 40, y: 15 }), ctx); // due east → +90°
    select.onPointerUp?.(ptr({ x: 40, y: 15 }), ctx);

    expect(getHistory().past).toHaveLength(1);
    const a = leafById('a') as ShapeLayer;
    expect(a.rotation).toBe(90);
    expect(a.x).toBeCloseTo(10); // own center == pivot → rotates in place
    expect(a.y).toBeCloseTo(10);
  });

  it('the knob grab wins over a corner handle grab (rotate ABOVE resize in the chain)', () => {
    // Sanity for the precedence ordering: grabbing exactly at the knob starts
    // a rotate even though the multi-resize gate is also armed.
    const { ctx, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);
    expect(multiRotateKnobScreenPos({ x: 10, y: 10, width: 30, height: 10 }, { x: 25, y: 15 }, 0, CAMERA)).toEqual(
      KNOB,
    );
    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 65, y: 15 }), ctx);
    expect((leafById('a') as ShapeLayer).rotation).toBe(90); // rotated, not scaled
    expect((leafById('a') as ShapeLayer).width).toBe(10);
  });
});

describe('multi-rotate lifecycle (#152) — chrome hook + pointercancel', () => {
  it('multiRotateChrome is null when idle, frozen+live during the stream, null again after up', () => {
    const { ctx } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);
    expect(select.multiRotateChrome?.(ctx)).toBeNull();

    select.onPointerDown?.(ptr(KNOB), ctx);
    // Armed but no non-zero tick yet: the doc is untouched, the normal chrome
    // still draws — the hook must stay null (no flicker on a knob click).
    expect(select.multiRotateChrome?.(ctx)).toBeNull();

    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx);
    const chrome = select.multiRotateChrome?.(ctx);
    expect(chrome).toEqual({
      bounds: { x: 10, y: 10, width: 30, height: 10 }, // FROZEN start bounds
      pivot: { x: 25, y: 15 },
      deltaDeg: 90,
    });

    select.onPointerUp?.(ptr({ x: 65, y: 15 }), ctx);
    expect(select.multiRotateChrome?.(ctx)).toBeNull();
  });

  it('pointercancel behaves exactly as pointerup: gesture closes where it stood, ONE entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, leafById } = makeHarness(doc(twoShapes()));
    ctx.selectIds(['a', 'b']);

    select.onPointerDown?.(ptr(KNOB), ctx);
    select.onPointerMove?.(ptr({ x: 65, y: 15 }), ctx); // +90°
    select.onPointerCancel?.(ptr({ x: 65, y: 15 }), ctx);

    // The streamed change stays (no rollback, no trailing commit) …
    expect((leafById('a') as ShapeLayer).rotation).toBe(90);
    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    // … the drag is closed: further moves are hover, not gesture ticks …
    select.onPointerMove?.(ptr({ x: 25, y: 55 }, { buttons: 0 }), ctx);
    expect((leafById('a') as ShapeLayer).rotation).toBe(90);
    expect(select.multiRotateChrome?.(ctx)).toBeNull();
    // … and ONE undo reverts the whole gesture.
    ctx.undo();
    expect((leafById('a') as ShapeLayer).rotation).toBeUndefined();
  });
});
