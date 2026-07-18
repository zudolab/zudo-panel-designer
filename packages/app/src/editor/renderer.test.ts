// @vitest-environment jsdom
//
// Selection-chrome bounds (#45). selectionBboxes is the pure set the chrome
// pass strokes (one dashed box per selected layer) and the combined bbox unions
// over. Text is deliberately excluded here — it needs Canvas metrics
// (measureTextBbox), which jsdom/node lack; shapes and paths cover the rule.
// jsdom is also what the loading-dim block below needs for HTMLCanvasElement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mergeBboxes,
  PALETTE,
  type ImageLayer,
  type Layer,
  type PatternLayer,
  type Rect,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import {
  canRotate,
  CORNER_HANDLE_IDS,
  cornerHandleRects,
  layerBbox,
  multiResizeBbox,
  reconcileImageCache,
  renderScene,
  resizeHandleRects,
  ROTATE_HANDLE_OFFSET_PX,
  rotateHandleScreenPos,
  selectionBboxes,
} from './renderer';
import { ensureFont, isFontLoading } from './fonts';
import type { Camera } from './camera';
import type { PanelDims } from './types';

vi.mock('./fonts', () => ({
  ensureFont: vi.fn(() => Promise.resolve()),
  isFontLoaded: vi.fn(() => false),
  isFontLoading: vi.fn(() => false),
}));

// renderer.ts pulls exactly patternByName from @zpd/patterns; mocking it lets
// the #96 block below inject a spy generator and observe the draw options.
vi.mock('@zpd/patterns', () => ({
  patternByName: vi.fn(() => undefined),
}));

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function shape(id: string, x: number, y: number, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
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
  };
}

describe('selectionBboxes', () => {
  it('returns one axis-aligned bbox per selected layer, in selection order', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20), shape('c', 40, 40)];
    const boxes = selectionBboxes(layers, ['a', 'c']);
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 40, y: 40, width: 10, height: 10 },
    ]);
  });

  it('skips hidden layers so their chrome vanishes with the layer paint', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20, { hidden: true })];
    expect(selectionBboxes(layers, ['a', 'b'])).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
    ]);
  });

  it('drops ids absent from the doc (stale after delete/undo)', () => {
    const layers: Layer[] = [shape('a', 0, 0)];
    expect(selectionBboxes(layers, ['a', 'ghost'])).toHaveLength(1);
  });

  it('expands a rotated shape to its rotated AABB, not its raw rect', () => {
    // 90° rotation of a 10×10 square about its own center is bounds-identical,
    // so use a non-square to prove the AABB widened.
    const layers: Layer[] = [shape('r', 0, 0, { width: 20, height: 10, rotation: 90 })];
    const [box] = selectionBboxes(layers, ['r']);
    expect(box.width).toBeCloseTo(10);
    expect(box.height).toBeCloseTo(20);
  });

  it('the combined bbox (mergeBboxes) encloses every selected layer', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    const combined = mergeBboxes(selectionBboxes(layers, ['a', 'b']));
    expect(combined).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('normalizes a mirrored member (negative width) to its visual rect', () => {
    // x 20, width -30 spans -10..20 visually → normalized bbox x -10, width 30.
    const layers: Layer[] = [shape('m', 20, 0, { width: -30 })];
    expect(selectionBboxes(layers, ['m'])).toEqual([
      { x: -10, y: 0, width: 30, height: 10 },
    ]);
  });

  it('the combined bbox stays correct when a member is mirrored', () => {
    // Without normalization the mirrored member would collapse/invert the union.
    const layers: Layer[] = [shape('m', 20, 0, { width: -30 }), shape('b', 40, 0)];
    const combined = mergeBboxes(selectionBboxes(layers, ['m', 'b']));
    expect(combined).toEqual({ x: -10, y: 0, width: 60, height: 10 });
  });
});

// --- oriented chrome geometry (#51) -----------------------------------------

const IDENTITY: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };
const BBOX: Rect = { x: 10, y: 10, width: 20, height: 10 }; // center (20, 15)

const handleCenter = (bbox: Rect, cam: Camera, rotation: number, id: string) => {
  const h = resizeHandleRects(bbox, cam, rotation).find((r) => r.id === id)!;
  return { x: h.x + h.size / 2, y: h.y + h.size / 2 };
};

