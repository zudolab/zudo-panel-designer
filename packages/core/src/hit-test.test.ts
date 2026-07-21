import { describe, expect, it } from 'vitest';
import {
  estimateTextBbox,
  hitTestDoc,
  hitTestLayer,
  hitTestPath,
  type HitTestDocLike,
  type HitTestPathLayerLike,
  type ImageLayerLike,
  type PatternLayerLike,
  type ShapeLayerLike,
  type TextLayerLike,
} from './hit-test';

describe('hitTestLayer — shape (rect)', () => {
  const rect: ShapeLayerLike = { type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10 };

  it('hits inside, misses outside', () => {
    expect(hitTestLayer(rect, 5, 5)).toBe(true);
    expect(hitTestLayer(rect, -1, 5)).toBe(false);
    expect(hitTestLayer(rect, 15, 5)).toBe(false);
  });

  it('is boundary-inclusive', () => {
    expect(hitTestLayer(rect, 0, 0)).toBe(true);
    expect(hitTestLayer(rect, 10, 10)).toBe(true);
  });
});

describe('hitTestLayer — shape (ellipse)', () => {
  const ellipse: ShapeLayerLike = { type: 'shape', shape: 'ellipse', x: 0, y: 0, width: 10, height: 10 };

  it('excludes the bbox corners (inside the rect, outside the inscribed circle)', () => {
    expect(hitTestLayer(ellipse, 5, 5)).toBe(true); // center
    expect(hitTestLayer(ellipse, 0, 0)).toBe(false); // rect corner, outside circle
    expect(hitTestLayer(ellipse, 5, 0)).toBe(true); // top of circle, on boundary
  });
});

describe('hitTestLayer — rotated rect', () => {
  // 20x10 rect, center (10,5). Rotating 90deg swaps which axis is "long".
  const rect: ShapeLayerLike = {
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 20,
    height: 10,
    rotation: 90,
  };
  const unrotated: ShapeLayerLike = { ...rect, rotation: undefined };

  it('hits a point that is only inside once rotation is applied', () => {
    expect(hitTestLayer(unrotated, 10, 13)).toBe(false); // outside the unrotated 20x10 rect
    expect(hitTestLayer(rect, 10, 13)).toBe(true); // inside once rotated 90deg about center
  });

  it('excludes a point that was inside before rotation but rotates out of the shape', () => {
    expect(hitTestLayer(unrotated, 18, 5)).toBe(true); // inside the unrotated rect
    expect(hitTestLayer(rect, 18, 5)).toBe(false); // rotated out
  });
});

describe('hitTestLayer — image', () => {
  it('behaves as an axis-aligned rect test when unrotated', () => {
    const image: ImageLayerLike = { type: 'image', x: 0, y: 0, width: 10, height: 10 };
    expect(hitTestLayer(image, 5, 5)).toBe(true);
    expect(hitTestLayer(image, 20, 20)).toBe(false);
  });

  // #147: images gained a `rotation` field, and the generic inverse-rotate
  // path (pointInRotatedRect) already reads it via ImageLayerLike's shared
  // RectLayerLike shape — same known-corner-geometry proof as the shape case
  // above, applied to an image.
  describe('rotated image', () => {
    // 20x10 image, center (10,5). Rotating 90deg swaps which axis is "long".
    const image: ImageLayerLike = { type: 'image', x: 0, y: 0, width: 20, height: 10, rotation: 90 };
    const unrotated: ImageLayerLike = { ...image, rotation: undefined };

    it('hits a point that is only inside once rotation is applied', () => {
      expect(hitTestLayer(unrotated, 10, 13)).toBe(false); // outside the unrotated 20x10 rect
      expect(hitTestLayer(image, 10, 13)).toBe(true); // inside once rotated 90deg about center
    });

    it('excludes a point that was inside before rotation but rotates out of the image', () => {
      expect(hitTestLayer(unrotated, 18, 5)).toBe(true); // inside the unrotated rect
      expect(hitTestLayer(image, 18, 5)).toBe(false); // rotated out
    });
  });
});

describe('estimateTextBbox / hitTestLayer — text', () => {
  it('estimates a bbox from content length and font size', () => {
    const text: TextLayerLike = { type: 'text', content: 'AB', sizeMm: 10, x: 0, y: 0 };
    expect(estimateTextBbox(text)).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  });

  it('uses the longest line across a multi-line string', () => {
    const text: TextLayerLike = { type: 'text', content: 'A\nBCDE', sizeMm: 10, x: 0, y: 0 };
    const bbox = estimateTextBbox(text);
    expect(bbox.width).toBe(4 * 10 * 0.6);
    expect(bbox.height).toBe(2 * 10 * 1.2);
  });

  it('hits inside the estimated bbox, misses outside', () => {
    const text: TextLayerLike = { type: 'text', content: 'AB', sizeMm: 10, x: 0, y: 0 };
    expect(hitTestLayer(text, 6, 6)).toBe(true);
    expect(hitTestLayer(text, 20, 20)).toBe(false);
  });
});

// Patterns hit on their x/y/size square since #97 (movable pattern square) —
// they were never-hit-testable before the interaction sub flipped this.
describe('hitTestLayer — pattern (square bbox)', () => {
  const pattern: PatternLayerLike = { type: 'pattern', x: 10, y: 20, size: 30 };

  it('hits inside the square, misses outside', () => {
    expect(hitTestLayer(pattern, 25, 35)).toBe(true);
    expect(hitTestLayer(pattern, 5, 35)).toBe(false); // left of the square
    expect(hitTestLayer(pattern, 25, 55)).toBe(false); // below the square
  });

  it('is boundary-inclusive like a rect', () => {
    expect(hitTestLayer(pattern, 10, 20)).toBe(true);
    expect(hitTestLayer(pattern, 40, 50)).toBe(true);
  });
});

