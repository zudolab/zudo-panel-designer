// #236's seam tests: back extraction through the full front pipeline with the
// Decision 13 exactly-once X mirror, the Decision 11/12 back hole fabrication
// from the canonical panelHoles() coordinates, the Decision 4 matrix on the
// FR-4 back mask container, and Decision 8 refusal parity through the shared
// sink. The writer-level "no second mirror" half of Decision 13 is pinned by
// writer.test.ts's BACK_COPPER_LAYER fixture; the tests here pin the
// build-IR-side half.
import {
  createDefaultDoc,
  createPcbLayerContainer,
  createPcbLayerStack,
  panelHeightMm,
  panelWidthMm,
  rotatePoint,
  type DocState,
  type ImageLayer,
  type LayerNode,
  type PathLayer,
  type PatternLayer,
  type PcbLayerStack,
  type PcbMaterial,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import { extractBackLayers, type BackExtractContext } from './back-extract';
import { buildGerberIr } from './build-ir';
import { BUILTIN_GEOMETRY_SOURCES } from './extract';
import { polygonSignedArea } from './flatten';
import type { GerberRefusalCode, IrLayer, IrPoint, IrRegion, IrRing } from './ir';
import { loadTestFontFile } from './test-font-loader';
import { setCuratedFontFileLoaderForTests } from './text-fonts';
import { DEFAULT_IR_LIMITS, DEFAULT_IR_TOLERANCE } from './tolerance';
import { gerberFileSet } from './writer';

const HP = 12;
const WIDTH = panelWidthMm(HP); // 60.6
const HEIGHT = panelHeightMm('3U'); // 128.5

// 3U-4hp is the canonical hole fixture: its two slots sit DIAGONALLY —
// top (6.045, 3.0), bottom (13.955, 125.5) on a 20.0 mm panel — so the hole
// set is NOT X-mirror-symmetric and a wrongly-mirrored fabrication coordinate
// cannot masquerade as a correct one. Opening stadium: 4.0 × 11.08 mm.
const HOLE_HP = 4;
const HOLE_WIDTH = panelWidthMm(HOLE_HP); // 20.0
const OPENING_HALF_LENGTH = 11.08 / 2;
const OPENING_HALF_WIDTH = 4.0 / 2;
const STADIUM_AREA = (11.08 - 4.0) * 4.0 + Math.PI * OPENING_HALF_WIDTH ** 2;
const TOP_SLOT = { cx: 6.045, cy: 3.0 };
const BOTTOM_SLOT = { cx: 13.955, cy: 125.5 };

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
  // Same seam build-ir.test.ts uses: the outliner's `?url` font asset resolves
  // to `/@fs/<abs path>` under vitest, readable via fs but not fetch.
  setCuratedFontFileLoaderForTests(loadTestFontFile);
});

type BackChildren = Partial<Record<'copper' | 'solder-mask' | 'silkscreen', LayerNode[]>>;

function backDoc(
  children: BackChildren = {},
  options: {
    readonly material?: PcbMaterial;
    readonly maskHidden?: boolean;
    readonly panelHp?: number;
  } = {},
): DocState {
  const backLayers: PcbLayerStack = [
    createPcbLayerContainer('back', 'copper', children.copper ?? []),
    createPcbLayerContainer(
      'back',
      'solder-mask',
      children['solder-mask'] ?? [],
      options.maskHidden,
    ),
    createPcbLayerContainer('back', 'silkscreen', children.silkscreen ?? []),
  ];
  return {
    ...createDefaultDoc(),
    material: options.material ?? 'fr4',
    panelHp: options.panelHp ?? HP,
    format: '3U',
    // Empty FRONT containers (createDefaultDoc ships a demo pattern): these
    // tests are about the back, and the end-to-end cases would otherwise pay
    // for a full-panel front extraction per build.
    layers: createPcbLayerStack('front'),
    backLayers,
    guides: [],
  };
}

