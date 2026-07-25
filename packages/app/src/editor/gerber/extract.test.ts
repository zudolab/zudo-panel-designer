import { normalizeRect, rectCenter, rotatePoint, type PathLayer, type ShapeLayer } from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BooleanEngine, KernelInput, KernelPoint } from '../geometry-kernel';
import { createBooleanEngine, flattenRing, ringSignedArea } from '../geometry-kernel';
import {
  imageGeometrySource,
  pathGeometrySource,
  pathLayerToGroups,
  patternHandoffSource,
  shapeGeometrySource,
  shapeLayerToGroups,
  textHandoffSource,
} from './extract';
import type { IrExtractContext } from './ir';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const TOL = DEFAULT_IR_TOLERANCE;

let engine: BooleanEngine;
let ctx: IrExtractContext;
beforeAll(async () => {
  engine = await createBooleanEngine();
  ctx = {
    panel: { hp: 16, widthMm: 80.9, heightMm: 128.5 },
    role: 'copper',
    engine,
    tolerance: TOL,
  };
});

function groupBounds(groups: readonly KernelInput[]): [number, number, number, number] {
  const pts: KernelPoint[] = [];
  for (const g of groups) for (const c of g.contours) pts.push(...flattenRing(c, 64));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function shape(over: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: 's1',
    name: 'shape',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: 1,
    ...over,
  };
}

function path(over: Partial<PathLayer> = {}): PathLayer {
  return {
    id: 'p1',
    name: 'path',
    type: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    closed: true,
    fill: 1,
    stroke: null,
    strokeWidth: 0,
    ...over,
  };
}

describe('shape extraction — normalisation parity (Decision 9)', () => {
  it('draws a negative-dimension rect exactly where the renderer draws it', () => {
    // ctx.rect(10, 12, -4, -6) paints the mirrored rect; normalizeRect is that
    // same rect.
    const layer = shape({ x: 10, y: 12, width: -4, height: -6 });
    expect(groupBounds(shapeLayerToGroups(layer, TOL))).toEqual([6, 6, 10, 12]);
    expect(normalizeRect({ x: 10, y: 12, width: -4, height: -6 })).toEqual({
      x: 6,
      y: 6,
      width: 4,
      height: 6,
    });
  });

  it('normalises a negative-dimension ellipse the way the renderer does by hand', () => {
    // renderer.ts:376-384 centres on x + w/2 and takes |w|/2 as the radius,
    // because ctx.ellipse throws IndexSizeError on a negative one.
    const layer = shape({ shape: 'ellipse', x: 10, y: 12, width: -4, height: -6 });
    const [minX, minY, maxX, maxY] = groupBounds(shapeLayerToGroups(layer, TOL));
    expect(minX).toBeCloseTo(6, 6);
    expect(minY).toBeCloseTo(6, 6);
    expect(maxX).toBeCloseTo(10, 6);
    expect(maxY).toBeCloseTo(12, 6);
  });

  it('rotates about the RAW bbox centre, which normalizeRect leaves invariant', () => {
    const raw = { x: 10, y: 12, width: -4, height: -6 };
    expect(rectCenter(raw)).toEqual(rectCenter(normalizeRect(raw)));

    const layer = shape({ ...raw, rotation: 90 });
    const groups = shapeLayerToGroups(layer, TOL);
    const centre = rectCenter(raw);
    // Rotating the normalised rect's corners by hand must land on the same box.
    const corners = [
      { x: 6, y: 6 },
      { x: 10, y: 6 },
      { x: 10, y: 12 },
      { x: 6, y: 12 },
    ].map((c) => rotatePoint(c, centre, 90));
    const [minX, minY, maxX, maxY] = groupBounds(groups);
    expect(minX).toBeCloseTo(Math.min(...corners.map((c) => c.x)), 9);
    expect(minY).toBeCloseTo(Math.min(...corners.map((c) => c.y)), 9);
    expect(maxX).toBeCloseTo(Math.max(...corners.map((c) => c.x)), 9);
    expect(maxY).toBeCloseTo(Math.max(...corners.map((c) => c.y)), 9);
  });

  it('emits an ellipse as cubic arcs, never as a pre-flattened polygon', () => {
    const groups = shapeLayerToGroups(shape({ shape: 'ellipse', width: 20, height: 20 }), TOL);
    const ring = groups[0].contours[0];
    expect(ring.length).toBe(8);
    expect(ring.some((c) => c.c1.x !== c.p0.x || c.c1.y !== c.p0.y)).toBe(true);
    // Exact area of the 8-cubic approximation, within the arc budget.
    expect(Math.abs(ringSignedArea(ring) / (Math.PI * 100) - 1)).toBeLessThan(1e-5);
  });

  it('contributes nothing for a zero or non-finite dimension', () => {
    expect(shapeLayerToGroups(shape({ width: 0 }), TOL)).toEqual([]);
    expect(shapeLayerToGroups(shape({ height: Number.NaN }), TOL)).toEqual([]);
  });
});