function squarePath(fill: number | null, stroke: number | null, strokeWidth = 1): HitTestPathLayerLike {
  return {
    type: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    closed: true,
    fill,
    stroke,
    strokeWidth,
  };
}

describe('hitTestPath — fill', () => {
  it('hits inside a filled closed square, misses outside', () => {
    const path = squarePath(0, null);
    expect(hitTestPath(path, 5, 5)).toBe(true);
    expect(hitTestPath(path, 15, 15)).toBe(false);
  });

  it('never fills when fill is null, even inside', () => {
    const path = squarePath(null, null);
    expect(hitTestPath(path, 5, 5)).toBe(false);
  });

  it('never fills an open subpath even when fill is set', () => {
    const path = { ...squarePath(0, null), closed: false };
    expect(hitTestPath(path, 5, 5)).toBe(false);
  });
});

describe('hitTestPath — compound path holes', () => {
  it('excludes points inside a donut hole from the fill hit test', () => {
    const donut: HitTestPathLayerLike = {
      type: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      extraSubpaths: [
        [
          { x: 3, y: 3 },
          { x: 7, y: 3 },
          { x: 7, y: 7 },
          { x: 3, y: 7 },
        ],
      ],
      closed: true,
      fill: 0,
      stroke: null,
      strokeWidth: 1,
    };
    expect(hitTestPath(donut, 5, 5)).toBe(false); // center of the hole
    expect(hitTestPath(donut, 1, 1)).toBe(true); // in the ring, outside the hole
    expect(hitTestPath(donut, 15, 15)).toBe(false); // outside entirely
  });
});

describe('hitTestPath — stroke', () => {
  it('hits near an edge within the grab zone, misses far away', () => {
    const path = squarePath(null, 0, 1);
    expect(hitTestPath(path, 0, 5)).toBe(true); // on the left edge
    expect(hitTestPath(path, 5, 5)).toBe(false); // center, far from any edge
  });

  it('grabs thin strokes with a minimum ~1.5mm zone even when strokeWidth is tiny', () => {
    const path = squarePath(null, 0, 0.01);
    expect(hitTestPath(path, 1, 0)).toBe(true); // ~1mm from the (y=0) edge, within the 1.5mm floor
  });

  it('never strokes when stroke is null', () => {
    const path = squarePath(null, null);
    expect(hitTestPath(path, 0, 5)).toBe(false);
  });
});

describe('hitTestDoc', () => {
  const a: ShapeLayerLike & { id: string } = { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10 };
  const b: ShapeLayerLike & { id: string } = { id: 'b', type: 'shape', shape: 'rect', x: 5, y: 5, width: 10, height: 10 };

  it('returns the topmost hit layer for an overlapping point', () => {
    const doc: HitTestDocLike = { layers: [a, b] }; // b is on top (bottom -> top)
    expect(hitTestDoc(doc, 7, 7)).toBe(b);
  });

  it('falls through to a lower layer outside the topmost one', () => {
    const doc: HitTestDocLike = { layers: [a, b] };
    expect(hitTestDoc(doc, 1, 1)).toBe(a);
  });

  it('skips hidden layers', () => {
    const doc: HitTestDocLike = { layers: [a, { ...b, hidden: true }] };
    expect(hitTestDoc(doc, 7, 7)).toBe(a);
  });

  it('returns null when nothing is hit', () => {
    const doc: HitTestDocLike = { layers: [a, b] };
    expect(hitTestDoc(doc, 100, 100)).toBeNull();
  });
});

// Two-tier scan (#97): a covering pattern square must never swallow clicks on
// the objects it covers, even though new patterns are appended on TOP.
describe('hitTestDoc — two-tier pattern fallback (#97)', () => {
  const a: ShapeLayerLike & { id: string } = { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10 };
  const cover: PatternLayerLike & { id: string } = { id: 'p1', type: 'pattern', x: -5, y: -5, size: 100 };
  const coverTop: PatternLayerLike & { id: string } = { id: 'p2', type: 'pattern', x: -5, y: -5, size: 100 };

  it('a pattern ON TOP of the stack does not swallow hits on layers beneath it', () => {
    const doc: HitTestDocLike = { layers: [a, cover] }; // pattern appended on top
    expect(hitTestDoc(doc, 5, 5)).toBe(a);
  });

  it('falls back to the pattern tier when no non-pattern layer hits', () => {
    const doc: HitTestDocLike = { layers: [a, cover] };
    expect(hitTestDoc(doc, 50, 50)).toBe(cover); // outside a, inside the square
  });

  it('the pattern tier is itself topmost-first', () => {
    const doc: HitTestDocLike = { layers: [cover, coverTop, a] };
    expect(hitTestDoc(doc, 50, 50)).toBe(coverTop);
  });

  it('skips hidden patterns in the fallback tier', () => {
    const doc: HitTestDocLike = { layers: [{ ...cover, hidden: true }, a] };
    expect(hitTestDoc(doc, 50, 50)).toBeNull();
  });

  it('misses a point outside every square', () => {
    const doc: HitTestDocLike = { layers: [cover] };
    expect(hitTestDoc(doc, 200, 200)).toBeNull();
  });
});