describe('resizeHandleRects — rotation-aware (#51)', () => {
  it('rotation 0 keeps the classic axis-aligned corner/edge positions', () => {
    expect(handleCenter(BBOX, IDENTITY, 0, 'nw')).toEqual({ x: 10, y: 10 });
    expect(handleCenter(BBOX, IDENTITY, 0, 'n')).toEqual({ x: 20, y: 10 });
    expect(handleCenter(BBOX, IDENTITY, 0, 'se')).toEqual({ x: 30, y: 20 });
    expect(handleCenter(BBOX, IDENTITY, 0, 'w')).toEqual({ x: 10, y: 15 });
  });

  it('a 90° rotation puts each handle at the ROTATED corner, not the AABB corner', () => {
    // raw se corner (30,20): offset from the center (10,5) rotates cw to
    // (-5,10) → lands at (15,25)
    const se = handleCenter(BBOX, IDENTITY, 90, 'se');
    expect(se.x).toBeCloseTo(15);
    expect(se.y).toBeCloseTo(25);
    const n = handleCenter(BBOX, IDENTITY, 90, 'n');
    expect(n.x).toBeCloseTo(25);
    expect(n.y).toBeCloseTo(15);
  });

  it('applies the camera transform after rotating', () => {
    const cam: Camera = { pxPerMm: 2, offsetX: 5, offsetY: 7 };
    const se = handleCenter(BBOX, cam, 90, 'se');
    expect(se.x).toBeCloseTo(15 * 2 + 5);
    expect(se.y).toBeCloseTo(25 * 2 + 7);
  });
});

describe('rotateHandleScreenPos (#51)', () => {
  it('sits a fixed screen offset above the top-edge midpoint when unrotated', () => {
    const p = rotateHandleScreenPos(BBOX, 0, IDENTITY);
    expect(p).toEqual({ x: 20, y: 10 - ROTATE_HANDLE_OFFSET_PX });
  });

  it('tracks the rotated top edge: at 90° it points due east of the center', () => {
    // top-mid (20,10) rotates to (25,15); "up" rotates to +x → knob at
    // (25 + OFFSET, 15)
    const p = rotateHandleScreenPos(BBOX, 90, IDENTITY);
    expect(p.x).toBeCloseTo(25 + ROTATE_HANDLE_OFFSET_PX);
    expect(p.y).toBeCloseTo(15);
  });

  it('offset is screen px — zoom scales the bbox but not the stem length', () => {
    const cam: Camera = { pxPerMm: 4, offsetX: 0, offsetY: 0 };
    const p = rotateHandleScreenPos(BBOX, 0, cam);
    expect(p).toEqual({ x: 80, y: 40 - ROTATE_HANDLE_OFFSET_PX });
  });
});

describe('canRotate (#51 eligibility)', () => {
  it('is true for exactly the types layerRotation reads: shape and text', () => {
    expect(canRotate(shape('a', 0, 0))).toBe(true);
    expect(
      canRotate({
        id: 't',
        name: 't',
        type: 'text',
        content: 'x',
        fontFamily: 'sans-serif',
        sizeMm: 5,
        x: 0,
        y: 0,
        color: 1,
      }),
    ).toBe(true);
    expect(
      canRotate({
        id: 'p',
        name: 'p',
        type: 'path',
        points: [],
        closed: false,
        fill: null,
        stroke: 1,
        strokeWidth: 1,
      }),
    ).toBe(false);
    expect(
      canRotate({
        id: 'i',
        name: 'i',
        type: 'image',
        src: 'data:,',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).toBe(false);
    expect(
      canRotate({
        id: 'g',
        name: 'g',
        type: 'pattern',
        patternType: 'dot-grid',
        params: {},
        color: 1,
        x: 0,
        y: 0,
        size: 128.5,
      }),
    ).toBe(false);
  });
});

// --- multi-resize eligibility + corner handles (#52) -------------------------

const pattern = (id: string): Layer => ({
  id,
  name: id,
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x: 0,
  y: 0,
  size: 50,
});

describe('multiResizeBbox (#52 eligibility gate)', () => {
  it('returns the combined bbox for a multi-selection of scalable layers', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    expect(multiResizeBbox(layers, ['a', 'b'])).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
  });

  it('is null for a single selection — that is the 8-handle path, not this one', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    expect(multiResizeBbox(layers, ['a'])).toBeNull();
  });

  it('is null when hidden members leave fewer than two visible bboxes', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30, { hidden: true })];
    expect(multiResizeBbox(layers, ['a', 'b'])).toBeNull();
  });

  it('is null for a pattern-only multi-selection — nothing in it can scale', () => {
    const layers: Layer[] = [pattern('g1'), pattern('g2')];
    expect(multiResizeBbox(layers, ['g1', 'g2'])).toBeNull();
  });

  it('is null for a pattern plus an EMPTY path — scaleLayer cannot change either', () => {
    // pathBbox([]) yields a 0×0 box (not null), so the empty path DOES
    // contribute a second bbox — eligibility must still reject the pair or the
    // handles would promise a gesture that writes a phantom undo entry.
    const emptyPath: Layer = {
      id: 'p0',
      name: 'p0',
      type: 'path',
      points: [],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    expect(multiResizeBbox([pattern('g1'), emptyPath], ['g1', 'p0'])).toBeNull();
  });

  it('a pattern plus a shape still qualifies (the shape is scalable)', () => {
    const layers: Layer[] = [pattern('g1'), shape('a', 10, 10)];
    // the pattern's bbox is its own x/y/size square (#96) — the 50mm square
    // at the origin already encloses the 10..20 shape, so it IS the union
    expect(multiResizeBbox(layers, ['g1', 'a'])).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
  });
});