function ctxFor(
  doc: DocState,
  limits: BackExtractContext['limits'] = DEFAULT_IR_LIMITS,
): BackExtractContext {
  return {
    doc,
    panel: {
      format: doc.format,
      hp: doc.panelHp,
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: panelHeightMm(doc.format),
    },
    engine,
    sources: BUILTIN_GEOMETRY_SOURCES,
    tolerance: DEFAULT_IR_TOLERANCE,
    limits,
  };
}

const NO_SINK = { add: () => {} };

interface SinkRecord {
  readonly code: GerberRefusalCode;
  readonly layer?: { readonly id: string; readonly name: string };
}

function recordingSink(): { seen: SinkRecord[] } & Parameters<typeof extractBackLayers>[1] {
  const seen: SinkRecord[] = [];
  return { seen, add: (code, layer) => seen.push({ code, layer }) };
}

async function extract(doc: DocState): Promise<readonly IrLayer[]> {
  return extractBackLayers(ctxFor(doc), NO_SINK);
}

function layerOf(layers: readonly IrLayer[], role: IrLayer['role']): IrLayer {
  const found = layers.find((l) => l.role === role);
  if (!found) throw new Error(`missing role ${role}`);
  return found;
}

function ringBounds(ring: IrRing): [number, number, number, number] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function regionsBounds(regions: readonly IrRegion[]): [number, number, number, number] {
  const per = regions.map((r) => ringBounds(r.outer));
  return [
    Math.min(...per.map((b) => b[0])),
    Math.min(...per.map((b) => b[1])),
    Math.max(...per.map((b) => b[2])),
    Math.max(...per.map((b) => b[3])),
  ];
}

function area(region: IrRegion): number {
  return region.holes.reduce((a, h) => a + polygonSignedArea(h), polygonSignedArea(region.outer));
}

function totalArea(regions: readonly IrRegion[]): number {
  return regions.reduce((a, r) => a + area(r), 0);
}

/** All outer+hole vertices, sorted — invariant under ring rotation/splitting. */
function sortedVertices(regions: readonly IrRegion[]): IrPoint[] {
  const points = regions.flatMap((r) => [...r.outer, ...r.holes.flat()]);
  return [...points].sort((a, b) => a.x - b.x || a.y - b.y);
}

function expectVerticesCloseTo(actual: readonly IrPoint[], expected: readonly IrPoint[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i].x).toBeCloseTo(expected[i].x, 3);
    expect(actual[i].y).toBeCloseTo(expected[i].y, 3);
  }
}

function expectBoundsCloseTo(
  actual: readonly number[],
  expected: readonly number[],
  digits = 6,
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i], digits);
}

function rect(over: Partial<ShapeLayer> & { id: string }): ShapeLayer {
  return {
    name: over.id,
    type: 'shape',
    shape: 'rect',
    x: 2,
    y: 40,
    width: 6,
    height: 10,
    color: 1,
    ...over,
  };
}

const STADIUM_TOP_BOUNDS = [
  TOP_SLOT.cx - OPENING_HALF_LENGTH,
  TOP_SLOT.cy - OPENING_HALF_WIDTH,
  TOP_SLOT.cx + OPENING_HALF_LENGTH,
  TOP_SLOT.cy + OPENING_HALF_WIDTH,
];
const STADIUM_BOTTOM_BOUNDS = [
  BOTTOM_SLOT.cx - OPENING_HALF_LENGTH,
  BOTTOM_SLOT.cy - OPENING_HALF_WIDTH,
  BOTTOM_SLOT.cx + OPENING_HALF_LENGTH,
  BOTTOM_SLOT.cy + OPENING_HALF_WIDTH,
];

describe('contract (Decision 12 role lists)', () => {
  it('returns the FR-4 back trio with the pinned polarities and render modes', async () => {
    const layers = await extract(backDoc());
    expect(layers.map((l) => [l.role, l.filePolarity, l.renderAs])).toEqual([
      ['b-copper', 'positive', 'filled-region'],
      ['b-solder-mask', 'negative', 'filled-region'],
      ['b-silkscreen', 'positive', 'filled-region'],
    ]);
  });

  it('returns only the B.Mask layer for alumi', async () => {
    const layers = await extract(backDoc({}, { material: 'alumi' }));
    expect(layers.map((l) => l.role)).toEqual(['b-solder-mask']);
    expect(layers[0].filePolarity).toBe('negative');
  });

  it('reports nothing to the refusal sink for a clean document', async () => {
    const sink = recordingSink();
    await extractBackLayers(ctxFor(backDoc({ copper: [rect({ id: 'ok' })] })), sink);
    expect(sink.seen).toEqual([]);
  });
});

