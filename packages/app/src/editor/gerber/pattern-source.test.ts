/**
 * The pattern `LayerGeometrySource`: refusals, the square clip, the fill-rule
 * resolution, and the per-pattern override hatch.
 */

import { MAX_PATTERN_SIZE_MM, type PatternLayer } from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBooleanEngine,
  ringSignedArea,
  type BooleanEngine,
  type KernelRing,
} from '../geometry-kernel';
import { extractContext, patternLayer } from './pattern-parity';
import {
  createPatternGeometrySource,
  fillOperands,
  patternGeometrySource,
  patternLayerToRings,
  PATTERN_GEOMETRY_OVERRIDES,
} from './pattern-source';
import { polygonToRing, rectToRing } from './primitives';
import { compareMasks, fillPolygons, fillRegions, Mask, ReferenceCanvas } from './raster-oracle';
import { ringsToRegions } from './regions';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
}, 30_000);

const netArea = (rings: readonly KernelRing[]): number =>
  Math.abs(rings.reduce((a, r) => a + ringSignedArea(r), 0));

describe('unknown pattern id (Decision 8)', () => {
  const layer: PatternLayer = {
    id: 'pat',
    name: 'Mystery',
    type: 'pattern',
    patternType: 'not-a-registered-generator',
    params: {},
    color: 1,
    x: 0,
    y: 0,
    size: 20,
  };

  it('refuses, naming the id, instead of silently drawing nothing', async () => {
    const result = await patternGeometrySource.extract(layer, extractContext(engine));
    expect(result).toEqual({
      kind: 'unsupported',
      layerId: 'pat',
      layerName: 'Mystery',
      reason: 'unknown-pattern-id',
      detail: 'not-a-registered-generator',
    });
  });

  it('refuses from extractCubics too — the path the orchestrator actually takes', async () => {
    const result = await patternGeometrySource.extractCubics!(layer, extractContext(engine));
    expect(result.kind).toBe('unsupported');
  });
});

describe('the renderer draw guard is reproduced, not second-guessed', () => {
  // `renderer.ts:396-402` never calls draw() for these, so the editor shows
  // nothing; an export that showed something would be the surprising outcome.
  for (const size of [0, -5, Number.NaN, MAX_PATTERN_SIZE_MM + 1]) {
    it(`emits no geometry for size ${size}`, () => {
      const result = patternLayerToRings(
        patternLayer('dot-grid', size, { pitch: 5, radius: 1 }),
        extractContext(engine),
      );
      expect(result).toEqual({ kind: 'rings', rings: [] });
    });
  }

  it('does emit geometry at exactly MAX_PATTERN_SIZE_MM… boundary is inclusive', () => {
    const layer = patternLayer('dot-grid', MAX_PATTERN_SIZE_MM, { pitch: 400, radius: 100 });
    const result = patternLayerToRings(layer, extractContext(engine));
    expect(result.kind).toBe('rings');
    if (result.kind !== 'rings') return;
    expect(result.rings.length).toBeGreaterThan(0);
  });
});

describe('the complexity ceiling becomes a refusal (Decision 8)', () => {
  it('refuses the layer by name rather than grinding through it', async () => {
    const source = createPatternGeometrySource({
      limits: { maxRingsPerLayer: 5, maxTotalVertices: 2_000_000 },
    });
    const result = await source.extract(
      patternLayer('dot-grid', 60, { pitch: 2, radius: 0.5 }),
      extractContext(engine),
    );
    expect(result.kind).toBe('unsupported');
    if (result.kind !== 'unsupported') return;
    expect(result.reason).toBe('complexity-overrun');
    expect(result.layerName).toBe('dot-grid');
  });

  it('does not refuse the same layer under the real ceiling', async () => {
    const result = await patternGeometrySource.extract(
      patternLayer('dot-grid', 60, { pitch: 2, radius: 0.5 }),
      extractContext(engine),
    );
    expect(result.kind).toBe('regions');
  });
});

