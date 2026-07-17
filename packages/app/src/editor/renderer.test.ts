// Selection-chrome bounds (#45). selectionBboxes is the pure set the chrome
// pass strokes (one dashed box per selected layer) and the combined bbox unions
// over. Text is deliberately excluded here — it needs Canvas metrics
// (measureTextBbox), which jsdom/node lack; shapes and paths cover the rule.
import { describe, expect, it } from 'vitest';
import { mergeBboxes, type Layer, type Rect, type ShapeLayer } from '@zpd/core';
import {
  canRotate,
  CORNER_HANDLE_IDS,
  cornerHandleRects,
  multiResizeBbox,
  resizeHandleRects,
  ROTATE_HANDLE_OFFSET_PX,
  rotateHandleScreenPos,
  selectionBboxes,
} from './renderer';
import type { Camera } from './camera';
import type { PanelDims } from './types';

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function shape(id: string, x: number, y: number, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width: 10, height: 10, color: 1, ...extra };
}

describe('selectionBboxes', () => {
  it('returns one axis-aligned bbox per selected layer, in selection order', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20), shape('c', 40, 40)];
    const boxes = selectionBboxes(layers, ['a', 'c'], PANEL);
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 40, y: 40, width: 10, height: 10 },
    ]);
  });

  it('skips hidden layers so their chrome vanishes with the layer paint', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20, { hidden: true })];
    expect(selectionBboxes(layers, ['a', 'b'], PANEL)).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('drops ids absent from the doc (stale after delete/undo)', () => {
    const layers: Layer[] = [shape('a', 0, 0)];
    expect(selectionBboxes(layers, ['a', 'ghost'], PANEL)).toHaveLength(1);
  });

  it('expands a rotated shape to its rotated AABB, not its raw rect', () => {
    // 90° rotation of a 10×10 square about its own center is bounds-identical,
    // so use a non-square to prove the AABB widened.
    const layers: Layer[] = [shape('r', 0, 0, { width: 20, height: 10, rotation: 90 })];
    const [box] = selectionBboxes(layers, ['r'], PANEL);
    expect(box.width).toBeCloseTo(10);
    expect(box.height).toBeCloseTo(20);
  });

  it('the combined bbox (mergeBboxes) encloses every selected layer', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    const combined = mergeBboxes(selectionBboxes(layers, ['a', 'b'], PANEL));
    expect(combined).toEqual({ x: 0, y: 0, width: 50, height: 40 });
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
      canRotate({ id: 'i', name: 'i', type: 'image', src: 'data:,', x: 0, y: 0, width: 1, height: 1 }),
    ).toBe(false);
    expect(
      canRotate({ id: 'g', name: 'g', type: 'pattern', patternType: 'dot-grid', params: {}, color: 1 }),
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
});

describe('multiResizeBbox (#52 eligibility gate)', () => {
  it('returns the combined bbox for a multi-selection of scalable layers', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    expect(multiResizeBbox(layers, ['a', 'b'], PANEL)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });

  it('is null for a single selection — that is the 8-handle path, not this one', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    expect(multiResizeBbox(layers, ['a'], PANEL)).toBeNull();
  });

  it('is null when hidden members leave fewer than two visible bboxes', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30, { hidden: true })];
    expect(multiResizeBbox(layers, ['a', 'b'], PANEL)).toBeNull();
  });

  it('is null for a pattern-only multi-selection — nothing in it can scale', () => {
    const layers: Layer[] = [pattern('g1'), pattern('g2')];
    expect(multiResizeBbox(layers, ['g1', 'g2'], PANEL)).toBeNull();
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
    expect(multiResizeBbox([pattern('g1'), emptyPath], ['g1', 'p0'], PANEL)).toBeNull();
  });

  it('a pattern plus a shape still qualifies (the shape is scalable)', () => {
    const layers: Layer[] = [pattern('g1'), shape('a', 10, 10)];
    // the pattern's bbox is panel-wide, so the union is the panel rect
    expect(multiResizeBbox(layers, ['g1', 'a'], PANEL)).toEqual({
      x: 0,
      y: 0,
      width: PANEL.widthMm,
      height: PANEL.heightMm,
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
