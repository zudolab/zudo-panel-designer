// Group-aware selection semantics through the REAL select tool handlers
// (#151): promotion click, Meta escape (and its ancestor-strip invariant),
// Shift promoted toggles, whole-group move drags, marquee promotion,
// Alt-duplicate of whole subtrees per maximal root, and hidden-group
// unhittability. Same real-history harness style as select.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import './select'; // registers 'select' as a side effect
import { getTool } from '../registry/tools';
import {
  beginGesture as coreBeginGesture,
  commit as coreCommit,
  createHistory,
  isGroupNode,
  redo as coreRedo,
  replace as coreReplace,
  reset as coreReset,
  undo as coreUndo,
  type DocState,
  type GroupNode,
  type HistoryState,
  type Layer,
  type LayerNode,
  type PatternLayer,
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import { normalizeSelectedIds } from '../selection';
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
      return projectFlatLayers(history.present.layers).find((l) => l.id === readSelectedId()) ?? null;
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

const rectAt = (id: string, x: number, y: number): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: 20,
  height: 10,
  color: 1,
});

const group = (id: string, children: LayerNode[], hidden = false): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
  ...(hidden ? { hidden: true } : {}),
});

// G[a(10,10), b(50,40)] + ungrouped c(10,60)
const groupedDoc = (): DocState => ({
  panelHp: 20,
  guides: [],
  layers: [group('G', [rectAt('a', 10, 10), rectAt('b', 50, 40)]), rectAt('c', 10, 60)],
});

beforeEach(() => {
  select.onDeactivate?.({} as ToolContext);
  resetTextGeometryForTests();
});

describe('promotion click (#151)', () => {
  it('a plain click on a grouped leaf selects the TOPMOST ancestor group id', () => {
    const { ctx, getHistory } = makeHarness(groupedDoc());

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside leaf a
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['G']);
    expect(getHistory().past).toHaveLength(0);
  });

  it('a click on a leaf nested TWO levels down still promotes to the topmost group', () => {
    const doc: DocState = {
      panelHp: 20,
      guides: [],
      layers: [group('outer', [group('inner', [rectAt('deep', 10, 10)])])],
    };
    const { ctx } = makeHarness(doc);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['outer']);
  });

  it('the promotion click ARMS a whole-group move: dragging moves every member leaf, ONE entry', () => {
    const { ctx, getHistory, getBeginGestureCalls, leafById } = makeHarness(groupedDoc());

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside a → selects G, arms drag
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx); // (+10, +5)
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    expect(ctx.selectedIds).toEqual(['G']);
    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    expect(leafById('a')).toMatchObject({ x: 20, y: 15 });
    expect(leafById('b')).toMatchObject({ x: 60, y: 45 });
    expect(leafById('c')).toMatchObject({ x: 10, y: 60 }); // not a member — untouched

    ctx.undo();
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
    expect(leafById('b')).toMatchObject({ x: 50, y: 40 });
    // the group SURVIVES the move — the write was tree-preserving
    expect(isGroupNode(getHistory().present.layers[0])).toBe(true);
  });

  it('group-vs-equivalent-flat-selection move parity: the same shared snapped delta', () => {
    // Off-grid members: a per-member absolute snap would shear the pair.
    const grouped = makeHarness({
      panelHp: 20,
      guides: [],
      layers: [group('G', [rectAt('a', 10.03, 10), rectAt('b', 50.08, 40)])],
    });
    grouped.ctx.selectIds(['G']);
    select.onPointerDown?.(ptr({ x: 15, y: 15 }), grouped.ctx);
    select.onPointerMove?.(ptr({ x: 25.06, y: 15 }), grouped.ctx); // dx 10.06 → snaps to 10.1
    select.onPointerUp?.(ptr({ x: 25.06, y: 15 }), grouped.ctx);

    const flat = makeHarness({
      panelHp: 20,
      guides: [],
      layers: [rectAt('a', 10.03, 10), rectAt('b', 50.08, 40)],
    });
    flat.ctx.selectIds(['a', 'b']);
    select.onPointerDown?.(ptr({ x: 15, y: 15 }), flat.ctx);
    select.onPointerMove?.(ptr({ x: 25.06, y: 15 }), flat.ctx);
    select.onPointerUp?.(ptr({ x: 25.06, y: 15 }), flat.ctx);

    for (const id of ['a', 'b']) {
      expect(grouped.leafById(id)).toMatchObject({
        x: (flat.leafById(id) as ShapeLayer).x,
        y: (flat.leafById(id) as ShapeLayer).y,
      });
    }
    expect(grouped.leafById('a')).toMatchObject({ x: 20.13, y: 10 });
  });

  it('a sub-threshold click on a member of a multi-selection collapses to the OWNING group id', () => {
    const { ctx, getHistory } = makeHarness(groupedDoc());
    ctx.selectIds(['G', 'c']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside a (owned by G)
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['G']);
    expect(getHistory().past).toHaveLength(0);
  });

  it('dragging a member of a [group, leaf] multi-selection moves BOTH as one gesture', () => {
    const { ctx, getHistory, leafById } = makeHarness(groupedDoc());
    ctx.selectIds(['G', 'c']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // inside a
    select.onPointerMove?.(ptr({ x: 25, y: 20 }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    expect(leafById('a')).toMatchObject({ x: 20, y: 15 });
    expect(leafById('b')).toMatchObject({ x: 60, y: 45 });
    expect(leafById('c')).toMatchObject({ x: 20, y: 65 });
    expect(getHistory().past).toHaveLength(1);
    expect(ctx.selectedIds).toEqual(['G', 'c']);
  });
});

describe('Meta/Ctrl escape hatch (#151)', () => {
  it('Meta-click selects the RAW leaf and REMOVES the selected ancestor group', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['G']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { metaKey: true }), ctx); // leaf a
    select.onPointerUp?.(ptr({ x: 15, y: 15 }, { metaKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['a']); // no [G, a] overlap, G gone
  });

  it('Meta-click toggles an already-selected leaf back out', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['a', 'c']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { ctrlKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }, { ctrlKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['c']);
  });

  it('Meta WINS over Shift: shift+meta targets the raw leaf, not the promoted group', () => {
    const { ctx } = makeHarness(groupedDoc());

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { metaKey: true, shiftKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }, { metaKey: true, shiftKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['a']);
  });

  it('a modifier click starts no move drag (follow-up move writes no history)', () => {
    const { ctx, getHistory, leafById } = makeHarness(groupedDoc());
    ctx.selectIds(['G']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { metaKey: true }), ctx);
    select.onPointerMove?.(ptr({ x: 40, y: 40 }, { metaKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 40, y: 40 }, { metaKey: true }), ctx);

    expect(getHistory().past).toHaveLength(0);
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
  });
});

