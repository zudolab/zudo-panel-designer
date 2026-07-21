// Marquee + threshold + modifier vocabulary + hover (#47). Two layers of
// coverage: the pure marquee hit math (marqueeRect/marqueeHitIds — intersection
// semantics, hidden/pattern exclusion, rotation awareness) and the tool's
// behavior driven through onPointerDown/Move/Up against the same real-history
// harness style as select.test.ts. Selection changes never touch history; the
// 4 CSS px client-space threshold gates both marquee materialization and the
// move gesture's first history entry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { marqueeHitIds, marqueeRect } from './select'; // also registers 'select'
import { getTool } from '../registry/tools';
import {
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  flattenLayerNodes,
  redo as coreRedo,
  replace as coreReplace,
  reset as coreReset,
  undo as coreUndo,
  type DocState,
  type HistoryState,
  type Layer,
  type PatternLayer,
  type Pt,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
import type { DraftRenderContext, PanelDims, ToolContext, ToolPointerEvent } from '../types';
import type { Camera } from '../camera';
import { projectFlatLayers } from '../flat-projection';
import { resetTextGeometryForTests, setTextMeasureForTests } from '../text-geometry';

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };
const IDENTITY: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };

const rect = (id: string, x: number, y: number, w = 10, h = 10): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: w,
  height: h,
  color: 1,
});

const dotGrid: PatternLayer = {
  id: 'pat1',
  name: 'Dot grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x: 0,
  y: 0,
  size: 128.5,
};