describe('path extraction', () => {
  it('fills with evenodd across the primary subpath and its extras', () => {
    const layer = path({
      extraSubpaths: [
        [
          { x: 2, y: 2 },
          { x: 6, y: 2 },
          { x: 6, y: 6 },
        ],
      ],
    });
    const groups = pathLayerToGroups(layer, TOL, engine);
    expect(groups).toHaveLength(1);
    expect(groups[0].fillRule).toBe('evenodd');
    expect(groups[0].contours).toHaveLength(2);
  });

  it('does not fill an open path, matching renderer.ts:428', () => {
    expect(pathLayerToGroups(path({ closed: false }), TOL, engine)).toEqual([]);
  });

  it('adds a nonzero stroke group and keeps it separate from the fill', () => {
    const groups = pathLayerToGroups(path({ stroke: 1, strokeWidth: 0.5 }), TOL, engine);
    expect(groups).toHaveLength(2);
    expect(groups[0].fillRule).toBe('evenodd');
    expect(groups[1].fillRule).toBe('nonzero');
  });

  it('strokes every subpath, treating extras as closed', () => {
    const layer = path({
      fill: null,
      stroke: 1,
      strokeWidth: 0.5,
      extraSubpaths: [
        [
          { x: 20, y: 20 },
          { x: 26, y: 20 },
          { x: 26, y: 26 },
        ],
      ],
    });
    // One input per subpath — overlapping operands must not share one input.
    expect(pathLayerToGroups(layer, TOL, engine)).toHaveLength(2);
  });

  it('skips a non-positive or non-finite stroke width without refusing', () => {
    for (const strokeWidth of [0, -1, Number.NaN]) {
      expect(pathLayerToGroups(path({ fill: null, stroke: 1, strokeWidth }), TOL, engine)).toEqual(
        [],
      );
    }
  });

  it('turns a missing handle into a straight edge, exactly like appendSubpath', () => {
    const groups = pathLayerToGroups(path(), TOL, engine);
    const ring = groups[0].contours[0];
    expect(ring).toHaveLength(3);
    for (const c of ring) {
      expect(c.c1).toEqual(c.p0);
      expect(c.c2).toEqual(c.p3);
    }
  });
});

describe('unsupported hand-offs (Decision 0.4)', () => {
  it('hands pattern and text layers off rather than dropping them', async () => {
    const pattern = await patternHandoffSource.extract(
      {
        id: 'x',
        name: 'Grid',
        type: 'pattern',
        patternType: 'grid',
        params: {},
        color: 1,
        x: 0,
        y: 0,
        size: 10,
      },
      ctx,
    );
    expect(pattern).toMatchObject({
      kind: 'unsupported',
      reason: 'pattern-layer',
      layerName: 'Grid',
    });

    const text = await textHandoffSource.extract(
      {
        id: 'y',
        name: 'Label',
        type: 'text',
        content: 'A',
        fontFamily: 'Inter',
        sizeMm: 4,
        x: 0,
        y: 0,
        color: 2,
      },
      ctx,
    );
    expect(text).toMatchObject({ kind: 'unsupported', reason: 'text-layer' });
  });

  it('marks an image layer terminal — a raster cannot be manufactured', async () => {
    const result = await imageGeometrySource.extract(
      {
        id: 'z',
        name: 'Trace source',
        type: 'image',
        src: 'data:,',
        x: 0,
        y: 0,
        width: 5,
        height: 5,
      },
      ctx,
    );
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'image-layer' });
  });

  it('offers both the pinned extract() surface and the pre-flatten extractCubics()', async () => {
    for (const source of [shapeGeometrySource, pathGeometrySource]) {
      expect(typeof source.extractCubics).toBe('function');
    }
    const flat = await shapeGeometrySource.extract(shape(), ctx);
    expect(flat.kind).toBe('regions');
    if (flat.kind === 'regions') {
      expect(flat.regions).toHaveLength(1);
      expect(flat.regions[0].outer).toHaveLength(4);
    }
  });
});
