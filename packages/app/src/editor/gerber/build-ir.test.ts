import {
  createDefaultDoc,
  createPcbLayerContainer,
  panelHeightMm,
  panelWidthMm,
  type DocState,
  type ImageLayer,
  type LayerNode,
  type PanelFormat,
  type PathLayer,
  type PatternLayer,
  type PcbLayerStack,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BooleanEngine } from '../geometry-kernel';
import { createBooleanEngine } from '../geometry-kernel';
import { loadTestFontFile } from './test-font-loader';
import { buildGerberIr, type BuildGerberIrResult } from './build-ir';
import { polygonSignedArea } from './flatten';
import type { GerberIr, IrRegion, IrRing } from './ir';
import { setCuratedFontFileLoaderForTests } from './text-fonts';

const HP = 16;
const WIDTH = panelWidthMm(HP); // 80.9
const HEIGHT = panelHeightMm('3U'); // 128.5 — createDefaultDoc()'s format

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
  // Text layers now resolve through the real outliner (#212), which loads a
  // `?url` font asset. Vitest resolves that to `/@fs/<abs path>`, which `fetch`
  // cannot read but the filesystem can — same seam text-fonts.test.ts uses.
  setCuratedFontFileLoaderForTests(loadTestFontFile);
});

function doc(
  children: Partial<Record<'copper' | 'solder-mask' | 'silkscreen', LayerNode[]>> = {},
  options: {
    readonly maskHidden?: boolean;
    readonly panelHp?: number;
    readonly format?: PanelFormat;
  } = {},
): DocState {
  const layers: PcbLayerStack = [
    createPcbLayerContainer('copper', children.copper ?? []),
    createPcbLayerContainer('solder-mask', children['solder-mask'] ?? [], options.maskHidden),
    createPcbLayerContainer('silkscreen', children.silkscreen ?? []),
  ];
  return {
    ...createDefaultDoc(),
    panelHp: options.panelHp ?? HP,
    format: options.format ?? '3U',
    layers,
    guides: [],
  };
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
  it('emits the FR-4 role list in MATERIAL_LAYER_ROLES order with the pinned polarity and render mode', async () => {
    const ir = ok(await build(doc()));
    expect(ir.material).toBe('fr4');
    expect(ir.layers.map((l) => l.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
      'b-copper',
      'b-solder-mask',
      'b-silkscreen',
      'outline',
    ]);
    expect(ir.layers.map((l) => l.filePolarity)).toEqual([
      'positive',
      'negative',
      'positive',
      'positive',
      'negative',
      'positive',
      null,
    ]);
    expect(ir.layers.map((l) => l.renderAs)).toEqual([
      'filled-region',
      'filled-region',
      'filled-region',
      'filled-region',
      'filled-region',
      'filled-region',
      'stroked-contour',
    ]);
  });

  it('emits the alumi role list — a B.Mask back only (Decision 12)', async () => {
    const ir = ok(await build({ ...doc(), material: 'alumi' }));
    expect(ir.material).toBe('alumi');
    expect(ir.layers.map((l) => l.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
      'b-solder-mask',
      'outline',
    ]);
  });

  it('carries the panel from the spec table, not the hp × 5.08 fallback', async () => {
    const ir = ok(await build(doc()));
    expect(ir.panel).toEqual({ format: '3U', hp: HP, widthMm: 80.9, heightMm: HEIGHT });
    expect(ir.panel.heightMm).toBe(128.5);
  });

  it('derives the panel height from the document format, not a fixed 3U constant (#229)', async () => {
    const ir = ok(await build(doc({}, { panelHp: 8, format: '1U' })));
    expect(ir.panel.heightMm).toBe(panelHeightMm('1U'));
    expect(ir.panel.heightMm).toBe(39.65);
  });

  it('fills the drill pair from the template catalog — FR-4 holes PTH, the other side empty (#235, Decision 11)', async () => {
    const ir = ok(await build(doc()));
    expect(ir.drill.npth).toEqual({ plating: 'npth', tools: [], hits: [], slots: [] });
    expect(ir.drill.pth.tools).toEqual([{ code: 1, diameterMm: 3.2 }]);
    expect(ir.drill.pth.hits).toEqual([]);
    // hp16 catalog: four slots, cx 10.16 / 70.74 on rows cy 3 / 125.5, routed
    // span 10.28 − 3.2 = 7.08 between endpoint centres, still in DOC space.
    expect(ir.drill.pth.slots).toHaveLength(4);
    expect(ir.drill.pth.slots[0].start.x).toBeCloseTo(10.16 - 3.54, 9);
    expect(ir.drill.pth.slots[0].end.x).toBeCloseTo(10.16 + 3.54, 9);
    expect(ir.drill.pth.slots[0].start.y).toBe(3);
    expect(ir.drill.pth.slots[3].start.y).toBe(125.5);
  });

  it('classifies alumi holes NPTH, leaving PTH empty (#235, Decision 11)', async () => {
    const ir = ok(await build({ ...doc(), material: 'alumi' }));
    expect(ir.drill.pth).toEqual({ plating: 'pth', tools: [], hits: [], slots: [] });
    expect(ir.drill.npth.slots).toHaveLength(4);
  });

  // #235's branch also carried a 'back layers stay empty on this branch' test.
  // It was true only in isolation — #236 populates those roles — so it was
  // dropped at the merge rather than kept and weakened. Its intent (prove the
  // two seams don't BOTH inject and double every back hole) is covered more
  // strictly by the region counts below: if #235's front-only injections
  // regressed to include back roles, these would read 8, not 4.
  it('projects doc.backLayers through the #236 seam — mirrored artwork plus hole fabrication', async () => {
    const state: DocState = {
      ...doc(),
      backLayers: [
        createPcbLayerContainer('back', 'copper', []),
        createPcbLayerContainer('back', 'solder-mask', []),
        createPcbLayerContainer('back', 'silkscreen', [
          rect({ id: 'bs', x: 5, y: 10, width: 10, height: 5, color: 2 }),
        ]),
      ],
    };
    const ir = ok(await build(state));
    const byRole = new Map(ir.layers.map((l) => [l.role, l]));
    // Back artwork lands X-mirrored into front-view doc space (Decision 13):
    // authored back-view x ∈ [5, 15] reads as [WIDTH − 15, WIDTH − 5].
    const silk = byRole.get('b-silkscreen')!;
    expect(silk.regions).toHaveLength(1);
    expect(bounds(silk.regions[0].outer)).toEqual([WIDTH - 15, 10, WIDTH - 5, 15]);
    // Screw-hole fabrication from the canonical template coordinates
    // (Decisions 11/12): opening stadiums on the back mask, copper stadiums on
    // the FR-4 back copper. 3U-16hp carries four slots.
    expect(byRole.get('b-solder-mask')!.regions).toHaveLength(4);
    expect(byRole.get('b-copper')!.regions).toHaveLength(4);
  });

  it('fills the alumi B.Mask with the screw-hole openings only (Decision 12)', async () => {
    const ir = ok(await build({ ...doc(), material: 'alumi' }));
    const mask = ir.layers.find((l) => l.role === 'b-solder-mask')!;
    expect(mask.regions).toHaveLength(4);
    for (const region of mask.regions) {
      expect(polygonSignedArea(region.outer)).toBeGreaterThan(0);
      expect(region.holes).toEqual([]);
    }
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
    const outline = ir.layers.find((l) => l.role === 'outline')!;
    expect(outline.regions).toHaveLength(1);
    expect(bounds(outline.regions[0].outer)).toEqual([0, 0, WIDTH, HEIGHT]);
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
    // Hidden artwork extracts nothing; only the four injected screw-hole
    // stadiums (#235) remain on FR-4 copper.
    expect(ir.layers[0].regions).toHaveLength(4);
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
    // 1 united artwork region + 4 injected screw-hole stadiums (#235).
    expect(ir.layers[0].regions).toHaveLength(5);
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
    // 1 clipped artwork region + 4 injected screw-hole stadiums (#235).
    expect(ir.layers[0].regions).toHaveLength(5);
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([WIDTH - 5, 20, WIDTH, 30]);
    expect(area(ir.layers[0].regions[0])).toBeCloseTo(5 * 10, 6);
  });

  it('drops a shape parked entirely off-panel, honouring the editor 0.35-alpha promise', async () => {
    const ir = ok(
      await build(
        doc({ copper: [rect({ id: 'off', x: WIDTH + 10, y: 20, width: 10, height: 10 })] }),
      ),
    );
    // The off-panel shape is dropped; only the injected stadiums remain.
    expect(ir.layers[0].regions).toHaveLength(4);
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
            expect(p.y).toBeLessThanOrEqual(HEIGHT + 1e-9);
          }
        }
      }
    }
  });

  it('does not clip the outline layer — it IS the clip boundary', async () => {
    const ir = ok(await build(doc()));
    const outline = ir.layers.find((l) => l.role === 'outline')!;
    expect(area(outline.regions[0])).toBeCloseTo(WIDTH * HEIGHT, 6);
  });
});