describe('the square clip (Decision 5.1)', () => {
  // `grid-lines` strokes right across its square and well past it, which is
  // what makes it a clip fixture rather than a geometry one.
  const SIZE = 12;

  it('keeps every emitted point inside the square', () => {
    const result = patternLayerToRings(
      patternLayer('grid-lines', SIZE, { pitch: 4, lineWidth: 0.6 }),
      extractContext(engine),
    );
    expect(result.kind).toBe('rings');
    if (result.kind !== 'rings') return;
    expect(result.rings.length).toBeGreaterThan(0);
    for (const ring of result.rings) {
      for (const c of ring) {
        for (const p of [c.p0, c.c1, c.c2, c.p3]) {
          expect(p.x).toBeGreaterThanOrEqual(-1e-9);
          expect(p.y).toBeGreaterThanOrEqual(-1e-9);
          expect(p.x).toBeLessThanOrEqual(SIZE + 1e-9);
          expect(p.y).toBeLessThanOrEqual(SIZE + 1e-9);
        }
      }
    }
  });

  it('CUTS a straddling stroke rather than dropping it or keeping it whole', () => {
    // A single horizontal rule at y = 6 crossing the whole square: the clip has
    // to trim it to the square's width, not discard the line and not keep the
    // overscan.
    const result = patternLayerToRings(
      patternLayer('grid-lines', SIZE, { pitch: 100, lineWidth: 1 }),
      extractContext(engine),
    );
    if (result.kind !== 'rings') throw new Error('expected rings');
    const area = netArea(result.rings);
    // Two full-width rules of width 1 at most; certainly more than one square
    // millimetre and certainly less than the whole square.
    expect(area).toBeGreaterThan(1);
    expect(area).toBeLessThan(SIZE * SIZE);
  });

  it('translates into document space by the layer origin, with no Y flip', () => {
    const at = (x: number, y: number): number[] => {
      const layer: PatternLayer = {
        ...patternLayer('dot-grid', 20, { pitch: 20, radius: 3 }),
        x,
        y,
      };
      const result = patternLayerToRings(layer, extractContext(engine));
      if (result.kind !== 'rings') throw new Error('expected rings');
      let minX = Infinity;
      let minY = Infinity;
      for (const ring of result.rings) {
        for (const c of ring) {
          minX = Math.min(minX, c.p0.x);
          minY = Math.min(minY, c.p0.y);
        }
      }
      return [minX, minY];
    };
    const [x0, y0] = at(0, 0);
    const [x1, y1] = at(30, 40);
    expect(x1 - x0).toBeCloseTo(30, 6);
    // +30/+40, NOT 128.5 − y: the flip belongs to `coordinate-frame.ts` alone.
    expect(y1 - y0).toBeCloseTo(40, 6);
  });
});

describe('fill-rule resolution', () => {
  it('keeps same-wound contours as SEPARATE operands so they union, not intersect', () => {
    // Two rectangles offset by half their width share a collinear edge pair.
    // In one compound operand path-bool returns their 50 mm² intersection; as
    // separate operands the answer is the 150 mm² union.
    const a = rectToRing(0, 0, 10, 10);
    const b = rectToRing(5, 0, 10, 10);
    const operands = fillOperands([a, b], 'nonzero', engine);
    expect(operands).toHaveLength(2);
    expect(netArea(engine.arrange(operands).unite())).toBeCloseTo(150, 3);
  });

  it('resolves evenodd by parity, which a compound operand gets wrong', () => {
    const a = rectToRing(0, 0, 10, 10);
    const b = rectToRing(5, 0, 10, 10);
    const inner = rectToRing(2, 2, 3, 3);
    const operands = fillOperands([a, b, inner], 'evenodd', engine);
    // (A xor B) minus the small square that sits in A alone: 50 + 50 − 9.
    expect(netArea(operands.flatMap((o) => o.contours))).toBeCloseTo(91, 3);
  });

  it('falls back to the compound operand when the windings disagree', () => {
    const outer = rectToRing(0, 0, 20, 20);
    const reversedInner = [...rectToRing(5, 5, 10, 10)]
      .reverse()
      .map((c) => ({ p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 }));
    const operands = fillOperands([outer, reversedInner], 'nonzero', engine);
    expect(operands).toHaveLength(1);
    expect(netArea(engine.arrange(operands).unite())).toBeCloseTo(300, 3);
  });
});