describe('Shift promoted toggle (#151)', () => {
  it('Shift-click on a grouped leaf ADDS the promoted group id to the selection', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['c']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { shiftKey: true }), ctx); // leaf a → G
    select.onPointerUp?.(ptr({ x: 15, y: 15 }, { shiftKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['G', 'c']); // DFS-normalized order
  });

  it('Shift-click toggles the promoted group id back OUT', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['G', 'c']);

    select.onPointerDown?.(ptr({ x: 55, y: 45 }, { shiftKey: true }), ctx); // leaf b → G
    select.onPointerUp?.(ptr({ x: 55, y: 45 }, { shiftKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['c']);
  });

  it('Shift-adding a group STRIPS a previously Meta-picked descendant leaf (overlap invariant)', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['a', 'c']); // a was Meta-picked out of G earlier

    select.onPointerDown?.(ptr({ x: 55, y: 45 }, { shiftKey: true }), ctx); // leaf b → adds G
    select.onPointerUp?.(ptr({ x: 55, y: 45 }, { shiftKey: true }), ctx);

    expect(ctx.selectedIds).toEqual(['G', 'c']); // a dropped — never [G, a]
  });
});

describe('marquee promotion (#151)', () => {
  it('a swept nested leaf contributes its topmost ancestor group id, deduped', () => {
    const { ctx, getHistory } = makeHarness(groupedDoc());

    // Sweep leaf a (10..30 x 10..20) and c (10..30 x 60..70) but NOT b.
    select.onPointerDown?.(ptr({ x: 5, y: 5 }), ctx);
    select.onPointerMove?.(ptr({ x: 32, y: 72 }), ctx);
    select.onPointerUp?.(ptr({ x: 32, y: 72 }), ctx);

    expect(ctx.selectedIds).toEqual(['G', 'c']);
    expect(getHistory().past).toHaveLength(0);
  });

  it('an additive marquee union collapses a base leaf swallowed by its swept group', () => {
    const { ctx } = makeHarness(groupedDoc());
    ctx.selectIds(['a']); // Meta-picked leaf inside G

    select.onPointerDown?.(ptr({ x: 45, y: 35 }, { shiftKey: true }), ctx); // empty space
    select.onPointerMove?.(ptr({ x: 75, y: 55 }, { shiftKey: true }), ctx); // sweeps b → G

    expect(ctx.selectedIds).toEqual(['G']); // a collapsed into G — no overlap
    select.onPointerUp?.(ptr({ x: 75, y: 55 }, { shiftKey: true }), ctx);
  });
});