describe('solder mask (Decision 3.2 / Decision 4)', () => {
  const maskLeaf = rect({ id: 'opening', x: 20, y: 20, width: 10, height: 10, color: 0 });

  it('row 1 — hidden container emits ONE full-panel opening, never an empty file', async () => {
    // An empty .GTS conventionally means FULL mask coverage: the exact inverse
    // of what a hidden container means (bare copper, no mask anywhere).
    const ir = ok(await build(doc({ 'solder-mask': [maskLeaf] }, { maskHidden: true })));
    const mask = ir.layers[1];
    // The four injected screw-hole openings (#235) are appended after the
    // full-panel opening and land entirely inside it — dark within dark in a
    // negative file, so they are physically subsumed by the full-panel row.
    expect(mask.regions).toHaveLength(1 + 4);
    expect(bounds(mask.regions[0].outer)).toEqual([0, 0, WIDTH, HEIGHT]);
    expect(area(mask.regions[0])).toBeCloseTo(WIDTH * HEIGHT, 6);
  });

  it('row 2 — visible container with no leaves means full coverage EXCEPT the screw holes', async () => {
    const ir = ok(await build(doc({ 'solder-mask': [] })));
    // The injected stadiums are the only openings — exactly the convention
    // the ordered alumi reference sets used for an otherwise untouched mask.
    expect(ir.layers[1].regions).toHaveLength(4);
    expect(ir.layers[1].filePolarity).toBe('negative');
  });

  it('row 3 — leaves pass through UNCOMPLEMENTED as the openings they already are', async () => {
    const ir = ok(await build(doc({ 'solder-mask': [maskLeaf] })));
    const mask = ir.layers[1];
    // 1 artwork opening + 4 injected screw-hole openings appended after it.
    expect(mask.regions).toHaveLength(1 + 4);
    expect(bounds(mask.regions[0].outer)).toEqual([20, 20, 30, 30]);
    // 100 mm², NOT the panel minus 100 mm². README.md's "positive coverage"
    // prose is stale and inverted (#216); complementing here scraps boards.
    expect(area(mask.regions[0])).toBeCloseTo(100, 6);
    expect(area(mask.regions[0])).not.toBeCloseTo(WIDTH * HEIGHT - 100, 0);
  });

  it('declares Negative polarity without ever touching the geometry', async () => {
    const withLeaf = ok(await build(doc({ 'solder-mask': [maskLeaf] })));
    const empty = ok(await build(doc()));
    expect(withLeaf.layers[1].filePolarity).toBe('negative');
    expect(empty.layers[1].filePolarity).toBe('negative');
  });
});