function makeHarness(initialDoc: DocState, camera: Camera = IDENTITY) {
  let history: HistoryState<DocState> = createHistory(initialDoc);
  let selectedIds: readonly string[] = [];
  let beginGestureCalls = 0;
  let repaintCalls = 0;

  const readSelectedIds = () =>
    normalizeSelectedIds(selectedIds, flattenLayerNodes(history.present.layers));
  const readSelectedId = () => {
    const ids = readSelectedIds();
    return ids.length === 1 ? ids[0] : null;
  };
  const toScreen = (p: Pt): Pt => ({
    x: p.x * camera.pxPerMm + camera.offsetX,
    y: p.y * camera.pxPerMm + camera.offsetY,
  });

  const ctx: ToolContext = {
    get doc() {
      return history.present;
    },
    get camera() {
      return camera;
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
    toMm: (p: Pt) => ({
      x: (p.x - camera.offsetX) / camera.pxPerMm,
      y: (p.y - camera.offsetY) / camera.pxPerMm,
    }),
    toScreen,
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
    requestRepaint: () => {
      repaintCalls += 1;
    },
    evictImageCache: () => {},
    openDialog: () => {},
    closeDialog: () => {},
  };

  // mm-space pointer event; screen derives from the camera so threshold tests
  // can exercise the CLIENT-space (zoom-invariant) measurement.
  const ptr = (mm: Pt, overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent => ({
    screen: toScreen(mm),
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
  });

  return {
    ctx,
    ptr,
    getHistory: () => history,
    getBeginGestureCalls: () => beginGestureCalls,
    getRepaintCalls: () => repaintCalls,
    getSelectedIds: () => readSelectedIds(),
    layerById: (id: string) => history.present.layers.find((l) => l.id === id) as Layer,
  };
}

// Minimal DraftRenderContext spy: records fillRect/strokeRect calls so tests
// can assert whether the marquee/hover chrome actually drew anything.
function makeDraftSpy(camera: Camera = IDENTITY) {
  const calls: { method: string; args: number[] }[] = [];
  const ctx2d = {
    save: () => {},
    restore: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: (...args: number[]) => calls.push({ method: 'fillRect', args }),
    strokeRect: (...args: number[]) => calls.push({ method: 'strokeRect', args }),
  } as unknown as CanvasRenderingContext2D;
  const draft: DraftRenderContext = {
    ctx: ctx2d,
    camera,
    panel: PANEL,
    toScreen: (mm: Pt) => ({
      x: mm.x * camera.pxPerMm + camera.offsetX,
      y: mm.y * camera.pxPerMm + camera.offsetY,
    }),
    inMmSpace: (draw: () => void) => draw(),
  };
  return { draft, calls };
}

const select = getTool('select')!;

beforeEach(() => {
  // module-scope drag/marquee/hover state — reset between tests
  select.onDeactivate?.({} as ToolContext);
  resetTextGeometryForTests();
});

afterEach(() => resetTextGeometryForTests());

describe('marquee hit math', () => {
  it('uses INTERSECTION semantics: partial overlap selects, no containment needed', () => {
    const layers = [rect('r1', 10, 10, 20, 10)];
    // marquee overlaps only the layer's right edge region
    expect(marqueeHitIds(layers, { x: 25, y: 5, width: 20, height: 10 })).toEqual(['r1']);
    // fully disjoint marquee selects nothing
    expect(marqueeHitIds(layers, { x: 40, y: 40, width: 10, height: 10 })).toEqual([]);
  });

  it('an edge-touching marquee still selects (inclusive bounds)', () => {
    const layers = [rect('r1', 10, 10, 20, 10)];
    // marquee's left edge exactly at the layer's right edge (x = 30)
    expect(marqueeHitIds(layers, { x: 30, y: 12, width: 5, height: 5 })).toEqual(['r1']);
  });

  it('excludes hidden layers', () => {
    const layers: Layer[] = [rect('r1', 10, 10), { ...rect('r2', 12, 12), hidden: true }];
    expect(marqueeHitIds(layers, { x: 0, y: 0, width: 50, height: 50 })).toEqual(['r1']);
  });

  it('excludes pattern layers even when their square is fully covered', () => {
    const layers: Layer[] = [dotGrid, rect('r1', 10, 10)];
    expect(marqueeHitIds(layers, { x: 0, y: 0, width: 100, height: 128.5 })).toEqual(['r1']);
    // marquee over ONLY the pattern selects nothing
    expect(marqueeHitIds(layers, { x: 60, y: 60, width: 20, height: 20 })).toEqual([]);
  });

  it('tests against the ROTATED AABB, not the unrotated bbox', () => {
    const rotated: ShapeLayer = { ...rect('r1', 10, 10, 20, 10), rotation: 90 };
    // rotated 90° about center (20,15): AABB becomes x:15..25, y:5..25. The
    // probe rect below is inside the rotated AABB but OUTSIDE the unrotated
    // bbox (y 6..7 < 10).
    const probe = { x: 16, y: 6, width: 1, height: 1 };
    expect(marqueeHitIds([rotated], probe)).toEqual(['r1']);
    expect(marqueeHitIds([rect('r1', 10, 10, 20, 10)], probe)).toEqual([]);
  });

  it('uses canonical multiline text metrics and drops invalid text geometry', () => {
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width: 40,
      height: 20,
    }));
    const text: TextLayer = {
      id: 'text-marquee',
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
    // B0 rotated AABB is x20..40/y10..50. This probe only touches the
    // rotation-expanded top edge, proving marquee shares the canonical box.
    expect(marqueeHitIds([text], { x: 20, y: 10, width: 1, height: 1 })).toEqual([text.id]);
    expect(
      marqueeHitIds([{ ...text, sizeMm: 0 }], { x: 0, y: 0, width: 100, height: 100 }),
    ).toEqual([]);
  });

  it('marqueeRect normalizes a drag in any direction to a positive-size rect', () => {
    expect(marqueeRect({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({
      x: 10,
      y: 5,
      width: 20,
      height: 35,
    });
  });
});

describe('marquee gesture', () => {
  const threeRects = (): DocState => ({
    panelHp: 12,
    guides: [],
    layers: [dotGrid, rect('r1', 10, 10), rect('r2', 30, 10), rect('r3', 10, 40)],
  });

  it('a drag past the threshold selects intersecting layers and leaves history untouched', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds([]);

    // (5,5) sits on the UNSELECTED cover pattern — #97's drag rule makes this
    // press marquee exactly as if it were empty space.
    select.onPointerDown?.(h.ptr({ x: 5, y: 5 }), h.ctx);
    select.onPointerMove?.(h.ptr({ x: 45, y: 25 }), h.ctx); // covers r1 + r2, not r3

    // materialized: the rubber-band draws
    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls.some((c) => c.method === 'fillRect')).toBe(true);

    select.onPointerUp?.(h.ptr({ x: 45, y: 25 }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1', 'r2']);
    expect(h.getBeginGestureCalls()).toBe(0);
    expect(h.getHistory().past).toHaveLength(0);
    expect(h.layerById('pat1')).toEqual(dotGrid); // the pattern never moved
  });

  it('a marquee over only the panel-wide pattern selects nothing', () => {
    // Down on the unselected pattern = marquee (#97); marqueeHitIds still
    // excludes patterns, so a pattern-only sweep selects nothing.
    const h = makeHarness(threeRects());
    select.onPointerDown?.(h.ptr({ x: 60, y: 60 }), h.ctx);
    select.onPointerMove?.(h.ptr({ x: 90, y: 100 }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 90, y: 100 }), h.ctx);
    expect(h.getSelectedIds()).toEqual([]);
  });

  it('a sub-threshold empty press is a click: deselects at pointerdown, marquee never flashes', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r1']);

    // (60,140) is below the pattern square (y > 128.5) — still genuinely
    // empty space now that the square itself is click-selectable (#97).
    select.onPointerDown?.(h.ptr({ x: 60, y: 140 }), h.ctx);
    expect(h.getSelectedIds()).toEqual([]); // plain click clears at DOWN

    select.onPointerMove?.(h.ptr({ x: 62, y: 141 }), h.ctx); // ~2.2px < 4px
    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls).toEqual([]); // nothing materialized

    select.onPointerUp?.(h.ptr({ x: 62, y: 141 }), h.ctx);
    expect(h.getSelectedIds()).toEqual([]);
  });

  // #97's click rule: the same sub-threshold press ON the unselected pattern
  // square selects the pattern on release instead of staying deselected.
  it('a sub-threshold press on an unselected pattern is a click that SELECTS it on release', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r1']);

    select.onPointerDown?.(h.ptr({ x: 60, y: 60 }), h.ctx);
    expect(h.getSelectedIds()).toEqual([]); // still clears at DOWN, like empty space

    select.onPointerMove?.(h.ptr({ x: 62, y: 61 }), h.ctx); // sub-threshold jiggle
    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls).toEqual([]); // no marquee flash

    select.onPointerUp?.(h.ptr({ x: 62, y: 61 }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['pat1']);
    expect(h.getHistory().past).toHaveLength(0); // selection only — no doc change
  });

  it('a meta/ctrl empty click PRESERVES the selection (additive intent)', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r1']);
    // (60,140): outside the pattern square — see the sub-threshold test (#97).
    select.onPointerDown?.(h.ptr({ x: 60, y: 140 }, { metaKey: true }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 60, y: 140 }, { metaKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1']);
  });

  // #97: a modifier CLICK on an unselected pattern toggles it into the
  // selection (release-time), while a modifier DRAG from the same point is
  // still an additive marquee — patterns never block marquee access.
  it('a meta/ctrl click on an unselected pattern ADDS it to the selection on release', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r1']);
    select.onPointerDown?.(h.ptr({ x: 60, y: 60 }, { metaKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1']); // preserved at DOWN (additive intent)
    select.onPointerUp?.(h.ptr({ x: 60, y: 60 }, { metaKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['pat1', 'r1']); // normalized to doc order
  });

  it('a right-click PRESERVES the selection and never arms a marquee', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r1']);
    select.onPointerDown?.(h.ptr({ x: 60, y: 60 }, { button: 2, buttons: 2 }), h.ctx);
    select.onPointerMove?.(h.ptr({ x: 90, y: 100 }, { buttons: 2 }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 90, y: 100 }, { button: 2, buttons: 0 }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1']);
  });

  it('a shift-marquee unions with the down-time selection', () => {
    const h = makeHarness(threeRects());
    h.ctx.selectIds(['r3']);
    // starts on the unselected pattern — still an additive marquee (#97)
    select.onPointerDown?.(h.ptr({ x: 5, y: 5 }, { shiftKey: true }), h.ctx);
    select.onPointerMove?.(h.ptr({ x: 45, y: 25 }, { shiftKey: true }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 45, y: 25 }, { shiftKey: true }), h.ctx);
    // normalized to DOCUMENT order regardless of selection order
    expect(h.getSelectedIds()).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('modifier clicks on layers', () => {
  const doc = (): DocState => ({
    panelHp: 12,
    guides: [],
    layers: [rect('r1', 10, 10), rect('r2', 30, 10)],
  });

  it('shift-click adds to, then toggles out of, the selection', () => {
    const h = makeHarness(doc());
    h.ctx.selectIds(['r1']);

    select.onPointerDown?.(h.ptr({ x: 35, y: 15 }, { shiftKey: true }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 35, y: 15 }, { shiftKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1', 'r2']);

    select.onPointerDown?.(h.ptr({ x: 35, y: 15 }, { shiftKey: true }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 35, y: 15 }, { shiftKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1']);
  });

  it('meta/ctrl-click toggles exactly the clicked layer, leaving the rest alone', () => {
    const h = makeHarness(doc());
    h.ctx.selectIds(['r1', 'r2']);
    select.onPointerDown?.(h.ptr({ x: 15, y: 15 }, { ctrlKey: true }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 15, y: 15 }, { ctrlKey: true }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r2']);
  });

  it('a modifier click starts no move drag: history stays empty after a follow-up move', () => {
    const h = makeHarness(doc());
    select.onPointerDown?.(h.ptr({ x: 15, y: 15 }, { shiftKey: true }), h.ctx);
    select.onPointerMove?.(h.ptr({ x: 40, y: 40 }, { shiftKey: true, buttons: 1 }), h.ctx);
    select.onPointerUp?.(h.ptr({ x: 40, y: 40 }, { shiftKey: true }), h.ctx);
    expect(h.getHistory().past).toHaveLength(0);
    expect(h.layerById('r1')).toMatchObject({ x: 10, y: 10 });
  });
});

describe('click-vs-drag threshold (4 CSS px, client space)', () => {
  it('is zoom-invariant: a 3px client move at low zoom commits nothing despite a 30mm delta', () => {
    // pxPerMm 0.1 — heavily zoomed out, so tiny client jitter spans many mm
    const zoomedOut: Camera = { pxPerMm: 0.1, offsetX: 0, offsetY: 0 };
    const h = makeHarness(
      { panelHp: 12, guides: [], layers: [rect('r1', 10, 10, 20, 20)] },
      zoomedOut,
    );

    // plain click inside r1 selects it at pointerdown and starts the move drag
    select.onPointerDown?.(h.ptr({ x: 20, y: 20 }), h.ctx);
    expect(h.getSelectedIds()).toEqual(['r1']);
    select.onPointerMove?.(h.ptr({ x: 50, y: 20 }), h.ctx); // 30mm == 3 client px < 4
    expect(h.getBeginGestureCalls()).toBe(0);
    expect(h.getHistory().past).toHaveLength(0);
    expect(h.layerById('r1')).toMatchObject({ x: 10, y: 10 });

    // crossing the threshold opens exactly one entry and streams from there
    select.onPointerMove?.(h.ptr({ x: 70, y: 20 }), h.ctx); // 50mm == 5 client px
    select.onPointerUp?.(h.ptr({ x: 70, y: 20 }), h.ctx);
    expect(h.getBeginGestureCalls()).toBe(1);
    expect(h.getHistory().past).toHaveLength(1);
    expect(h.layerById('r1')).toMatchObject({ x: 60, y: 10 }); // full 50mm delta from start
  });
});

describe('hover', () => {
  const doc = (): DocState => ({
    panelHp: 12,
    guides: [],
    layers: [rect('r1', 10, 10), rect('r2', 30, 10)],
  });

  it('repaints ONLY when the hovered id changes', () => {
    const h = makeHarness(doc());
    const move = (mm: Pt) => select.onPointerMove?.(h.ptr(mm, { buttons: 0 }), h.ctx);

    move({ x: 15, y: 15 }); // enter r1
    expect(h.getRepaintCalls()).toBe(1);
    move({ x: 16, y: 16 }); // still r1 — no extra repaint
    move({ x: 17, y: 14 });
    expect(h.getRepaintCalls()).toBe(1);
    move({ x: 60, y: 60 }); // leave onto empty space
    expect(h.getRepaintCalls()).toBe(2);
    move({ x: 62, y: 62 }); // still empty
    expect(h.getRepaintCalls()).toBe(2);
    move({ x: 35, y: 15 }); // enter r2
    expect(h.getRepaintCalls()).toBe(3);
  });

  it('draws a hover outline for an unselected layer, none for a selected one', () => {
    const h = makeHarness(doc());
    select.onPointerMove?.(h.ptr({ x: 15, y: 15 }, { buttons: 0 }), h.ctx);

    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls.some((c) => c.method === 'strokeRect')).toBe(true);

    h.ctx.selectIds(['r1']); // selection chrome takes over — hover outline off
    const spy2 = makeDraftSpy();
    select.renderDraft?.(spy2.draft, h.ctx);
    expect(spy2.calls).toEqual([]);
  });

  it('clears the hover outline when the pointer leaves the canvas', () => {
    const h = makeHarness(doc());
    select.onPointerMove?.(h.ptr({ x: 15, y: 15 }, { buttons: 0 }), h.ctx);
    expect(h.getRepaintCalls()).toBe(1);

    select.onPointerLeave?.(h.ptr({ x: -5, y: 15 }, { buttons: 0 }), h.ctx);
    expect(h.getRepaintCalls()).toBe(2); // outline erased

    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls).toEqual([]);

    // leaving with nothing hovered stays repaint-free
    select.onPointerLeave?.(h.ptr({ x: -5, y: 15 }, { buttons: 0 }), h.ctx);
    expect(h.getRepaintCalls()).toBe(2);
  });

  // #97: patterns are hover-testable via the two-tier hit, so pattern-covered
  // "empty" panel space outlines the pattern square instead of nothing.
  it('hovering pattern-covered space outlines the pattern square (two-tier)', () => {
    const h = makeHarness({ panelHp: 12, guides: [], layers: [dotGrid, rect('r1', 10, 10)] });
    select.onPointerMove?.(h.ptr({ x: 60, y: 60 }, { buttons: 0 }), h.ctx); // only the pattern is under here
    expect(h.getRepaintCalls()).toBe(1);

    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls.some((c) => c.method === 'strokeRect')).toBe(true);
  });

  it('clears the hover outline on pointerdown so nothing draws mid-drag', () => {
    const h = makeHarness(doc());
    select.onPointerMove?.(h.ptr({ x: 15, y: 15 }, { buttons: 0 }), h.ctx);
    select.onPointerDown?.(h.ptr({ x: 15, y: 15 }), h.ctx);

    const spy = makeDraftSpy();
    select.renderDraft?.(spy.draft, h.ctx);
    expect(spy.calls).toEqual([]);

    select.onPointerUp?.(h.ptr({ x: 15, y: 15 }), h.ctx);
  });
});