describe('the per-pattern override hatch', () => {
  it('ships empty — every entry would need its own named parity test', () => {
    expect(PATTERN_GEOMETRY_OVERRIDES).toEqual([]);
  });

  it('takes over a registered generator, and is still clipped to the square', () => {
    // The override draws a 30 mm square into a 10 mm pattern square, so the
    // assertion is that the hatch cannot be used to bypass Decision 5.1.
    const source = createPatternGeometrySource({
      overrides: [
        {
          patternType: 'dot-grid',
          toGroups: () => [{ contours: [rectToRing(-10, -10, 30, 30)], fillRule: 'nonzero' }],
        },
      ],
    });
    const rings = patternLayerToRings(patternLayer('dot-grid', 10, {}), extractContext(engine), {
      overrides: [
        {
          patternType: 'dot-grid',
          toGroups: () => [{ contours: [rectToRing(-10, -10, 30, 30)], fillRule: 'nonzero' }],
        },
      ],
    });
    expect(rings.kind).toBe('rings');
    if (rings.kind !== 'rings') return;
    expect(netArea(rings.rings)).toBeCloseTo(100, 3);
    expect(source.handles).toBe('pattern');
  });

  it('can supply geometry for a pattern id with no generator at all', async () => {
    const source = createPatternGeometrySource({
      overrides: [
        {
          patternType: 'house-brand-logo',
          toGroups: () => [
            {
              contours: [
                polygonToRing([
                  { x: 1, y: 1 },
                  { x: 9, y: 1 },
                  { x: 9, y: 9 },
                ]),
              ],
              fillRule: 'nonzero',
            },
          ],
        },
      ],
    });
    const layer: PatternLayer = {
      ...patternLayer('house-brand-logo', 10, {}),
      patternType: 'house-brand-logo',
    };
    const result = await source.extract(layer, extractContext(engine));
    expect(result.kind).toBe('regions');
    if (result.kind !== 'regions') return;
    expect(result.regions).toHaveLength(1);
  });

  it('renders to the same raster the override describes — its named parity test', () => {
    const SIZE = 10;
    const triangle = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
    ];
    const overrides = [
      {
        patternType: 'dot-grid',
        toGroups: () => [{ contours: [polygonToRing(triangle)], fillRule: 'nonzero' as const }],
      },
    ];
    const rings = patternLayerToRings(patternLayer('dot-grid', SIZE, {}), extractContext(engine), {
      overrides,
    });
    if (rings.kind !== 'rings') throw new Error('expected rings');

    const expected = new Mask(0, 0, SIZE, 200);
    fillPolygons(expected, [triangle], 'nonzero');
    const actual = new Mask(0, 0, SIZE, 200);
    fillRegions(actual, ringsToRegions(rings.rings, DEFAULT_IR_TOLERANCE));
    expect(compareMasks(expected, actual).deep).toBe(0);
  });
});

describe('a hidden pattern layer is never even asked about', () => {
  it('is the orchestrator’s guard, not this source’s — documented here so it is not added twice', () => {
    // `buildGerberIr` skips `layer.hidden` before extraction (Decision 0.4), so
    // this source has no hidden check of its own and must not grow one.
    const src = createPatternGeometrySource();
    expect(src.handles).toBe('pattern');
  });
});

describe('a generator that paints nothing is not an error', () => {
  it('returns an empty region list', async () => {
    const source = createPatternGeometrySource({
      overrides: [{ patternType: 'dot-grid', toGroups: () => [] }],
    });
    const result = await source.extract(patternLayer('dot-grid', 10, {}), extractContext(engine));
    expect(result).toEqual({ kind: 'regions', layerId: 'parity-dot-grid', regions: [] });
  });
});

describe('the reference oracle is a genuinely independent implementation', () => {
  it('agrees with a hand-computed stroke area for a plain butt-capped bar', () => {
    // 10 mm long, 2 mm wide, butt caps → exactly 20 mm². If the oracle and the
    // production stroker ever drifted into agreeing on a wrong answer, this is
    // the assertion that does not move.
    const mask = new Mask(-2, -2, 16, 640);
    const canvas = new ReferenceCanvas(mask);
    canvas.lineWidth = 2;
    canvas.lineCap = 'butt';
    canvas.moveTo(0, 0);
    canvas.lineTo(10, 0);
    canvas.stroke();
    const areaMm2 = mask.filled * mask.step * mask.step;
    expect(areaMm2).toBeCloseTo(20, 1);
  });

  it('adds a round cap’s half-discs — 20 + π, the value path-bool gets wrong', () => {
    const mask = new Mask(-2, -2, 16, 640);
    const canvas = new ReferenceCanvas(mask);
    canvas.lineWidth = 2;
    canvas.lineCap = 'round';
    canvas.moveTo(0, 0);
    canvas.lineTo(10, 0);
    canvas.stroke();
    const areaMm2 = mask.filled * mask.step * mask.step;
    expect(areaMm2).toBeCloseTo(20 + Math.PI, 1);
  });
});