describe('Alt-duplicate clones whole subtrees per maximal root (#151)', () => {
  it('Alt-dragging a selected group duplicates the GROUP (structure intact) and drags the clone', () => {
    const { ctx, getHistory, getBeginGestureCalls, leafById } = makeHarness(groupedDoc());

    select.onPointerDown?.(ptr({ x: 15, y: 15 }, { altKey: true }), ctx); // selects G, arms drag
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx); // crossing: clone + move
    select.onPointerUp?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);

    const layers = getHistory().present.layers;
    expect(layers).toHaveLength(3); // [G, G-clone, c]
    const original = layers[0] as GroupNode;
    const clone = layers[1] as GroupNode;
    expect(isGroupNode(original)).toBe(true);
    expect(isGroupNode(clone)).toBe(true); // the clone is a GROUP, not loose leaves
    expect(clone.id).not.toBe('G');
    expect(clone.children).toHaveLength(2);
    expect(clone.children.map((c) => c.id)).not.toContain('a');

    // originals stay put; clone leaves moved by (+10, +5)
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
    expect(leafById('b')).toMatchObject({ x: 50, y: 40 });
    expect(clone.children[0]).toMatchObject({ x: 20, y: 15 });
    expect(clone.children[1]).toMatchObject({ x: 60, y: 45 });

    // selection follows the CLONE GROUP id; clone+move is ONE undo entry
    expect(ctx.selectedIds).toEqual([clone.id]);
    expect(getBeginGestureCalls()).toBe(1);
    expect(getHistory().past).toHaveLength(1);
    ctx.undo();
    expect(getHistory().present.layers).toHaveLength(2);
  });

  it('an overlapping [group, descendant] selection pre-collapses to maximal roots — ONE clone', () => {
    const { ctx, getHistory } = makeHarness(groupedDoc());
    ctx.selectIds(['G', 'a']); // externally violated overlap

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const layers = getHistory().present.layers;
    expect(layers).toHaveLength(3); // [G, G-clone, c] — a was NOT cloned separately
    expect(layers.filter((n) => isGroupNode(n))).toHaveLength(2);
  });

  it('Alt-dragging a Meta-picked nested leaf clones it INSIDE its parent group', () => {
    const { ctx, getHistory, leafById } = makeHarness(groupedDoc());
    ctx.selectIds(['a']); // the Meta escape selection

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerMove?.(ptr({ x: 25, y: 20 }, { altKey: true }), ctx);
    select.onPointerUp?.(ptr({ x: 25, y: 20 }), ctx);

    const g = getHistory().present.layers[0] as GroupNode;
    expect(g.children).toHaveLength(3); // [a, a-clone, b] — clone directly above its source
    expect(g.children[0].id).toBe('a');
    const cloneId = g.children[1].id;
    expect(cloneId).not.toBe('a');
    expect(leafById('a')).toMatchObject({ x: 10, y: 10 });
    expect(g.children[1]).toMatchObject({ x: 20, y: 15 });
    expect(ctx.selectedIds).toEqual([cloneId]);
  });
});

describe('hidden groups swallow no grabs (#151)', () => {
  const hiddenGroupDoc = (): DocState => ({
    panelHp: 20,
    guides: [],
    layers: [group('H', [rectAt('e', 10, 10)], true), rectAt('c', 10, 60)],
  });

  it('a click on a hidden group\'s leaf falls through to empty space', () => {
    const { ctx, getHistory } = makeHarness(hiddenGroupDoc());
    ctx.selectIds(['c']);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx); // where e would be
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual([]); // plain empty-space click deselected
    expect(getHistory().past).toHaveLength(0);
  });

  it('a marquee never selects the leaves of a hidden group', () => {
    const { ctx } = makeHarness(hiddenGroupDoc());

    select.onPointerDown?.(ptr({ x: 0, y: 0 }), ctx);
    select.onPointerMove?.(ptr({ x: 90, y: 90 }), ctx); // sweeps everything
    select.onPointerUp?.(ptr({ x: 90, y: 90 }), ctx);

    expect(ctx.selectedIds).toEqual(['c']);
  });

  it('a leaf UNDER a hidden group\'s leaf is hittable — the folded-hidden layer is transparent', () => {
    const doc: DocState = {
      panelHp: 20,
      guides: [],
      layers: [rectAt('under', 10, 10), group('H', [rectAt('cover', 10, 10)], true)],
    };
    const { ctx } = makeHarness(doc);

    select.onPointerDown?.(ptr({ x: 15, y: 15 }), ctx);
    select.onPointerUp?.(ptr({ x: 15, y: 15 }), ctx);

    expect(ctx.selectedIds).toEqual(['under']);
  });
});

describe('pattern member of a selected group (#97 × #151)', () => {
  it('a press on a grouped pattern square whose group is selected DRAGS the group, no marquee', () => {
    const pattern: PatternLayer = {
      id: 'p',
      name: 'p',
      type: 'pattern',
      patternType: 'dot-grid',
      params: {},
      color: 1,
      x: 0,
      y: 0,
      size: 100,
    };
    const doc: DocState = {
      panelHp: 20,
      guides: [],
      layers: [group('G', [pattern, rectAt('a', 10, 10)])],
    };
    const { ctx, getHistory, leafById } = makeHarness(doc);
    ctx.selectIds(['G']);

    select.onPointerDown?.(ptr({ x: 80, y: 80 }), ctx); // pattern square, away from a
    select.onPointerMove?.(ptr({ x: 90, y: 85 }), ctx);
    select.onPointerUp?.(ptr({ x: 90, y: 85 }), ctx);

    expect(leafById('p')).toMatchObject({ x: 10, y: 5 }); // moved (+10, +5)
    expect(leafById('a')).toMatchObject({ x: 20, y: 15 }); // rigid group
    expect(getHistory().past).toHaveLength(1);
    expect(ctx.selectedIds).toEqual(['G']);
  });
});