describe('hole fabrication (Decisions 11/12)', () => {
  it('puts the opening stadiums on the FR-4 back mask at CANONICAL coordinates — never mirrored', async () => {
    const layers = await extract(backDoc({}, { panelHp: HOLE_HP }));
    const mask = layerOf(layers, 'b-solder-mask');
    expect(mask.regions).toHaveLength(2);
    // ringsToRegions orders by min(y): top slot first. Its centre must sit at
    // cx = 6.045 — a mirror would land it at 20 − 6.045 = 13.955, which the
    // diagonal 3U-4hp fixture makes detectably wrong.
    expectBoundsCloseTo(ringBounds(mask.regions[0].outer), STADIUM_TOP_BOUNDS);
    expectBoundsCloseTo(ringBounds(mask.regions[1].outer), STADIUM_BOTTOM_BOUNDS);
    const [minX, , maxX] = ringBounds(mask.regions[0].outer);
    expect((minX + maxX) / 2).toBeCloseTo(TOP_SLOT.cx, 6);
    for (const region of mask.regions) {
      // The flattened cap chords sit inside the true arc, so the polygon area
      // undershoots by a few thousandths of a mm² — well inside Decision 6's
      // budget, hence the loose final digit.
      expect(area(region)).toBeCloseTo(STADIUM_AREA, 1);
      expect(polygonSignedArea(region.outer)).toBeGreaterThan(0);
      expect(region.holes).toEqual([]);
    }
  });

  it('puts a copper stadium of the same opening shape on FR-4 b-copper, alongside mirrored artwork', async () => {
    const layers = await extract(backDoc({ copper: [rect({ id: 'art' })] }, { panelHp: HOLE_HP }));
    const copper = layerOf(layers, 'b-copper');
    expect(copper.regions).toHaveLength(3);
    // The artwork rect (back-view x ∈ [2, 8]) mirrors to [12, 18]; the
    // stadiums stay canonical.
    const boundsList = copper.regions.map((r) => ringBounds(r.outer));
    expectBoundsCloseTo(boundsList[0], STADIUM_TOP_BOUNDS);
    expectBoundsCloseTo(boundsList[1], [HOLE_WIDTH - 8, 40, HOLE_WIDTH - 2, 50]);
    expectBoundsCloseTo(boundsList[2], STADIUM_BOTTOM_BOUNDS);
  });

  it('puts NO hole fabrication on b-silkscreen', async () => {
    const layers = await extract(backDoc({}, { panelHp: HOLE_HP }));
    expect(layerOf(layers, 'b-silkscreen').regions).toEqual([]);
  });

  it('alumi B.Mask carries ONLY the openings — back artwork is never consulted and never refuses', async () => {
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
    const sink = recordingSink();
    const layers = await extractBackLayers(
      ctxFor(
        backDoc(
          { copper: [image, rect({ id: 'art' })], 'solder-mask': [rect({ id: 'leaf' })] },
          { material: 'alumi', maskHidden: true, panelHp: HOLE_HP },
        ),
      ),
      sink,
    );
    expect(layers).toHaveLength(1);
    const mask = layers[0];
    expect(mask.regions).toHaveLength(2);
    expectBoundsCloseTo(ringBounds(mask.regions[0].outer), STADIUM_TOP_BOUNDS);
    expectBoundsCloseTo(ringBounds(mask.regions[1].outer), STADIUM_BOTTOM_BOUNDS);
    // Not the Decision 4 full-panel opening, not the artwork, and no refusal
    // from the unmanufactured image layer: the alumi back is bare metal.
    expect(sink.seen).toEqual([]);
  });
});