describe('screw-hole fabrication injections (#235, Decisions 11/12)', () => {
  // hp16 catalog: openings 4.0 × 11.08 centred on (10.16 | 70.74, 3 | 125.5).
  const artwork = rect({ id: 'art', x: 30, y: 50, width: 10, height: 10 });

  it('appends the FR-4 copper stadiums AFTER the artwork regions — the gold ring around each hole', async () => {
    const ir = ok(await build(doc({ copper: [artwork] })));
    const copper = ir.layers[0];
    expect(copper.regions).toHaveLength(5);
    expect(bounds(copper.regions[0].outer)).toEqual([30, 50, 40, 60]);
    const [, , , stadiumTop] = bounds(copper.regions[1].outer);
    expect(bounds(copper.regions[1].outer)[1]).toBeCloseTo(3 - 2, 9);
    expect(stadiumTop).toBeCloseTo(3 + 2, 9);
  });

  it('gives alumi NO copper ring — non-plated bare-metal hole edges (Decision 11)', async () => {
    const ir = ok(await build({ ...doc({ copper: [artwork] }), material: 'alumi' }));
    expect(ir.layers[0].regions).toHaveLength(1);
    expect(bounds(ir.layers[0].regions[0].outer)).toEqual([30, 50, 40, 60]);
  });

  // Dropped at the merge: #235's branch asserted the alumi back mask was EMPTY
  // here, which held only while back extraction was unimplemented. #236 now
  // fills it with the four Decision-12 openings, so that assertion contradicted
  // the spec rather than protecting it. The invariant it was reaching for —
  // injectHoleFabrication names FRONT roles only — is asserted at the seam
  // itself, and more strictly (exact key sets), by holes.test.ts's
  // 'injects FRONT roles only' case. Not restated here.

  it('injects nothing on silkscreen or the outline', async () => {
    const ir = ok(await build(doc()));
    expect(ir.layers.find((l) => l.role === 'silkscreen')!.regions).toEqual([]);
    expect(ir.layers.find((l) => l.role === 'outline')!.regions).toHaveLength(1);
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
    // Only the four injected screw-hole stadiums — no extracted artwork.
    expect(ir.layers[0].regions).toHaveLength(4);
  });

  it('refuses an unlisted panel HP, where panelWidthMm is only an approximation', async () => {
    const result = await build(doc({}, { panelHp: 13.5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.code)).toContain('unlisted-panel-hp');
    expect(result.refusals[0].layers).toEqual([]);
  });

  // #211's recorder is now a built-in source, so a pattern layer no longer
  // reaches the transitional `unsupported-layer-type` code — its `patternType`
  // is resolved against the registry instead, and 'grid' is not a registered
  // generator id. Text layers still exercise the hand-off refusal below.
  it('refuses a pattern layer naming a generator that is not registered', async () => {
    const result = await build(doc({ copper: [pattern] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0].code).toBe('unknown-pattern-id');
    expect(result.refusals[0].layers).toEqual([{ id: 'pat', name: 'Grid' }]);
  });

  // Was "refuses a text layer with no source registered". That premise died when
  // #212 registered `textGeometrySource` as a built-in: `unsupported-layer-type`
  // is now unreachable for text, exactly as #209 predicted when it added the code
  // ("transitional — unreachable once #211/#212 register"). The surviving value of
  // this case is the original intent — a text layer must never be silently DROPPED
  // — so it is asserted against the real outliner instead of against a refusal.
  it('outlines a text layer instead of dropping it', async () => {
    const text: TextLayer = {
      id: 'txt',
      name: 'Legend',
      type: 'text',
      content: 'ZPD',
      fontFamily: 'Inter',
      sizeMm: 4,
      x: 5,
      y: 5,
      color: 2,
    };
    const result = await build(doc({ silkscreen: [text] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const silkscreen = result.ir.layers.find((layer) => layer.role === 'silkscreen');
    expect(silkscreen?.regions.length ?? 0).toBeGreaterThan(0);
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
      'unknown-pattern-id',
      'unlisted-panel-hp',
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
    // 1 extracted region + 4 injected screw-hole stadiums (#235).
    expect(ok(result).layers[0].regions).toHaveLength(5);
  });

  // #218/#215: path-bool corrupts the union for a measured set of pattern
  // generators. 'seigaiha' is one of them (pattern-union-unreliable.generated.ts)
  // — export must refuse rather than ship geometry already known to be wrong.
  it('refuses a pattern layer whose generator is measured union-unreliable (#218), naming the layer and pattern id', async () => {
    const unreliable: PatternLayer = {
      id: 'pat-unreliable',
      name: 'Waves',
      type: 'pattern',
      patternType: 'seigaiha',
      params: {},
      color: 1,
      x: 0,
      y: 0,
      size: 20,
    };
    const result = await build(doc({ copper: [unreliable] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0].code).toBe('pattern-union-unreliable');
    expect(result.refusals[0].layers).toHaveLength(1);
    expect(result.refusals[0].layers[0].id).toBe('pat-unreliable');
    expect(result.refusals[0].layers[0].name).toContain('Waves');
    expect(result.refusals[0].layers[0].name).toContain('seigaiha');
  });

  it('lets a HIDDEN pattern layer through even when its generator is union-unreliable', async () => {
    const hidden: PatternLayer = {
      id: 'pat-hidden-unreliable',
      name: 'Waves',
      hidden: true,
      type: 'pattern',
      patternType: 'seigaiha',
      params: {},
      color: 1,
      x: 0,
      y: 0,
      size: 20,
    };
    const ir = ok(await build(doc({ copper: [hidden] })));
    // Only the four injected screw-hole stadiums — no extracted artwork.
    expect(ir.layers[0].regions).toHaveLength(4);
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
    // 2 artwork regions + 4 injected screw-hole stadiums (#235).
    expect(regions).toHaveLength(6);
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
      y: HEIGHT / 2 - 64,
      width: 128,
      height: 128,
      color: 1,
    };
    const ir = ok(await build(doc({ copper: [ellipse] })));
    const ring = ir.layers[0].regions[0].outer;
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
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
