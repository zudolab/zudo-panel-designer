import {
  createPcbLayerContainer,
  PANEL_HEIGHT_MM,
  panelWidthMm,
  type DocState,
  type ImageLayer,
  type LayerNode,
  type PathLayer,
  type PatternLayer,
  type PcbLayerStack,
  type ShapeLayer,
} from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BooleanEngine } from '../geometry-kernel';
import { createBooleanEngine } from '../geometry-kernel';
import { buildGerberIr, type BuildGerberIrResult } from './build-ir';
import { polygonSignedArea } from './flatten';
import type { GerberIr, IrRegion, IrRing } from './ir';

const HP = 16;
const WIDTH = panelWidthMm(HP); // 80.9

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

function doc(
  children: Partial<Record<'copper' | 'solder-mask' | 'silkscreen', LayerNode[]>> = {},
  options: { readonly maskHidden?: boolean; readonly panelHp?: number } = {},
): DocState {
  const layers: PcbLayerStack = [
    createPcbLayerContainer('copper', children.copper ?? []),
    createPcbLayerContainer('solder-mask', children['solder-mask'] ?? [], options.maskHidden),
    createPcbLayerContainer('silkscreen', children.silkscreen ?? []),
  ];
  return { panelHp: options.panelHp ?? HP, layers, guides: [] };
}

function rect(over: Partial<ShapeLayer> & { id: string }): ShapeLayer {
  return {
    name: over.id,
    type: 'shape',
    shape: 'rect',
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    color: 1,
    ...over,
  };
}

async function build(state: DocState): Promise<BuildGerberIrResult> {
  return buildGerberIr(state, { engine });
}