describe('Decision 4 matrix on the FR-4 back mask container', () => {
  const maskLeaf = rect({ id: 'opening', x: 1, y: 60, width: 4, height: 8, color: 0 });

  it('row 1 — hidden container emits ONE full-panel opening that subsumes the stadiums', async () => {
    const layers = await extract(
      backDoc({ 'solder-mask': [maskLeaf] }, { maskHidden: true, panelHp: HOLE_HP }),
    );
    const mask = layerOf(layers, 'b-solder-mask');
    expect(mask.regions).toHaveLength(1);
    expect(ringBounds(mask.regions[0].outer)).toEqual([0, 0, HOLE_WIDTH, HEIGHT]);
    expect(area(mask.regions[0])).toBeCloseTo(HOLE_WIDTH * HEIGHT, 6);
  });

  it('row 2 — visible container with no leaves carries only the stadiums (full coverage elsewhere)', async () => {
    const layers = await extract(backDoc({}, { panelHp: HOLE_HP }));
    const mask = layerOf(layers, 'b-solder-mask');
    expect(mask.regions).toHaveLength(2);
    expect(totalArea(mask.regions)).toBeCloseTo(2 * STADIUM_AREA, 1);
  });

  it('row 3 — leaves pass through mirrored and UNCOMPLEMENTED, alongside the stadiums', async () => {
    const layers = await extract(backDoc({ 'solder-mask': [maskLeaf] }, { panelHp: HOLE_HP }));
    const mask = layerOf(layers, 'b-solder-mask');
    expect(mask.regions).toHaveLength(3);
    // Back-view x ∈ [1, 5] mirrors to [15, 19].
    const leaf = mask.regions.find((r) => ringBounds(r.outer)[1] === 60);
    expect(leaf).toBeDefined();
    expectBoundsCloseTo(ringBounds(leaf!.outer), [15, 60, 19, 68]);
    expect(area(leaf!)).toBeCloseTo(4 * 8, 6);
  });
});

