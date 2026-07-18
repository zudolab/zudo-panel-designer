import { describe, expect, it } from 'vitest';
import { cloneLayersWithFreshIds } from './clone';
import type { ImageLayer, Layer, PathLayer, PatternLayer, ShapeLayer, TextLayer } from './types';

const shapeLayer: ShapeLayer = {
  id: 's1',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 10,
  y: 5,
  width: 20,
  height: 10,
  color: 1,
};

const textLayer: TextLayer = {
  id: 't1',
  name: 'Label',
  type: 'text',
  content: 'hi',
  fontFamily: 'Inter',
  sizeMm: 4,
  x: 1,
  y: 2,
  color: 0,
};

const imageLayer: ImageLayer = {
  id: 'i1',
  name: 'Ref',
  type: 'image',
  src: 'data:image/png;base64,AAAA',
  x: 3,
  y: 4,
  width: 8,
  height: 8,
};

const pathLayer: PathLayer = {
  id: 'p1',
  name: 'Path',
  type: 'path',
  points: [
    { x: 0, y: 0, hout: { x: 1, y: 0 } },
    { x: 10, y: 10, hin: { x: 9, y: 10 } },
  ],
  extraSubpaths: [[{ x: 20, y: 20 }]],
  closed: true,
  fill: 1,
  stroke: null,
  strokeWidth: 0.5,
};

const patternLayer: PatternLayer = {
  id: 'g1',
  name: 'Grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: { pitch: 2.54 },
  color: 2,
  x: 4,
  y: 6,
  size: 40,
};

function idMaker(prefix = 'clone') {
  let n = 0;
  return (source: Layer) => {
    n += 1;
    return `${prefix}-${source.id}-${n}`;
  };
}

describe('cloneLayersWithFreshIds', () => {
  it('mints a fresh id per layer via the injected callback, never colliding with the input ids', () => {
    const seen: Layer[] = [];
    const makeId = (source: Layer) => {
      seen.push(source);
      return `fresh-${source.id}`;
    };
    const clones = cloneLayersWithFreshIds([shapeLayer, textLayer], { makeId, offsetMm: 2 });
    expect(seen.map((l) => l.id)).toEqual(['s1', 't1']);
    expect(clones.map((l) => l.id)).toEqual(['fresh-s1', 'fresh-t1']);
    const inputIds = new Set([shapeLayer.id, textLayer.id]);
    for (const clone of clones) expect(inputIds.has(clone.id)).toBe(false);
  });

  it('offsets x/y for shape, text, and image layers', () => {
    const [shapeClone, textClone, imageClone] = cloneLayersWithFreshIds([shapeLayer, textLayer, imageLayer], {
      makeId: idMaker(),
      offsetMm: 2,
    }) as [ShapeLayer, TextLayer, ImageLayer];
    expect(shapeClone).toMatchObject({ x: 12, y: 7 });
    expect(textClone).toMatchObject({ x: 3, y: 4 });
    expect(imageClone).toMatchObject({ x: 5, y: 6 });
  });

  it('translates path layer anchors and bezier handles (both subpaths) instead of x/y', () => {
    const [clone] = cloneLayersWithFreshIds([pathLayer], { makeId: idMaker(), offsetMm: 2 }) as [PathLayer];
    expect(clone.points).toEqual([
      { x: 2, y: 2, hout: { x: 3, y: 2 } },
      { x: 12, y: 12, hin: { x: 11, y: 12 } },
    ]);
    expect(clone.extraSubpaths).toEqual([[{ x: 22, y: 22 }]]);
    // source untouched
    expect(pathLayer.points[0]).toEqual({ x: 0, y: 0, hout: { x: 1, y: 0 } });
  });

  it('leaves a pattern layer position fields untouched (excluded-by-caller contract; only the id is refreshed)', () => {
    const [clone] = cloneLayersWithFreshIds([patternLayer], { makeId: idMaker(), offsetMm: 2 }) as [PatternLayer];
    expect(clone).toEqual({ ...patternLayer, id: clone.id });
    expect(clone.id).not.toBe(patternLayer.id);
  });

  it('deep-copies nested structures so mutating a clone does not bleed into the source', () => {
    const [clone] = cloneLayersWithFreshIds([pathLayer], { makeId: idMaker(), offsetMm: 0 }) as [PathLayer];
    clone.points[0].x = 999;
    expect(pathLayer.points[0].x).toBe(0);
  });

  it('does not mutate the input array or layers', () => {
    const input = [shapeLayer];
    cloneLayersWithFreshIds(input, { makeId: idMaker(), offsetMm: 2 });
    expect(input).toEqual([shapeLayer]);
    expect(shapeLayer.x).toBe(10);
  });

  it('returns an empty array for an empty selection', () => {
    expect(cloneLayersWithFreshIds([], { makeId: idMaker(), offsetMm: 2 })).toEqual([]);
  });
});