describe('cornerHandleRects (#52 — corner handles ONLY for multi-selections)', () => {
  it('returns exactly the 4 corner handles, no edge handles', () => {
    const rects = cornerHandleRects(BBOX, IDENTITY);
    expect(rects.map((r) => r.id)).toEqual([...CORNER_HANDLE_IDS]);
  });

  it('corners sit at the bbox corners in screen space', () => {
    const rects = cornerHandleRects(BBOX, IDENTITY);
    const center = (id: string) => {
      const h = rects.find((r) => r.id === id)!;
      return { x: h.x + h.size / 2, y: h.y + h.size / 2 };
    };
    expect(center('nw')).toEqual({ x: 10, y: 10 });
    expect(center('ne')).toEqual({ x: 30, y: 10 });
    expect(center('se')).toEqual({ x: 30, y: 20 });
    expect(center('sw')).toEqual({ x: 10, y: 20 });
  });
});

// --- reconcileImageCache (#69 — whole-document replace) ---------------------

function imageLayer(id: string, src: string): ImageLayer {
  return { id, name: id, type: 'image', src, x: 0, y: 0, width: 10, height: 10 };
}

describe('reconcileImageCache', () => {
  it('evicts an entry whose id no longer has an image layer in the next doc', () => {
    const cache = new Map<string, { src: string }>([['a', { src: 'data:1' }]]);
    reconcileImageCache(cache, []);
    expect(cache.has('a')).toBe(false);
  });

  it('evicts a same-id entry when the src differs (a reused id must not keep a stale bitmap)', () => {
    const cache = new Map<string, { src: string }>([['a', { src: 'data:old' }]]);
    reconcileImageCache(cache, [imageLayer('a', 'data:new')]);
    expect(cache.has('a')).toBe(false);
  });

  it('keeps a same-id, same-src entry untouched', () => {
    const cached = { src: 'data:same' };
    const cache = new Map<string, { src: string }>([['a', cached]]);
    reconcileImageCache(cache, [imageLayer('a', 'data:same')]);
    expect(cache.get('a')).toBe(cached);
  });

  it('ignores non-image layers when building the reconciliation set', () => {
    const cache = new Map<string, { src: string }>([['a', { src: 'data:1' }]]);
    const shapeLayer: Layer = {
      id: 'a',
      name: 'a',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: 1,
    };
    reconcileImageCache(cache, [shapeLayer]);
    expect(cache.has('a')).toBe(false);
  });
});