describe('Decision 13 — exactly-once X mirror', () => {
  it('mirrors a path exactly once: authored back-view vertices land at width − x', async () => {
    const triangle: PathLayer = {
      id: 'tri',
      name: 'tri',
      type: 'path',
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 10, y: 20 },
      ],
      closed: true,
      fill: 2,
      stroke: null,
      strokeWidth: 0,
    };
    const layers = await extract(backDoc({ silkscreen: [triangle] }));
    const silk = layerOf(layers, 'b-silkscreen');
    expect(silk.regions).toHaveLength(1);
    expectVerticesCloseTo(sortedVertices(silk.regions), [
      { x: WIDTH - 30, y: 10 },
      { x: WIDTH - 10, y: 10 },
      { x: WIDTH - 10, y: 20 },
    ]);
    // Winding is re-normalised after the mirror: still a positive outer.
    expect(polygonSignedArea(silk.regions[0].outer)).toBeGreaterThan(0);
    // And it is NOT at the authored coordinates (zero mirrors) — which would
    // also be where a double mirror lands.
    expect(ringBounds(silk.regions[0].outer)[0]).not.toBeCloseTo(10, 1);
  });

  it('mirrors a rotated shape once, with the rotation baked BEFORE the mirror', async () => {
    const rotated = rect({ id: 'rot', x: 5, y: 10, width: 20, height: 6, rotation: 30 });
    const layers = await extract(backDoc({ silkscreen: [rotated] }));
    const silk = layerOf(layers, 'b-silkscreen');
    expect(silk.regions).toHaveLength(1);
    const center = { x: 5 + 20 / 2, y: 10 + 6 / 2 };
    const corners = [
      { x: 5, y: 10 },
      { x: 25, y: 10 },
      { x: 25, y: 16 },
      { x: 5, y: 16 },
    ];
    const expected = corners
      .map((corner) => rotatePoint(corner, center, 30))
      .map((p) => ({ x: WIDTH - p.x, y: p.y }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    expectVerticesCloseTo(sortedVertices(silk.regions), expected);
  });

  it('mirrors a pattern layer once — same area as the front extraction, bounds reflected', async () => {
    const pattern: PatternLayer = {
      id: 'pat',
      name: 'Dot grid',
      type: 'pattern',
      patternType: 'dot-grid', // NOT in pattern-union-unreliable.generated.ts
      params: {},
      color: 2,
      x: 3,
      y: 5,
      size: 14,
    };
    const backLayers = await extract(backDoc({ silkscreen: [pattern] }));
    const back = layerOf(backLayers, 'b-silkscreen');

    const frontDoc: DocState = {
      ...createDefaultDoc(),
      panelHp: HP,
      layers: [
        createPcbLayerContainer('copper', []),
        createPcbLayerContainer('solder-mask', []),
        createPcbLayerContainer('silkscreen', [pattern]),
      ],
      guides: [],
    };
    const frontResult = await buildGerberIr(frontDoc, { engine });
    expect(frontResult.ok).toBe(true);
    if (!frontResult.ok) return;
    const front = frontResult.ir.layers.find((l) => l.role === 'silkscreen')!;

    expect(front.regions.length).toBeGreaterThan(0);
    expect(back.regions.length).toBe(front.regions.length);
    expect(totalArea(back.regions)).toBeCloseTo(totalArea(front.regions), 4);
    const fb = regionsBounds(front.regions);
    const bb = regionsBounds(back.regions);
    expectBoundsCloseTo(bb, [WIDTH - fb[2], fb[1], WIDTH - fb[0], fb[3]]);
    // Asymmetric placement (x = 3 on a 60.6 panel): the mirror is observable.
    expect(bb[0]).toBeGreaterThan(WIDTH / 2);
  });

  it('mirrors asymmetric text once — the front pipeline run through the same outliner, reflected', async () => {
    const text: TextLayer = {
      id: 'txt',
      name: 'Legend',
      type: 'text',
      content: 'F', // asymmetric glyph: a mirror is visible in its geometry
      fontFamily: 'Inter',
      sizeMm: 8,
      x: 4,
      y: 20,
      color: 2,
    };
    const backLayers = await extract(backDoc({ silkscreen: [text] }));
    const back = layerOf(backLayers, 'b-silkscreen');

    const frontDoc: DocState = {
      ...createDefaultDoc(),
      panelHp: HP,
      layers: [
        createPcbLayerContainer('copper', []),
        createPcbLayerContainer('solder-mask', []),
        createPcbLayerContainer('silkscreen', [text]),
      ],
      guides: [],
    };
    const frontResult = await buildGerberIr(frontDoc, { engine });
    expect(frontResult.ok).toBe(true);
    if (!frontResult.ok) return;
    const front = frontResult.ir.layers.find((l) => l.role === 'silkscreen')!;

    expect(front.regions.length).toBeGreaterThan(0);
    expect(back.regions.length).toBe(front.regions.length);
    expect(totalArea(back.regions)).toBeCloseTo(totalArea(front.regions), 3);
    const fb = regionsBounds(front.regions);
    const bb = regionsBounds(back.regions);
    expectBoundsCloseTo(bb, [WIDTH - fb[2], fb[1], WIDTH - fb[0], fb[3]], 3);
  });

  it('emits byte-identical contour coordinates for pre-mirrored authoring — .GBO equals the front .GTO', async () => {
    // The same physical artwork authored twice: on the front at x = 5.3, and
    // on the back at back-view x = width − 5.3 − 10 (what a user drawing the
    // same mark while looking at the back would place). Exactly ONE mirror
    // lands both on identical canonical coordinates, so the emitted operation
    // streams must match byte for byte; zero or two mirrors puts the back
    // copy 40 mm away.
    const frontDoc: DocState = {
      ...createDefaultDoc(),
      panelHp: HP,
      layers: [
        createPcbLayerContainer('copper', []),
        createPcbLayerContainer('solder-mask', []),
        createPcbLayerContainer('silkscreen', [
          rect({ id: 'mark', x: 5.3, y: 2, width: 10, height: 4, color: 2 }),
        ]),
      ],
      guides: [],
    };
    const backAuthored = backDoc({
      silkscreen: [rect({ id: 'mark', x: WIDTH - 5.3 - 10, y: 2, width: 10, height: 4, color: 2 })],
    });

    const options = { creationDate: '2026-07-25T09:30:00+09:00', softwareVersion: '0.0.0' };
    const frontResult = await buildGerberIr(frontDoc, { engine });
    const backResult = await buildGerberIr(backAuthored, { engine });
    expect(frontResult.ok && backResult.ok).toBe(true);
    if (!frontResult.ok || !backResult.ok) return;

    // The kernel picks its own starting vertex when it rebuilds a union ring,
    // and the mirrored input legitimately walks the arrangement differently —
    // so each contour is compared as the CYCLIC vertex sequence it is (rotated
    // to a canonical start, direction preserved). Every byte of every
    // coordinate must still match; only the arbitrary phase is normalised.
    const contours = (text: string): string[][] => {
      const out: string[][] = [];
      for (const block of text.split('G36*\n').slice(1)) {
        const vertices = block
          .split('\n')
          .filter((line) => /^X-?\d+Y-?\d+D0[12]\*$/.test(line))
          .map((line) => line.replace(/D0[12]\*$/, ''));
        vertices.pop(); // the explicit closing segment repeats the start
        const start = vertices.indexOf([...vertices].sort()[0]);
        out.push([...vertices.slice(start), ...vertices.slice(0, start)]);
      }
      return out;
    };
    const gto = gerberFileSet(frontResult.ir, options).find((f) => f.extension === '.GTO')!;
    const gbo = gerberFileSet(backResult.ir, options).find((f) => f.extension === '.GBO')!;
    expect(contours(gbo.text).length).toBeGreaterThan(0);
    expect(contours(gbo.text)).toEqual(contours(gto.text));
  });

  it('lands an asymmetric glyph at width − x in .GBL, unmirrored in .GTL when placed on front', async () => {
    const glyph: TextLayer = {
      id: 'txt',
      name: 'Legend',
      type: 'text',
      content: 'F',
      fontFamily: 'Inter',
      sizeMm: 8,
      x: 4,
      y: 50,
      color: 1,
    };
    const frontDoc: DocState = {
      ...createDefaultDoc(),
      panelHp: HP,
      layers: [
        createPcbLayerContainer('copper', [glyph]),
        createPcbLayerContainer('solder-mask', []),
        createPcbLayerContainer('silkscreen', []),
      ],
      guides: [],
    };
    const backDocWithGlyph = backDoc({ copper: [glyph] });

    const options = { creationDate: '2026-07-25T09:30:00+09:00', softwareVersion: '0.0.0' };
    const frontResult = await buildGerberIr(frontDoc, { engine });
    const backResult = await buildGerberIr(backDocWithGlyph, { engine });
    expect(frontResult.ok && backResult.ok).toBe(true);
    if (!frontResult.ok || !backResult.ok) return;

    const gtl = gerberFileSet(frontResult.ir, options).find((f) => f.extension === '.GTL')!;
    const gbl = gerberFileSet(backResult.ir, options).find((f) => f.extension === '.GBL')!;

    // .GBL also carries the hole-fabrication stadiums near the panel's top and
    // bottom edges; the glyph sits at doc y ∈ [50, 58], a disjoint band, so
    // its operations are separable by the (writer-flipped) Y coordinate.
    const NM = 1e6;
    const glyphXs = (text: string): number[] =>
      [...text.matchAll(/^X(-?\d+)Y(-?\d+)D0[12]\*$/gm)]
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
        .filter((p) => p.y > (HEIGHT - 60) * NM && p.y < (HEIGHT - 45) * NM)
        .map((p) => p.x);
    const frontXs = glyphXs(gtl.text);
    const backXs = glyphXs(gbl.text);
    expect(frontXs.length).toBeGreaterThan(0);
    expect(backXs.length).toBe(frontXs.length);

    // Unmirrored on the front: the glyph starts near its authored x = 4 mm
    // (allowing the font's left side bearing).
    expect(Math.min(...frontXs)).toBeGreaterThanOrEqual(4 * NM - 1);
    expect(Math.min(...frontXs)).toBeLessThan(8 * NM);
    // Mirrored exactly once on the back: x → width − x, nanometre-exact.
    const widthNm = Math.round(WIDTH * NM);
    expect(Math.max(...backXs)).toBeCloseTo(widthNm - Math.min(...frontXs), -1);
    expect(Math.min(...backXs)).toBeCloseTo(widthNm - Math.max(...frontXs), -1);
  });
});