function ok(result: BuildGerberIrResult): GerberIr {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.refusals.map((r) => r.code)}`);
  return result.ir;
}

function area(region: IrRegion): number {
  return region.holes.reduce((a, h) => a + polygonSignedArea(h), polygonSignedArea(region.outer));
}

function bounds(ring: IrRing): [number, number, number, number] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

describe('GerberIr contract (Decision 0)', () => {
  it('emits exactly four layers, in order, with the pinned polarity and render mode', async () => {
    const ir = ok(await build(doc()));
    expect(ir.layers).toHaveLength(4);
    expect(ir.layers.map((l) => l.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
      'outline',
    ]);
    expect(ir.layers.map((l) => l.filePolarity)).toEqual([
      'positive',
      'negative',
      'positive',
      null,
    ]);
    expect(ir.layers.map((l) => l.renderAs)).toEqual([
      'filled-region',
      'filled-region',
      'filled-region',
      'stroked-contour',
    ]);
  });

  it('carries the panel from the spec table, not the hp × 5.08 fallback', async () => {
    const ir = ok(await build(doc()));
    expect(ir.panel).toEqual({ hp: HP, widthMm: 80.9, heightMm: PANEL_HEIGHT_MM });
    expect(ir.panel.heightMm).toBe(128.5);
  });

  it('keeps geometry in DOCUMENT space, +y down, un-flipped', async () => {
    // A shape near the panel TOP must stay near y = 0. Pre-flipping here would
    // break #210's "flip applied exactly once" fixture.
    const ir = ok(
      await build(doc({ copper: [rect({ id: 'a', x: 5, y: 2, width: 10, height: 4 })] })),
    );
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([5, 2, 15, 6]);
  });

  it('carries the panel rectangle on the outline layer, positively wound', async () => {
    const ir = ok(await build(doc()));
    const outline = ir.layers[3];
    expect(outline.regions).toHaveLength(1);
    expect(bounds(outline.regions[0].outer)).toEqual([0, 0, WIDTH, PANEL_HEIGHT_MM]);
    expect(polygonSignedArea(outline.regions[0].outer)).toBeGreaterThan(0);
    expect(outline.regions[0].holes).toEqual([]);
  });
});

describe('layer partition and hidden state', () => {
  it('routes each leaf to its container role', async () => {
    const ir = ok(
      await build(
        doc({
          copper: [rect({ id: 'c', x: 1, y: 1, width: 5, height: 5 })],
          'solder-mask': [rect({ id: 'm', x: 20, y: 20, width: 5, height: 5, color: 0 })],
          silkscreen: [rect({ id: 's', x: 40, y: 40, width: 5, height: 5, color: 2 })],
        }),
      ),
    );
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([1, 1, 6, 6]);
    expect(bounds(ir.layers[1].regions[0].outer)).toEqual([20, 20, 25, 25]);
    expect(bounds(ir.layers[2].regions[0].outer)).toEqual([40, 40, 45, 45]);
  });

  it('skips hidden leaves and folds a hidden group down onto its children', async () => {
    const group: LayerNode = {
      kind: 'group',
      id: 'g',
      name: 'g',
      hidden: true,
      children: [rect({ id: 'inside', x: 50, y: 50, width: 5, height: 5 })],
    };
    const ir = ok(await build(doc({ copper: [rect({ id: 'hidden', hidden: true }), group] })));
    expect(ir.layers[0].regions).toEqual([]);
  });

  it('unions overlapping same-material regions, preserving source-over semantics', async () => {
    const ir = ok(
      await build(
        doc({
          copper: [
            rect({ id: 'a', x: 10, y: 10, width: 20, height: 20 }),
            rect({ id: 'b', x: 20, y: 10, width: 20, height: 20 }),
          ],
        }),
      ),
    );
    expect(ir.layers[0].regions).toHaveLength(1);
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([10, 10, 40, 30]);
    expect(area(ir.layers[0].regions[0])).toBeCloseTo(30 * 20, 6);
  });
});

describe('profile clipping (Decision 7)', () => {
  it('CUTS a shape straddling the panel edge — not dropped, not kept whole', async () => {
    const ir = ok(
      await build(
        doc({ copper: [rect({ id: 'straddle', x: WIDTH - 5, y: 20, width: 20, height: 10 })] }),
      ),
    );
    expect(ir.layers[0].regions).toHaveLength(1);
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([WIDTH - 5, 20, WIDTH, 30]);
    expect(area(ir.layers[0].regions[0])).toBeCloseTo(5 * 10, 6);
  });

  it('drops a shape parked entirely off-panel, honouring the editor 0.35-alpha promise', async () => {
    const ir = ok(
      await build(
        doc({ copper: [rect({ id: 'off', x: WIDTH + 10, y: 20, width: 10, height: 10 })] }),
      ),
    );
    expect(ir.layers[0].regions).toEqual([]);
  });

  it('keeps every emitted coordinate non-negative and inside the panel', async () => {
    const ir = ok(
      await build(doc({ copper: [rect({ id: 'over', x: -20, y: -20, width: 200, height: 300 })] })),
    );
    for (const layer of ir.layers) {
      for (const region of layer.regions) {
        for (const ring of [region.outer, ...region.holes]) {
          for (const p of ring) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(WIDTH + 1e-9);
            expect(p.y).toBeLessThanOrEqual(PANEL_HEIGHT_MM + 1e-9);
          }
        }
      }
    }
  });

  it('does not clip the outline layer — it IS the clip boundary', async () => {
    const ir = ok(await build(doc()));
    expect(area(ir.layers[3].regions[0])).toBeCloseTo(WIDTH * PANEL_HEIGHT_MM, 6);
  });
});

describe('solder mask (Decision 3.2 / Decision 4)', () => {
  const maskLeaf = rect({ id: 'opening', x: 20, y: 20, width: 10, height: 10, color: 0 });

  it('row 1 — hidden container emits ONE full-panel opening, never an empty file', async () => {
    // An empty .GTS conventionally means FULL mask coverage: the exact inverse
    // of what a hidden container means (bare copper, no mask anywhere).
    const ir = ok(await build(doc({ 'solder-mask': [maskLeaf] }, { maskHidden: true })));
    const mask = ir.layers[1];
    expect(mask.regions).toHaveLength(1);
    expect(bounds(mask.regions[0].outer)).toEqual([0, 0, WIDTH, PANEL_HEIGHT_MM]);
    expect(area(mask.regions[0])).toBeCloseTo(WIDTH * PANEL_HEIGHT_MM, 6);
  });

  it('row 2 — visible container with no leaves is empty, meaning full coverage', async () => {
    const ir = ok(await build(doc({ 'solder-mask': [] })));
    expect(ir.layers[1].regions).toEqual([]);
    expect(ir.layers[1].filePolarity).toBe('negative');
  });

  it('row 3 — leaves pass through UNCOMPLEMENTED as the openings they already are', async () => {
    const ir = ok(await build(doc({ 'solder-mask': [maskLeaf] })));
    const mask = ir.layers[1];
    expect(mask.regions).toHaveLength(1);
    expect(bounds(mask.regions[0].outer)).toEqual([20, 20, 30, 30]);
    // 100 mm², NOT the panel minus 100 mm². README.md's "positive coverage"
    // prose is stale and inverted (#216); complementing here scraps boards.
    expect(area(mask.regions[0])).toBeCloseTo(100, 6);
    expect(area(mask.regions[0])).not.toBeCloseTo(WIDTH * PANEL_HEIGHT_MM - 100, 0);
  });

  it('declares Negative polarity without ever touching the geometry', async () => {
    const withLeaf = ok(await build(doc({ 'solder-mask': [maskLeaf] })));
    const empty = ok(await build(doc()));
    expect(withLeaf.layers[1].filePolarity).toBe('negative');
    expect(empty.layers[1].filePolarity).toBe('negative');
  });
});

describe('refusals (Decision 8)', () => {
  const image: ImageLayer = {
    id: 'img',
    name: 'Trace source',
    type: 'image',
    src: 'data:,',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };
  const pattern: PatternLayer = {
    id: 'pat',
    name: 'Grid',
    type: 'pattern',
    patternType: 'grid',
    params: {},
    color: 1,
    x: 0,
    y: 0,
    size: 20,
  };

  it('refuses a visible image layer, naming it', async () => {
    const result = await build(doc({ copper: [image] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0].code).toBe('image-layer-present');
    expect(result.refusals[0].layers).toEqual([{ id: 'img', name: 'Trace source' }]);
  });

  it('lets a HIDDEN image layer through — hidden never triggers a refusal', async () => {
    const ir = ok(await build(doc({ copper: [{ ...image, hidden: true }] })));
    expect(ir.layers[0].regions).toEqual([]);
  });

  it('refuses an unlisted panel HP, where panelWidthMm is only an approximation', async () => {
    const result = await build(doc({}, { panelHp: 13.5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.code)).toContain('unlisted-panel-hp');
    expect(result.refusals[0].layers).toEqual([]);
  });

  it('refuses a pattern layer with no source registered rather than dropping it', async () => {
    const result = await build(doc({ copper: [pattern] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0].code).toBe('unsupported-layer-type');
    expect(result.refusals[0].layers).toEqual([{ id: 'pat', name: 'Grid' }]);
  });

  it('reports every refusal together — one dialog, not four in sequence', async () => {
    const result = await buildGerberIr(
      doc(
        { copper: [image, { ...image, id: 'img2', name: 'Second' }], silkscreen: [pattern] },
        { panelHp: 7 },
      ),
      { engine },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byCode = new Map(result.refusals.map((r) => [r.code, r]));
    expect([...byCode.keys()].sort()).toEqual([
      'image-layer-present',
      'unlisted-panel-hp',
      'unsupported-layer-type',
    ]);
    expect(byCode.get('image-layer-present')!.layers.map((l) => l.id)).toEqual(['img', 'img2']);
  });

  it('lets a registered source take over a hand-off instead of refusing', async () => {
    const result = await buildGerberIr(doc({ copper: [pattern] }), {
      engine,
      sources: [
        {
          handles: 'pattern',
          async extract(layer) {
            return { kind: 'regions', layerId: layer.id, regions: [] };
          },
          async extractCubics(layer) {
            return {
              kind: 'cubics',
              layerId: layer.id,
              groups: [
                {
                  contours: [
                    [
                      {
                        p0: { x: 1, y: 1 },
                        c1: { x: 1, y: 1 },
                        c2: { x: 5, y: 1 },
                        p3: { x: 5, y: 1 },
                      },
                      {
                        p0: { x: 5, y: 1 },
                        c1: { x: 5, y: 1 },
                        c2: { x: 5, y: 5 },
                        p3: { x: 5, y: 5 },
                      },
                      {
                        p0: { x: 5, y: 5 },
                        c1: { x: 5, y: 5 },
                        c2: { x: 1, y: 1 },
                        p3: { x: 1, y: 1 },
                      },
                    ],
                  ],
                  fillRule: 'nonzero',
                },
              ],
            };
          },
        },
      ],
    });
    expect(ok(result).layers[0].regions).toHaveLength(1);
  });

  it('refuses a complexity overrun rather than hanging the tab', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      rect({ id: `r${i}`, x: i * 2, y: 0, width: 1, height: 1 }),
    );
    const result = await buildGerberIr(doc({ copper: many }), {
      engine,
      limits: { maxRingsPerLayer: 3, maxTotalVertices: 2_000_000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0].code).toBe('complexity-overrun');
  });
});

describe('end-to-end nesting and flattening', () => {
  it('promotes an island inside a hole to its own later region', async () => {
    // A frame with a hole, and a smaller frame parked inside that hole.
    const frame = (id: string, x: number, y: number, size: number, wall: number): PathLayer => ({
      id,
      name: id,
      type: 'path',
      points: [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
      ],
      extraSubpaths: [
        [
          { x: x + wall, y: y + wall },
          { x: x + size - wall, y: y + wall },
          { x: x + size - wall, y: y + size - wall },
          { x: x + wall, y: y + size - wall },
        ],
      ],
      closed: true,
      fill: 1,
      stroke: null,
      strokeWidth: 0,
    });

    const ir = ok(
      await build(doc({ copper: [frame('outer', 10, 10, 60, 10), frame('inner', 30, 30, 20, 4)] })),
    );
    const regions = ir.layers[0].regions;
    expect(regions).toHaveLength(2);
    expect(bounds(regions[0].outer)).toEqual([10, 10, 70, 70]);
    expect(regions[0].holes).toHaveLength(1);
    expect(bounds(regions[0].holes[0])).toEqual([20, 20, 60, 60]);
    // The island is its own region and comes LATER, so Gerber's ordered image
    // stream does not erase it.
    expect(bounds(regions[1].outer)).toEqual([30, 30, 50, 50]);
    expect(bounds(regions[1].holes[0])).toEqual([34, 34, 46, 46]);
  });

  it('flattens an r = 64 mm ellipse to within the 5 µm total budget', async () => {
    const ellipse: ShapeLayer = {
      id: 'e',
      name: 'e',
      type: 'shape',
      shape: 'ellipse',
      x: WIDTH / 2 - 64,
      y: PANEL_HEIGHT_MM / 2 - 64,
      width: 128,
      height: 128,
      color: 1,
    };
    const ir = ok(await build(doc({ copper: [ellipse] })));
    const ring = ir.layers[0].regions[0].outer;
    const cx = WIDTH / 2;
    const cy = PANEL_HEIGHT_MM / 2;
    let worst = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const p of [a, mid]) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        // The ellipse is clipped by the panel edges, so only sample the arc.
        if (d < 60) continue;
        worst = Math.max(worst, Math.abs(d - 64));
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(0.005);
  });

  it('emits every ring implicitly closed with at least 3 vertices', async () => {
    const ir = ok(
      await build(
        doc({
          copper: [rect({ id: 'a' })],
          silkscreen: [rect({ id: 'b', x: 5, y: 5, width: 8, height: 8, color: 2 })],
        }),
      ),
    );
    for (const layer of ir.layers) {
      for (const region of layer.regions) {
        for (const ring of [region.outer, ...region.holes]) {
          expect(ring.length).toBeGreaterThanOrEqual(3);
          expect(ring[0]).not.toEqual(ring[ring.length - 1]);
        }
        expect(polygonSignedArea(region.outer)).toBeGreaterThan(0);
        for (const hole of region.holes) expect(polygonSignedArea(hole)).toBeLessThan(0);
      }
    }
  });

  it('is deterministic — the same document builds the same IR twice', async () => {
    const state = doc({
      copper: [rect({ id: 'a' }), rect({ id: 'b', x: 40, y: 60, width: 15, height: 15 })],
      silkscreen: [rect({ id: 'c', x: 5, y: 90, width: 8, height: 8, color: 2 })],
    });
    const first = ok(await build(state));
    const second = ok(await build(state));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
