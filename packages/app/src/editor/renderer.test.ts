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
  rotatedRectAABB,
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
  layerRotation,
  formatRotateDeltaBadge,
  measureTextBbox,
  multiResizeBbox,
  multiRotateBbox,
  multiRotateKnobScreenPos,
  reconcileImageCache,
  renderScene,
  resizeHandleRects,
  ROTATE_HANDLE_OFFSET_PX,
  rotateHandleScreenPos,
  selectionBboxes,
} from './renderer';
import {
  ensureFontAttempt,
  type FontAttemptStatus,
  type FontInitialResult,
  type FontLoadAttempt,
} from './fonts';
import {
  getTextGeometry,
  reconcileTextGeometry,
  resetTextGeometryForTests,
  resetTextGeometryNamespace,
  setTextMeasureForTests,
} from './text-geometry';
import type { Camera } from './camera';
import type { PanelDims } from './types';
import { layerAlignRect } from './align-ops';
import { outsidePanelRegion } from './outside-panel-region';
import { hitTestCanonicalText, marqueeHitIds } from './tools/select';

vi.mock('./fonts', () => ({
  ensureFontAttempt: vi.fn(),
  fontRequestKey: (family: string, sampleText?: string) =>
    `${family.length}:${family}:${sampleText ?? ''}`,
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
    expect(selectionBboxes(layers, ['a', 'b'])).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
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
    expect(selectionBboxes(layers, ['m'])).toEqual([{ x: -10, y: 0, width: 30, height: 10 }]);
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

describe('canRotate (#51 eligibility, image joined in #147)', () => {
  it('is true for exactly the types layerRotation reads: shape, text, and image', () => {
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
    ).toBe(true);
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

describe('layerRotation — image (#147)', () => {
  const image: ImageLayer = {
    id: 'i',
    name: 'i',
    type: 'image',
    src: 'data:,',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };

  it('reads the rotation field when set', () => {
    expect(layerRotation({ ...image, rotation: 45 })).toBe(45);
  });

  it('defaults to 0 when rotation is unset', () => {
    expect(layerRotation(image)).toBe(0);
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

describe('multiRotateBbox (#152 eligibility gate)', () => {
  it('returns the combined bbox when at least one selected leaf is rotatable', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    expect(multiRotateBbox(layers, ['a', 'b'])).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('is null for a pattern-only selection — nothing in it can rotate', () => {
    const layers: Layer[] = [pattern('g1'), pattern('g2')];
    expect(multiRotateBbox(layers, ['g1', 'g2'])).toBeNull();
  });

  it('a pattern plus a shape qualifies, and the union spans the ROTATABLE leaf only', () => {
    // ONE bounds/pivot pair for knob, grab, gesture pivot and mid-gesture
    // chrome: the pattern must not displace it (it would make the knob jump
    // off the pointer's ray on the first tick).
    const layers: Layer[] = [pattern('g1'), shape('a', 10, 10)];
    expect(multiRotateBbox(layers, ['g1', 'a'])).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  });

  it('is null for a pattern plus an EMPTY path — the bake cannot change either', () => {
    // Same phantom-gesture guard as multiResizeBbox: a knob here would open
    // an undo entry that changes nothing.
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
    expect(multiRotateBbox([pattern('g1'), emptyPath], ['g1', 'p0'])).toBeNull();
  });

  it('is null when the only rotatable member is hidden', () => {
    const layers: Layer[] = [shape('a', 0, 0, { hidden: true }), pattern('g1')];
    expect(multiRotateBbox(layers, ['a', 'g1'])).toEqual(null);
  });

  it('unlike multiResizeBbox, a SINGLE leaf qualifies (one-child group case)', () => {
    // Combined overlay mode is the caller's precondition; a one-child group
    // resolves to one leaf and still rotates (#152).
    const layers: Layer[] = [shape('a', 0, 0)];
    expect(multiRotateBbox(layers, ['a'])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('paths are rotatable (they bake via point geometry, no rotation field needed)', () => {
    const path: Layer = {
      id: 'p1',
      name: 'p1',
      type: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
      fill: null,
      stroke: 1,
      strokeWidth: 1,
    };
    expect(multiRotateBbox([path, pattern('g1')], ['p1', 'g1'])).not.toBeNull();
  });
});

describe('multiRotateKnobScreenPos (#152 — shared draw/hit-test geometry)', () => {
  const bounds: Rect = { x: 10, y: 10, width: 20, height: 10 }; // top-mid (20, 10)

  it('delta 0 is an exact pass-through of the single-rotate handle position', () => {
    expect(multiRotateKnobScreenPos(bounds, { x: 20, y: 15 }, 0, IDENTITY)).toEqual(
      rotateHandleScreenPos(bounds, 0, IDENTITY),
    );
  });

  it('orbits the knob about the pivot by the delta (90° cw puts it right of the pivot)', () => {
    const pivot = { x: 20, y: 15 };
    const knob = multiRotateKnobScreenPos(bounds, pivot, 90, IDENTITY);
    // base knob: (20, 10 - ROTATE_HANDLE_OFFSET_PX) = (20, -10), 25px above
    // the pivot; 90° cw about (20, 15) in y-down screen space → (45, 15).
    expect(knob.x).toBeCloseTo(45);
    expect(knob.y).toBeCloseTo(15);
  });
});

describe('formatRotateDeltaBadge (#152 — signed delta label)', () => {
  it('formats positive, negative and zero deltas', () => {
    expect(formatRotateDeltaBadge(37.5)).toBe('+37.5°');
    expect(formatRotateDeltaBadge(-45)).toBe('-45.0°');
    expect(formatRotateDeltaBadge(0)).toBe('+0.0°');
  });

  it('folds -0 so a counter-clockwise jitter never flashes "-0.0°"', () => {
    expect(formatRotateDeltaBadge(-0)).toBe('+0.0°');
  });

  it('stays signed past ±180° (unwrapped deltas accumulate)', () => {
    expect(formatRotateDeltaBadge(270)).toBe('+270.0°');
    expect(formatRotateDeltaBadge(-190.5)).toBe('-190.5°');
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

// --- rotated image paint transform (#147) ------------------------------------
//
// Same jsdom-can't-rasterize constraint as the pattern-square block above:
// the transform MATH is proven at the command level (translate/rotate/
// translate about the bbox center, then drawImage), not by inspecting pixels.
describe('paintLayer — rotated image (#147)', () => {
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

  it('rotates about the bbox center (translate/rotate/translate) then paints via drawImage', () => {
    // 20x10 image at (10,20) — bbox center (20,25) — rotated 90deg.
    const layer: ImageLayer = {
      id: 'img-1',
      name: 'Reference',
      type: 'image',
      src: 'data:,',
      x: 10,
      y: 20,
      width: 20,
      height: 10,
      rotation: 90,
    };
    const fakeImg = { complete: true, naturalWidth: 20, naturalHeight: 10 } as HTMLImageElement;

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    renderScene(canvas, { layers: [layer] }, PANEL, CAM, {
      selectedIds: [],
      images: new Map([['img-1', fakeImg]]),
      showNodes: false,
      showOutsidePanel: false,
      requestRepaint: vi.fn(),
    });

    const translateToCenterIdx = calls.findIndex(
      (c) => c.method === 'translate' && c.args[0] === 20 && c.args[1] === 25,
    );
    const rotateIdx = calls.findIndex(
      (c, i) => i > translateToCenterIdx && c.method === 'rotate' && c.args[0] === Math.PI / 2,
    );
    const translateBackIdx = calls.findIndex(
      (c, i) => i > rotateIdx && c.method === 'translate' && c.args[0] === -20 && c.args[1] === -25,
    );
    const drawIdx = calls.findIndex(
      (c, i) => i > translateBackIdx && c.method === 'drawImage' && c.args[0] === fakeImg,
    );
    expect(translateToCenterIdx).toBeGreaterThan(-1);
    expect(rotateIdx).toBeGreaterThan(translateToCenterIdx);
    expect(translateBackIdx).toBeGreaterThan(rotateIdx);
    expect(drawIdx).toBeGreaterThan(translateBackIdx);
    expect(calls[drawIdx].args).toEqual([fakeImg, 10, 20, 20, 10]);
  });

  it('unrotated image paints with no rotate call at all', () => {
    const layer: ImageLayer = {
      id: 'img-2',
      name: 'Reference',
      type: 'image',
      src: 'data:,',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const fakeImg = { complete: true, naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement;

    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    renderScene(canvas, { layers: [layer] }, PANEL, CAM, {
      selectedIds: [],
      images: new Map([['img-2', fakeImg]]),
      showNodes: false,
      showOutsidePanel: false,
      requestRepaint: vi.fn(),
    });

    expect(calls.some((c) => c.method === 'rotate')).toBe(false);
    expect(calls.some((c) => c.method === 'drawImage')).toBe(true);
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
  let canvasCalls: { method: string; args: unknown[] }[];
  let fontStatus: FontAttemptStatus;
  let settleInitial: (result: FontInitialResult) => void;
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
    resetTextGeometryForTests();
    fontStatus = 'pending';
    let settle: (result: FontInitialResult) => void = () => {};
    const initial = new Promise<FontInitialResult>((resolve) => {
      settle = resolve;
    });
    settleInitial = settle;
    const attempt: FontLoadAttempt = {
      initial,
      done: initial.then(() => {}),
      getStatus: () => fontStatus,
      onLateReady: () => () => {},
    };
    vi.mocked(ensureFontAttempt).mockReturnValue(attempt);
    alphaHistory = [];
    canvasCalls = [];
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
          return (...args: unknown[]) => {
            canvasCalls.push({ method: p, args });
          };
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
    resetTextGeometryForTests();
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
    renderWith(textLayer);
    expect(alphaHistory).toContain(0.3);
  });

  it('paints at full opacity once the font is no longer loading', () => {
    fontStatus = 'ready';
    renderWith(textLayer);
    expect(alphaHistory).toContain(1);
  });

  it('combines the loading dim with the outside-panel ghost alpha instead of overwriting it', () => {
    // a layer positioned entirely outside the panel is eligible for the
    // ghost pass, which pre-sets globalAlpha to OUTSIDE_GHOST_ALPHA (0.35)
    // before drawLayer runs
    const offPanelLayer: TextLayer = { ...textLayer, x: 1000, y: 1000 };
    renderWith(offPanelLayer, { showOutsidePanel: true });
    expect(alphaHistory).toContain(0.35 * 0.3);
  });

  it('owns the exact font attempt and repaints once its initial wait resolves', async () => {
    const requestRepaint = vi.fn();
    renderWith(textLayer, { requestRepaint });

    expect(ensureFontAttempt).toHaveBeenCalledWith('Some Google Font', 'HELLO');
    fontStatus = 'ready';
    settleInitial('ready');
    await Promise.resolve();
    await Promise.resolve();
    expect(requestRepaint).toHaveBeenCalledTimes(1);
  });

  it('uses the same preserved pivot and recentered box origin for transform and paint', async () => {
    const layer = { ...textLayer, content: 'AAAAA\nBB', sizeMm: 8, x: 10, y: 20, rotation: 90 };
    setTextMeasureForTests((next) => ({
      x: next.x,
      y: next.y,
      width: fontStatus === 'ready' ? 60 : 40,
      height: 20,
    }));
    renderWith(layer);
    expect(canvasCalls).toContainEqual({ method: 'translate', args: [30, 30] });
    expect(canvasCalls).toContainEqual({ method: 'translate', args: [-30, -30] });
    expect(canvasCalls).toContainEqual({ method: 'fillText', args: ['AAAAA', 10, 20] });
    expect(alphaHistory).toContain(0.3);

    canvasCalls = [];
    alphaHistory = [];
    fontStatus = 'ready';
    settleInitial('ready');
    await Promise.resolve();
    renderWith(layer);
    expect(canvasCalls).toContainEqual({ method: 'translate', args: [30, 30] });
    expect(canvasCalls).toContainEqual({ method: 'translate', args: [-30, -30] });
    expect(canvasCalls).toContainEqual({ method: 'fillText', args: ['AAAAA', 0, 20] });
    expect(alphaHistory).toContain(1);
  });

  it('does not request a font or paint invalid text sizes', () => {
    vi.mocked(ensureFontAttempt).mockClear();
    renderWith({ ...textLayer, sizeMm: 0, rotation: 90 });
    expect(ensureFontAttempt).not.toHaveBeenCalled();
    expect(canvasCalls.some((call) => call.method === 'fillText')).toBe(false);
  });
});

// --- canonical rotated-text geometry (#111) ---------------------------------

interface ControlledFontAttempt {
  attempt: FontLoadAttempt;
  settle(result: FontInitialResult): void;
  lateReady(): void;
}

function controlledFontAttempt(): ControlledFontAttempt {
  let status: FontAttemptStatus = 'pending';
  let settled = false;
  let resolveInitial: (result: FontInitialResult) => void = () => {};
  const lateCallbacks = new Set<() => void>();
  const initial = new Promise<FontInitialResult>((resolve) => {
    resolveInitial = resolve;
  });
  const attempt: FontLoadAttempt = {
    initial,
    done: initial.then(() => {}),
    getStatus: () => status,
    onLateReady(callback) {
      if (status !== 'pending' && status !== 'timed-out') return () => {};
      lateCallbacks.add(callback);
      return () => lateCallbacks.delete(callback);
    },
  };
  return {
    attempt,
    settle(result) {
      if (settled) return;
      settled = true;
      status = result;
      if (result !== 'timed-out') lateCallbacks.clear();
      resolveInitial(result);
    },
    lateReady() {
      if (status !== 'timed-out') return;
      status = 'late-ready';
      for (const callback of [...lateCallbacks]) callback();
      lateCallbacks.clear();
    },
  };
}

const rotatedText = (extra: Partial<TextLayer> = {}): TextLayer => ({
  id: 'text-oracle',
  name: 'Rotated text',
  type: 'text',
  content: 'AAAAA\nBB',
  fontFamily: 'Oracle Font',
  sizeMm: 8,
  x: 10,
  y: 20,
  rotation: 90,
  color: 1,
  ...extra,
});

function expectRectClose(actual: Rect | null, expected: Rect): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x);
  expect(actual!.y).toBeCloseTo(expected.y);
  expect(actual!.width).toBeCloseTo(expected.width);
  expect(actual!.height).toBeCloseTo(expected.height);
}

function expectPointsClose(
  actual: readonly { x: number; y: number }[],
  expected: readonly { x: number; y: number }[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, point] of actual.entries()) {
    expect(point.x).toBeCloseTo(expected[index].x);
    expect(point.y).toBeCloseTo(expected[index].y);
  }
}

describe('canonical rotated text geometry (#111)', () => {
  let font: ControlledFontAttempt;

  beforeEach(() => {
    resetTextGeometryForTests();
    font = controlledFontAttempt();
    vi.mocked(ensureFontAttempt).mockReturnValue(font.attempt);
    // Numeric oracle: fallback width = 5*size (40 at 8mm), loaded width =
    // 7.5*size (60 at 8mm). Height is always 1.25*size*lineCount.
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width:
        layer.sizeMm *
        (font.attempt.getStatus() === 'ready' || font.attempt.getStatus() === 'late-ready'
          ? 7.5
          : 5),
      height: layer.sizeMm * 1.25 * layer.content.split('\n').length,
    }));
  });

  afterEach(() => {
    resetTextGeometryForTests();
    vi.clearAllMocks();
  });

  it('measures maximum line width while counting blank and trailing lines at 1.25 line height', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    try {
      resetTextGeometryForTests();
      HTMLCanvasElement.prototype.getContext = (() =>
        ({
          font: '',
          measureText: (text: string) => ({ width: text.length * 3 }),
        }) as unknown as CanvasRenderingContext2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;
      const multiline = rotatedText({ content: 'A\n\nBBBB\n' });
      expect(measureTextBbox(multiline)).toEqual({ x: 10, y: 20, width: 12, height: 40 });
      expect(measureTextBbox(rotatedText({ content: '' }))).toEqual({
        x: 10,
        y: 20,
        width: 0,
        height: 10,
      });
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      resetTextGeometryForTests();
    }
  });

  it('locks B0 -> B1 to one pivot and exposes the same raw/AABB/chrome/handle oracle', async () => {
    const layer = rotatedText();
    const repaint = vi.fn();
    reconcileTextGeometry([layer], repaint);

    const fallback = getTextGeometry(layer)!;
    expectRectClose(fallback.box, { x: 10, y: 20, width: 40, height: 20 });
    expect(fallback.pivot).toEqual({ x: 30, y: 30 });
    expect(fallback.loading).toBe(true);
    expectRectClose(rotatedRectAABB(fallback.box, 90), {
      x: 20,
      y: 10,
      width: 20,
      height: 40,
    });
    expectRectClose(layerBbox(layer), fallback.box);
    expectRectClose(selectionBboxes([layer], [layer.id])[0], {
      x: 20,
      y: 10,
      width: 20,
      height: 40,
    });
    const fallbackAlignRect = layerAlignRect(layer);
    expect(fallbackAlignRect.x).toBeCloseTo(20);
    expect(fallbackAlignRect.y).toBeCloseTo(10);
    expect(fallbackAlignRect.w).toBeCloseTo(20);
    expect(fallbackAlignRect.h).toBeCloseTo(40);
    expect(50 - (fallbackAlignRect.x + fallbackAlignRect.w / 2)).toBeCloseTo(20);
    expectPointsClose(
      ['nw', 'ne', 'se', 'sw'].map((id) => handleCenter(fallback.box, IDENTITY, 90, id)),
      [
        { x: 40, y: 10 },
        { x: 40, y: 50 },
        { x: 20, y: 50 },
        { x: 20, y: 10 },
      ],
    );
    expect(rotateHandleScreenPos(fallback.box, 90, IDENTITY).x).toBeCloseTo(60);
    expect(rotateHandleScreenPos(fallback.box, 90, IDENTITY).y).toBeCloseTo(30);
    expect(
      outsidePanelRegion(true, [layer], { cssW: 100, cssH: 100 }, IDENTITY, {
        widthMm: 40,
        heightMm: 50,
      })!.ghostLayers,
    ).toEqual([]);

    font.settle('ready');
    await Promise.resolve();
    expect(repaint).toHaveBeenCalledTimes(1);
    const loaded = getTextGeometry(layer)!;
    expectRectClose(loaded.box, { x: 0, y: 20, width: 60, height: 20 });
    expect(loaded.pivot).toEqual({ x: 30, y: 30 });
    expect(loaded.loading).toBe(false);
    expect(loaded.metricRevision).toBeGreaterThan(fallback.metricRevision);
    expectRectClose(rotatedRectAABB(loaded.box, 90), {
      x: 20,
      y: 0,
      width: 20,
      height: 60,
    });
    expectRectClose(layerBbox(layer), loaded.box);
    expectRectClose(selectionBboxes([layer], [layer.id])[0], {
      x: 20,
      y: 0,
      width: 20,
      height: 60,
    });
    const loadedAlignRect = layerAlignRect(layer);
    expect(loadedAlignRect.x).toBeCloseTo(20);
    expect(loadedAlignRect.y).toBeCloseTo(0);
    expect(loadedAlignRect.w).toBeCloseTo(20);
    expect(loadedAlignRect.h).toBeCloseTo(60);
    expect(50 - (loadedAlignRect.x + loadedAlignRect.w / 2)).toBeCloseTo(20);
    expectPointsClose(
      ['nw', 'ne', 'se', 'sw'].map((id) => handleCenter(loaded.box, IDENTITY, 90, id)),
      [
        { x: 40, y: 0 },
        { x: 40, y: 60 },
        { x: 20, y: 60 },
        { x: 20, y: 0 },
      ],
    );
    expect(rotateHandleScreenPos(loaded.box, 90, IDENTITY).x).toBeCloseTo(60);
    expect(rotateHandleScreenPos(loaded.box, 90, IDENTITY).y).toBeCloseTo(30);
    expect(
      outsidePanelRegion(true, [layer], { cssW: 100, cssH: 100 }, IDENTITY, {
        widthMm: 40,
        heightMm: 50,
      })!.ghostLayers,
    ).toEqual([layer]);
    expect(getTextGeometry(layer)!.metricRevision).toBe(loaded.metricRevision);
  });

  it('locks direct-hit and marquee consumers to the B0/B1 numeric probes', async () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    getTextGeometry(layer);
    const sharedHit = { x: 30, y: 45 };
    const loadedOnlyHit = { x: 30, y: 55 };
    const loadedOnlyMarquee = { x: 25, y: 52, width: 10, height: 5 };
    expect(hitTestCanonicalText(layer, sharedHit)).toBe(true);
    expect(hitTestCanonicalText(layer, loadedOnlyHit)).toBe(false);
    expect(marqueeHitIds([layer], loadedOnlyMarquee)).toEqual([]);

    font.settle('ready');
    await Promise.resolve();
    expect(hitTestCanonicalText(layer, sharedHit)).toBe(true);
    expect(hitTestCanonicalText(layer, loadedOnlyHit)).toBe(true);
    expect(marqueeHitIds([layer], loadedOnlyMarquee)).toEqual([layer.id]);
  });

  it('translates a cached pivot and preserves it across nonzero rotation edits', () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    const first = getTextGeometry(layer)!;
    const moved = { ...layer, x: 15, y: 27, rotation: 45 };
    reconcileTextGeometry([moved]);
    const next = getTextGeometry(moved)!;
    expect(next.pivot).toEqual({ x: first.pivot.x + 5, y: first.pivot.y + 7 });
    expectRectClose(next.box, { x: 15, y: 27, width: 40, height: 20 });
    expect(next.metricRevision).toBe(first.metricRevision);
  });

  it('evicts at zero rotation and captures a fresh pivot when rotation becomes nonzero again', () => {
    const firstLayer = rotatedText();
    reconcileTextGeometry([firstLayer]);
    expect(getTextGeometry(firstLayer)!.pivot).toEqual({ x: 30, y: 30 });

    const zero = { ...firstLayer, x: 100, y: 50, rotation: 0 };
    reconcileTextGeometry([zero]);
    expect(getTextGeometry(zero)!.pivot).toEqual({ x: 120, y: 60 });

    const rotatedAgain = { ...zero, rotation: 30 };
    reconcileTextGeometry([rotatedAgain]);
    expect(getTextGeometry(rotatedAgain)!.pivot).toEqual({ x: 120, y: 60 });
  });

  it('applies the locked fixed-anchor size transform and recenters newly measured metrics', async () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    getTextGeometry(layer);
    font.settle('ready');
    await Promise.resolve();
    const loaded = getTextGeometry(layer)!;
    expect(loaded.pivot).toEqual({ x: 30, y: 30 });

    const scaled = { ...layer, x: 20, y: 40, sizeMm: 16 };
    reconcileTextGeometry([scaled]);
    const geometry = getTextGeometry(scaled)!;
    expect(geometry.pivot).toEqual({ x: 60, y: 60 });
    expectRectClose(geometry.box, { x: 0, y: 40, width: 120, height: 40 });
    expectRectClose(rotatedRectAABB(geometry.box, 90), {
      x: 40,
      y: 0,
      width: 40,
      height: 120,
    });
  });

  it('forces fresh captures for content and family revisions', () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    const first = getTextGeometry(layer)!;

    setTextMeasureForTests((next) => ({
      x: next.x,
      y: next.y,
      width: next.fontFamily === 'Other Oracle Font' ? 32 : 16,
      height: 20,
    }));
    const contentEdit = { ...layer, content: 'X' };
    reconcileTextGeometry([contentEdit]);
    const contentGeometry = getTextGeometry(contentEdit)!;
    expect(contentGeometry.pivot).toEqual({ x: 18, y: 30 });
    expect(contentGeometry.metricRevision).toBeGreaterThan(first.metricRevision);

    const familyEdit = { ...contentEdit, fontFamily: 'Other Oracle Font' };
    reconcileTextGeometry([familyEdit]);
    const familyGeometry = getTextGeometry(familyEdit)!;
    expect(familyGeometry.pivot).toEqual({ x: 26, y: 30 });
    expect(familyGeometry.metricRevision).toBeGreaterThan(contentGeometry.metricRevision);
  });

  it('retains hidden entries, transfers equal snapshots to a new incarnation, and prunes delete/type replacement', () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    const first = getTextGeometry(layer)!;

    const hidden = { ...layer, hidden: true };
    reconcileTextGeometry([hidden]);
    const retained = getTextGeometry(hidden)!;
    expect(retained.pivot).toEqual(first.pivot);
    expect(retained.metricRevision).toBe(first.metricRevision);
    expect(retained.documentIncarnation).toBeGreaterThan(first.documentIncarnation);

    const equalSnapshot = { ...hidden };
    reconcileTextGeometry([equalSnapshot]);
    const transferred = getTextGeometry(equalSnapshot)!;
    expect(transferred.pivot).toEqual(first.pivot);
    expect(transferred.metricRevision).toBe(first.metricRevision);
    expect(transferred.documentIncarnation).toBeGreaterThan(retained.documentIncarnation);

    const unhidden = { ...equalSnapshot, hidden: false };
    reconcileTextGeometry([unhidden]);
    const restored = getTextGeometry(unhidden)!;
    expect(restored.pivot).toEqual(first.pivot);
    expect(restored.metricRevision).toBe(first.metricRevision);

    reconcileTextGeometry([]);
    const reused = rotatedText({ x: 100, y: 50 });
    reconcileTextGeometry([reused]);
    expect(getTextGeometry(reused)!.pivot).toEqual({ x: 120, y: 60 });

    const replacement: ShapeLayer = shape(layer.id, 0, 0);
    reconcileTextGeometry([replacement]);
    const reusedAfterType = rotatedText({ x: 200, y: 80 });
    reconcileTextGeometry([reusedAfterType]);
    expect(getTextGeometry(reusedAfterType)!.pivot).toEqual({ x: 220, y: 90 });
  });

  it('evicts invalid sizes before font loading/geometry, then captures fresh when valid again', () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer]);
    getTextGeometry(layer);
    vi.mocked(ensureFontAttempt).mockClear();

    for (const sizeMm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = { ...layer, sizeMm };
      reconcileTextGeometry([invalid]);
      expect(getTextGeometry(invalid)).toBeNull();
    }
    expect(ensureFontAttempt).not.toHaveBeenCalled();

    setTextMeasureForTests((valid) => ({
      x: valid.x,
      y: valid.y,
      width: 24,
      height: 10,
    }));
    const validAgain = { ...layer, x: 50, y: 60, sizeMm: 4 };
    reconcileTextGeometry([validAgain]);
    expect(getTextGeometry(validAgain)!.pivot).toEqual({ x: 62, y: 65 });
    expect(ensureFontAttempt).toHaveBeenCalledTimes(1);
  });

  it('keeps a fresh same-request owner/pivot when the old namespace completion arrives', async () => {
    const layer = rotatedText();
    reconcileTextGeometry([layer], vi.fn());
    expect(getTextGeometry(layer)!.pivot).toEqual({ x: 30, y: 30 });

    resetTextGeometryNamespace();
    setTextMeasureForTests((next) => ({
      x: next.x,
      y: next.y,
      width: 12,
      height: 10,
    }));
    const nextDocLayer = rotatedText({ x: 10, y: 20 });
    const nextRepaint = vi.fn();
    reconcileTextGeometry([nextDocLayer], nextRepaint);
    expect(getTextGeometry(nextDocLayer)!.pivot).toEqual({ x: 16, y: 25 });

    // The font resource is shared, so its old pending observer may legitimately
    // wake the new owner. It must only remeasure around the NEW pivot.
    font.settle('ready');
    await Promise.resolve();
    expect(nextRepaint).toHaveBeenCalledTimes(1);
    const afterCompletion = getTextGeometry(nextDocLayer)!;
    expect(afterCompletion.pivot).toEqual({ x: 16, y: 25 });
    expectRectClose(afterCompletion.box, { x: 10, y: 20, width: 12, height: 10 });
  });

  it('ignores stale completions after a signature change but notifies the current owner once', async () => {
    const oldFont = controlledFontAttempt();
    const newFont = controlledFontAttempt();
    vi.mocked(ensureFontAttempt).mockImplementation((_family, sample) =>
      sample === 'NEW' ? newFont.attempt : oldFont.attempt,
    );
    const repaint = vi.fn();
    const layer = rotatedText();
    reconcileTextGeometry([layer], repaint);
    getTextGeometry(layer);

    const edited = { ...layer, content: 'NEW' };
    reconcileTextGeometry([edited]);
    getTextGeometry(edited);
    oldFont.settle('ready');
    await Promise.resolve();
    expect(repaint).not.toHaveBeenCalled();

    newFont.settle('ready');
    await Promise.resolve();
    expect(repaint).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated normal/ghost reads and emits one initial plus one late-ready repaint', async () => {
    const repaint = vi.fn();
    const layer = rotatedText();
    reconcileTextGeometry([layer], repaint);
    // These repeated reads model outside culling + ghost paint + main paint +
    // chrome in one frame; they must share one async callback owner.
    for (let i = 0; i < 6; i += 1) getTextGeometry(layer);

    const fallback = getTextGeometry(layer)!;
    font.settle('timed-out');
    await Promise.resolve();
    expect(repaint).toHaveBeenCalledTimes(1);
    const timedOut = getTextGeometry(layer)!;
    expectRectClose(timedOut.box, fallback.box);
    expect(timedOut.loading).toBe(false);
    expect(timedOut.metricRevision).toBe(fallback.metricRevision);

    font.lateReady();
    expect(repaint).toHaveBeenCalledTimes(2);
    const late = getTextGeometry(layer)!;
    expectRectClose(late.box, { x: 0, y: 20, width: 60, height: 20 });
    expect(late.pivot).toEqual({ x: 30, y: 30 });
    const revision = late.metricRevision;
    font.lateReady();
    getTextGeometry(layer);
    expect(repaint).toHaveBeenCalledTimes(2);
    expect(getTextGeometry(layer)!.metricRevision).toBe(revision);
  });

  it('turns a rejected attempt full-alpha while freezing the fallback box', async () => {
    const repaint = vi.fn();
    const layer = rotatedText();
    reconcileTextGeometry([layer], repaint);
    const fallback = getTextGeometry(layer)!;
    font.settle('failed');
    await Promise.resolve();
    expect(repaint).toHaveBeenCalledTimes(1);
    const failed = getTextGeometry(layer)!;
    expect(failed.loading).toBe(false);
    expectRectClose(failed.box, fallback.box);
    expect(failed.pivot).toEqual(fallback.pivot);
    expect(failed.metricRevision).toBe(fallback.metricRevision);
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
      vi.mocked(patternByName).mockReturnValue(gen as unknown as ReturnType<typeof patternByName>);
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
          (c) =>
            c.method === method &&
            (args === undefined || JSON.stringify(c.args) === JSON.stringify(args)),
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

    it.each([0, -1, NaN, Infinity, 1e7])(
      'skips the draw entirely for a non-finite/non-positive/absurd size (%s)',
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