describe('refusal parity through the shared sink (Decision 8)', () => {
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
  const unreliable: PatternLayer = {
    id: 'pat-unreliable',
    name: 'Waves',
    type: 'pattern',
    patternType: 'seigaiha', // measured union-unreliable (#218)
    params: {},
    color: 1,
    x: 0,
    y: 0,
    size: 20,
  };

  it('refuses a visible image layer on the back, naming it', async () => {
    const sink = recordingSink();
    await extractBackLayers(ctxFor(backDoc({ copper: [image] })), sink);
    expect(sink.seen).toEqual([
      { code: 'image-layer-present', layer: { id: 'img', name: 'Trace source' } },
    ]);
  });

  it('lets a HIDDEN back layer through — hidden never reaches extraction', async () => {
    const sink = recordingSink();
    const layers = await extractBackLayers(
      ctxFor(backDoc({ copper: [{ ...image, hidden: true }] }, { panelHp: HOLE_HP })),
      sink,
    );
    expect(sink.seen).toEqual([]);
    // Only the copper stadium fabrication remains.
    expect(layerOf(layers, 'b-copper').regions).toHaveLength(2);
  });

  it('refuses a union-unreliable pattern generator on the back (#218)', async () => {
    const sink = recordingSink();
    await extractBackLayers(ctxFor(backDoc({ copper: [unreliable] })), sink);
    expect(sink.seen).toHaveLength(1);
    expect(sink.seen[0].code).toBe('pattern-union-unreliable');
    expect(sink.seen[0].layer?.id).toBe('pat-unreliable');
    expect(sink.seen[0].layer?.name).toContain('Waves');
    expect(sink.seen[0].layer?.name).toContain('seigaiha');
  });

  it('applies the Decision 8 ring ceiling to back layers and skips their boolean tail', async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      rect({ id: `r${i}`, x: i * 2, y: 0, width: 1, height: 1 }),
    );
    const sink = recordingSink();
    const layers = await extractBackLayers(
      ctxFor(backDoc({ copper: many }, { panelHp: HOLE_HP }), {
        maxRingsPerLayer: 3,
        maxTotalVertices: 2_000_000,
      }),
      sink,
    );
    expect(sink.seen.length).toBeGreaterThan(0);
    expect(sink.seen.every((r) => r.code === 'complexity-overrun')).toBe(true);
    // The ceiling's whole point is keeping runaway geometry out of the boolean
    // kernel: a refused role skips union+clip entirely (the export aborts at
    // the refusal gate, so its regions are discarded regardless).
    expect(layerOf(layers, 'b-copper').regions).toEqual([]);
    // Other back roles are unaffected — the mask still carries its stadiums.
    expect(layerOf(layers, 'b-solder-mask').regions).toHaveLength(2);
  });

  it('aborts the whole export with front and back problems in ONE collected dialog', async () => {
    const doc: DocState = {
      ...backDoc({ copper: [unreliable], silkscreen: [{ ...image, id: 'img-back' }] }),
      layers: [
        createPcbLayerContainer('copper', [image]),
        createPcbLayerContainer('solder-mask', []),
        createPcbLayerContainer('silkscreen', []),
      ],
    };
    const result = await buildGerberIr(doc, { engine });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byCode = new Map(result.refusals.map((r) => [r.code, r]));
    expect([...byCode.keys()].sort()).toEqual(['image-layer-present', 'pattern-union-unreliable']);
    // Front and back offenders of the same code share one listing.
    expect(
      byCode
        .get('image-layer-present')!
        .layers.map((l) => l.id)
        .sort(),
    ).toEqual(['img', 'img-back']);
  });
});