// --- text layer loading-dim + repaint-on-load (#67) --------------------------
//
// jsdom has no real 2D canvas, so getContext is stubbed with a Proxy that
// records every property assignment (globalAlpha, fillStyle, …) onto a plain
// object — the same technique pattern-picker.test.tsx uses. Unset properties
// fall back to a no-op function (so arbitrary Canvas method calls don't
// throw), EXCEPT globalAlpha, which real CanvasRenderingContext2D defaults to
// 1 — the renderer reads it as an "inherited alpha" baseline (to combine with
// the ghost pass's dim), so the fake must mirror that real default. `ensureFont`
// / `isFontLoading` are mocked (google-font-loader.ts and fonts.ts already
// have their own unit tests for the loading pipeline itself); this block only
// proves renderer.ts's wiring: it dims while loading, combines with an
// inherited alpha instead of overwriting it, and reads the layer's content as
// the sample text passed to ensureFont.
describe('renderScene — text loading-dim + repaint-on-load (#67)', () => {
  let store: Record<string, unknown>;
  // A layer entirely outside the panel is drawn by BOTH the ghost pass and
  // the (clip-away) main pass, so the fake ctx's single `store.globalAlpha`
  // gets overwritten by whichever pass ran last — every assignment is
  // recorded here instead so the ghost-combining test can check the specific
  // value the ghost pass set, not just the final one.
  let alphaHistory: unknown[];
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const CAM: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };

  const textLayer: TextLayer = {
    id: 't1',
    name: 'Text',
    type: 'text',
    content: 'HELLO',
    fontFamily: 'Some Google Font',
    sizeMm: 6,
    x: 0,
    y: 0,
    color: 1,
  };

  beforeEach(() => {
    alphaHistory = [];
    HTMLCanvasElement.prototype.getContext = ((): CanvasRenderingContext2D => {
      store = {};
      return new Proxy(store, {
        get: (t, p: string) => {
          if (p in t) return t[p];
          if (p === 'globalAlpha') return 1;
          // outsidePanelRegion's boundary check measures every layer's bbox
          // (including text, via measureTextBbox) regardless of layer type —
          // a bare no-op would return undefined and crash on `.width`.
          if (p === 'measureText') return () => ({ width: 0 });
          return () => undefined;
        },
        set: (t, p: string, v) => {
          if (p === 'globalAlpha') alphaHistory.push(v);
          t[p] = v;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.clearAllMocks();
  });

  function renderWith(
    layer: TextLayer,
    options: { requestRepaint?: () => void; showOutsidePanel?: boolean } = {},
  ): void {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    renderScene(canvas, { layers: [layer] }, PANEL, CAM, {
      selectedIds: [],
      images: new Map(),
      showNodes: false,
      showOutsidePanel: options.showOutsidePanel ?? false,
      requestRepaint: options.requestRepaint ?? vi.fn(),
    });
  }

  it('dims a loading text layer to 30% opacity', () => {
    vi.mocked(isFontLoading).mockReturnValue(true);
    renderWith(textLayer);
    expect(store.globalAlpha).toBe(0.3);
  });

  it('paints at full opacity once the font is no longer loading', () => {
    vi.mocked(isFontLoading).mockReturnValue(false);
    renderWith(textLayer);
    expect(store.globalAlpha).toBe(1);
  });

  it('combines the loading dim with the outside-panel ghost alpha instead of overwriting it', () => {
    // a layer positioned entirely outside the panel is eligible for the
    // ghost pass, which pre-sets globalAlpha to OUTSIDE_GHOST_ALPHA (0.35)
    // before drawLayer runs
    const offPanelLayer: TextLayer = { ...textLayer, x: 1000, y: 1000 };
    vi.mocked(isFontLoading).mockReturnValue(true);
    renderWith(offPanelLayer, { showOutsidePanel: true });
    expect(alphaHistory).toContain(0.35 * 0.3);
  });

  it('kicks off ensureFont with the layer content as sample text, and repaints once it resolves', async () => {
    const requestRepaint = vi.fn();
    vi.mocked(ensureFont).mockReturnValue(Promise.resolve());
    renderWith(textLayer, { requestRepaint });

    expect(ensureFont).toHaveBeenCalledWith('Some Google Font', 'HELLO');
    await Promise.resolve();
    await Promise.resolve();
    expect(requestRepaint).toHaveBeenCalledTimes(1);
  });
});

// --- pattern square: bbox + translate/clip/draw sequence (#96) ---------------
//
// jsdom cannot rasterize, so "draws only inside square ∩ panel" is proven at
// the command level: the pattern branch must clip to its own square rect
// (a SEPARATE clip op that intersects the caller's panel clip) before the
// generator draws, and the generator must receive the square side as its
// span. The pixel-level proof that a canvas clip actually masks pixels lives
// in e2e (editor-view.spec.ts's probe technique).
describe('pattern square (#96)', () => {
  const patternLayer: PatternLayer = {
    id: 'g1',
    name: 'Grid',
    type: 'pattern',
    patternType: 'dot-grid',
    params: { pitch: 5 },
    color: 1,
    x: 12,
    y: 34,
    size: 40,
  };

  it('layerBbox returns the layer square, not the panel rect', () => {
    expect(layerBbox(patternLayer)).toEqual({ x: 12, y: 34, width: 40, height: 40 });
  });

  describe('renderScene draw branch', () => {
    interface CtxCall {
      method: string;
      args: unknown[];
    }
    let calls: CtxCall[];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const CAM: Camera = { pxPerMm: 1, offsetX: 0, offsetY: 0 };

    beforeEach(() => {
      calls = [];
      HTMLCanvasElement.prototype.getContext = ((): CanvasRenderingContext2D => {
        const store: Record<string, unknown> = {};
        return new Proxy(store, {
          get: (t, p: string) => {
            if (p in t) return t[p];
            if (p === 'globalAlpha') return 1;
            if (p === 'measureText') return () => ({ width: 0 });
            return (...args: unknown[]) => {
              calls.push({ method: p, args });
              return undefined;
            };
          },
          set: (t, p: string, v) => {
            t[p] = v;
            return true;
          },
        }) as unknown as CanvasRenderingContext2D;
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    });

    afterEach(() => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      vi.clearAllMocks();
    });

    function renderPattern(layer: PatternLayer): {
      gen: { draw: ReturnType<typeof vi.fn> };
    } {
      const gen = { draw: vi.fn(() => calls.push({ method: 'gen.draw', args: [] })) };
      vi.mocked(patternByName).mockReturnValue(
        gen as unknown as ReturnType<typeof patternByName>,
      );
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      renderScene(canvas, { layers: [layer] }, PANEL, CAM, {
        selectedIds: [],
        images: new Map(),
        showNodes: false,
        showOutsidePanel: false,
        requestRepaint: vi.fn(),
      });
      return { gen };
    }

    it('translates to the square origin, clips to the square, then draws with the square span', () => {
      const { gen } = renderPattern(patternLayer);

      expect(gen.draw).toHaveBeenCalledTimes(1);
      const opts = gen.draw.mock.calls[0][1] as {
        widthMm: number;
        heightMm: number;
        color: string;
        params: Record<string, number>;
      };
      expect(opts).toEqual({
        widthMm: 40,
        heightMm: 40,
        color: PALETTE[1].hex,
        params: { pitch: 5 },
      });

      const indexOf = (method: string, args?: unknown[]) =>
        calls.findIndex(
          (c) => c.method === method && (args === undefined || JSON.stringify(c.args) === JSON.stringify(args)),
        );
      const translateIdx = indexOf('translate', [12, 34]);
      const squareRectIdx = indexOf('rect', [0, 0, 40, 40]);
      const drawIdx = indexOf('gen.draw');
      expect(translateIdx).toBeGreaterThan(-1);
      expect(squareRectIdx).toBeGreaterThan(translateIdx);
      const clipIdx = calls.findIndex((c, i) => c.method === 'clip' && i > squareRectIdx);
      expect(clipIdx).toBeGreaterThan(squareRectIdx);
      expect(drawIdx).toBeGreaterThan(clipIdx);
      // its own save/restore pair wraps the translate+clip so they never leak
      const restoreAfterDraw = calls.findIndex((c, i) => c.method === 'restore' && i > drawIdx);
      expect(restoreAfterDraw).toBeGreaterThan(drawIdx);
    });

    it('the square clip is separate from the panel clip (both plain clips, no even-odd)', () => {
      renderPattern(patternLayer);
      // main pass: panel rect clip, then (inside drawLayer) the square clip —
      // two separate plain clip() calls, so canvas intersects them naturally.
      const clips = calls.filter((c) => c.method === 'clip');
      expect(clips.length).toBeGreaterThanOrEqual(2);
      expect(clips.every((c) => c.args.length === 0)).toBe(true);
    });

    it.each([0, -1, NaN, Infinity])(
      'skips the draw entirely for a non-finite/non-positive size (%s)',
      (size) => {
        const { gen } = renderPattern({ ...patternLayer, size });
        expect(gen.draw).not.toHaveBeenCalled();
        // no square translate either — the guard sits before any ctx work
        expect(calls.some((c) => c.method === 'translate' && c.args[0] === 12)).toBe(false);
      },
    );

    it('skips the draw for an unknown patternType without touching the ctx clip state', () => {
      vi.mocked(patternByName).mockReturnValue(undefined);
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      renderScene(canvas, { layers: [patternLayer] }, PANEL, CAM, {
        selectedIds: [],
        images: new Map(),
        showNodes: false,
        showOutsidePanel: false,
        requestRepaint: vi.fn(),
      });
      expect(calls.some((c) => c.method === 'rect' && c.args[2] === 40)).toBe(false);
    });
  });
});
