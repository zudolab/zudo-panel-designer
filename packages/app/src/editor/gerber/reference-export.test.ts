// Wave 6 (#238): the epic's one end-to-end confirmation pass against the
// catalog numbers #227 pinned into panel-templates.ts. Every lower layer is
// already unit-pinned against those numbers in isolation — panelHoles()
// itself in panel-templates.test.ts, injectHoleFabrication() in
// holes.test.ts, the Excellon bytes in excellon.test.ts, and the per-role IR
// in build-ir.test.ts / back-extract.test.ts — but none of them drives a real
// DocState all the way through buildGerberIr -> gerberZipBytes -> a real
// unzip for the exact (format, hp, material) combinations #227 named. This
// file closes that gap: no existing test built a full ZIP at 1U format, or at
// hp 4 for either format.
import {
  createDefaultDoc,
  createPcbLayerContainer,
  panelHeightMm,
  panelWidthMm,
  type DocState,
  type PanelFormat,
  type PcbMaterial,
  type ShapeLayer,
} from '@zpd/core';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import { buildGerberIr, type BuildGerberIrResult } from './build-ir';
import { loadTestFontFile } from './test-font-loader';
import { setCuratedFontFileLoaderForTests } from './text-fonts';
import { gerberZipBytes } from './zip';

const OPTIONS = { creationDate: '2026-07-25T09:30:00+09:00', softwareVersion: '0.0.0' };

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
  // Same seam build-ir.test.ts uses: the real outliner (#212) lazy-loads a
  // `?url` font asset that vitest resolves to `/@fs/<abs path>`, which `fetch`
  // cannot read in this environment but the filesystem can.
  setCuratedFontFileLoaderForTests(loadTestFontFile);
});

function rect(over: Partial<ShapeLayer> & { id: string }): ShapeLayer {
  return {
    name: over.id,
    type: 'shape',
    shape: 'rect',
    x: 2,
    y: 2,
    width: 4,
    height: 4,
    color: 1,
    ...over,
  };
}

// Empty front/back containers by default — createDefaultDoc()'s demo pattern
// is sized for the DEFAULT 3U height regardless of `format` (#229's compat
// cut left that constructor 3U-only for its own demo geometry), so a 1U doc
// built from it would carry an oversized front pattern unrelated to what
// this file is confirming. Explicit small rects stand in for "front/back
// artwork" instead.
function docFor(
  format: PanelFormat,
  hp: number,
  material: PcbMaterial,
  children: {
    copper?: ShapeLayer[];
    silkscreen?: ShapeLayer[];
    backCopper?: ShapeLayer[];
    backSilkscreen?: ShapeLayer[];
  } = {},
): DocState {
  return {
    ...createDefaultDoc(hp),
    format,
    material,
    panelHp: hp,
    layers: [
      createPcbLayerContainer('copper', children.copper ?? []),
      createPcbLayerContainer('solder-mask', []),
      createPcbLayerContainer('silkscreen', children.silkscreen ?? []),
    ],
    backLayers: [
      createPcbLayerContainer('back', 'copper', children.backCopper ?? []),
      createPcbLayerContainer('back', 'solder-mask', []),
      createPcbLayerContainer('back', 'silkscreen', children.backSilkscreen ?? []),
    ],
    guides: [],
  };
}

async function build(doc: DocState): Promise<BuildGerberIrResult> {
  return buildGerberIr(doc, { engine });
}

function ok(result: BuildGerberIrResult) {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.refusals.map((r) => r.code)}`);
  return result.ir;
}

async function zipEntries(doc: DocState): Promise<Map<string, string>> {
  const ir = ok(await build(doc));
  const unzipped = unzipSync(gerberZipBytes(ir, OPTIONS));
  return new Map(Object.entries(unzipped).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

function bounds(pts: readonly { x: number; y: number }[]): [number, number, number, number] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function expectBoundsClose(actual: [number, number, number, number], expected: readonly number[]) {
  for (let i = 0; i < 4; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
}

function expectPointClose(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('reference export — alumi 3U-4hp (#227 catalog: top 6.045/3.0, bottom 13.955/125.5)', () => {
  it('drill: NPTH carries both routed slots at the catalog span, PTH is empty', async () => {
    const ir = ok(await build(docFor('3U', 4, 'alumi')));
    expect(ir.drill.pth).toEqual({ plating: 'pth', tools: [], hits: [], slots: [] });
    expect(ir.drill.npth.tools).toEqual([{ code: 1, diameterMm: 3.2 }]);
    expect(ir.drill.npth.hits).toEqual([]);
    expect(ir.drill.npth.slots).toHaveLength(2);
    // Route span: slotLength(10.28) - drillDiameter(3.2) = 7.08, half 3.54,
    // centred on the catalog cx. Coordinates stay in DOC space (no Y flip —
    // that's the emitter's job, confirmed at the zip level below).
    const [top, bottom] = ir.drill.npth.slots;
    expectPointClose(top.start, { x: 6.045 - 3.54, y: 3.0 });
    expectPointClose(top.end, { x: 6.045 + 3.54, y: 3.0 });
    expectPointClose(bottom.start, { x: 13.955 - 3.54, y: 125.5 });
    expectPointClose(bottom.end, { x: 13.955 + 3.54, y: 125.5 });
  });

  it('mask-opening stadiums: bounds match the catalog opening (4.0 x 11.08) at both rows', async () => {
    const ir = ok(await build(docFor('3U', 4, 'alumi')));
    const mask = ir.layers.find((l) => l.role === 'solder-mask')!;
    // Front container visible with no leaves (Decision 4 row 2): only the two
    // injected screw-hole stadiums.
    expect(mask.regions).toHaveLength(2);
    expectBoundsClose(bounds(mask.regions[0].outer), [6.045 - 5.54, 1.0, 6.045 + 5.54, 5.0]);
    expectBoundsClose(bounds(mask.regions[1].outer), [13.955 - 5.54, 123.5, 13.955 + 5.54, 127.5]);
  });

  it('zip: B.Mask-openings-only (no .GBL/.GBO), NPTH drill carries the routes, PTH ships header-only', async () => {
    const entries = await zipEntries(docFor('3U', 4, 'alumi'));
    expect(entries.has('zpd-panel-4hp.GBL')).toBe(false);
    expect(entries.has('zpd-panel-4hp.GBO')).toBe(false);
    expect(entries.get('zpd-panel-4hp.GBS')).toContain('G36*');

    const pth = entries.get('zpd-panel-4hp-PTH.drl')!;
    const npth = entries.get('zpd-panel-4hp-NPTH.drl')!;
    expect(pth).toContain('TF.FileFunction,Plated');
    expect(pth).not.toContain('T1');
    expect(npth).toContain('TF.FileFunction,NonPlated');
    expect(npth).toContain('T1C3.2');
    // Y-flipped through panelHeightMm('3U') = 128.5: doc cy 3.0 -> 125.5,
    // doc cy 125.5 -> 3.0 (matches excellon.test.ts's byte-exact fixture).
    expect(npth).toContain('X2.505Y125.5');
    expect(npth).toContain('X10.415Y3.0');
  });
});

describe('reference export — alumi 1U-4hp (#227 catalog, kicad-source: top 11.05/3.0, bottom 8.8/36.65)', () => {
  it('drill: NPTH carries both routed slots at the catalog span (deliberate cx asymmetry), PTH is empty', async () => {
    const ir = ok(await build(docFor('1U', 4, 'alumi')));
    expect(ir.drill.pth).toEqual({ plating: 'pth', tools: [], hits: [], slots: [] });
    expect(ir.drill.npth.slots).toHaveLength(2);
    // Route span: slotLength(10.3) - drillDiameter(3.2) = 7.1, half 3.55.
    const [top, bottom] = ir.drill.npth.slots;
    expectPointClose(top.start, { x: 11.05 - 3.55, y: 3.0 });
    expectPointClose(top.end, { x: 11.05 + 3.55, y: 3.0 });
    // Bottom cx is 8.8, NOT panelWidthMm(4) - 11.05 (= 8.95) — panel-templates
    // keeps the kicad source's hand-placed asymmetry verbatim.
    expect(panelWidthMm(4) - 11.05).not.toBe(8.8);
    expectPointClose(bottom.start, { x: 8.8 - 3.55, y: 36.65 });
    expectPointClose(bottom.end, { x: 8.8 + 3.55, y: 36.65 });
  });

  it('mask-opening stadiums: bounds match the catalog opening (3.6 x 10.7) at both rows', async () => {
    const ir = ok(await build(docFor('1U', 4, 'alumi')));
    const mask = ir.layers.find((l) => l.role === 'solder-mask')!;
    expect(mask.regions).toHaveLength(2);
    expectBoundsClose(bounds(mask.regions[0].outer), [11.05 - 5.35, 3.0 - 1.8, 11.05 + 5.35, 3.0 + 1.8]);
    expectBoundsClose(
      bounds(mask.regions[1].outer),
      [8.8 - 5.35, 36.65 - 1.8, 8.8 + 5.35, 36.65 + 1.8],
    );
  });

  it('zip: B.Mask-openings-only (no .GBL/.GBO), panel height is 1U-derived (39.65), not the 3U default', async () => {
    const ir = ok(await build(docFor('1U', 4, 'alumi')));
    expect(ir.panel).toEqual({ format: '1U', hp: 4, widthMm: panelWidthMm(4), heightMm: 39.65 });
    expect(ir.panel.heightMm).toBe(panelHeightMm('1U'));

    const entries = await zipEntries(docFor('1U', 4, 'alumi'));
    expect(entries.has('zpd-panel-4hp.GBL')).toBe(false);
    expect(entries.has('zpd-panel-4hp.GBO')).toBe(false);
    expect(entries.get('zpd-panel-4hp.GBS')).toContain('G36*');

    const npth = entries.get('zpd-panel-4hp-NPTH.drl')!;
    // Y-flipped through panelHeightMm('1U') = 39.65: doc cy 3.0 -> 36.65,
    // doc cy 36.65 -> 3.0.
    expect(npth).toContain('X7.5Y36.65');
    expect(npth).toContain('X5.25Y3.0');
    expect(entries.get('zpd-panel-4hp-PTH.drl')).not.toContain('T1');
  });
});

describe('reference export — FR-4 3U-12hp with front+back artwork', () => {
  const front = rect({ id: 'front-copper', x: 20, y: 20, width: 6, height: 6 });
  const back = rect({ id: 'back-copper', x: 20, y: 20, width: 6, height: 6 });

  it('drill: PTH carries the routed slots (plated, FR-4), NPTH is empty', async () => {
    const ir = ok(await build(docFor('3U', 12, 'fr4', { copper: [front], backCopper: [back] })));
    expect(ir.drill.npth).toEqual({ plating: 'npth', tools: [], hits: [], slots: [] });
    expect(ir.drill.pth.tools).toEqual([{ code: 1, diameterMm: 3.2 }]);
    expect(ir.drill.pth.slots).toHaveLength(4);
  });

  it('gold-ring copper stadiums appear on BOTH front copper and back copper, alongside the artwork', async () => {
    const ir = ok(await build(docFor('3U', 12, 'fr4', { copper: [front], backCopper: [back] })));
    const copper = ir.layers.find((l) => l.role === 'copper')!;
    const backCopper = ir.layers.find((l) => l.role === 'b-copper')!;
    // 1 artwork region + 4 injected screw-hole stadiums, on each side. Region
    // order is whatever ringsToRegions produces (sorted by min-y, per
    // back-extract.test.ts's own note) — not "artwork first" — so match each
    // expected stadium by bounds rather than assuming a fixed index.
    const expectedStadiums = [
      [10.16 - 5.54, 1.0, 10.16 + 5.54, 5.0],
      [50.44 - 5.54, 1.0, 50.44 + 5.54, 5.0],
      [10.16 - 5.54, 123.5, 10.16 + 5.54, 127.5],
      [50.44 - 5.54, 123.5, 50.44 + 5.54, 127.5],
    ];
    for (const layer of [copper, backCopper]) {
      expect(layer.regions).toHaveLength(5);
      const allBounds = layer.regions.map((r) => bounds(r.outer));
      for (const expected of expectedStadiums) {
        const match = allBounds.some((actual) =>
          expected.every((value, i) => Math.abs(actual[i] - value) < 1e-6),
        );
        expect(match).toBe(true);
      }
      // The artwork rect itself (doc-space x [20,26], y [20,26] on the front;
      // mirrored to x [60.6-26, 60.6-20] = [34.6, 40.6] on the back) is a
      // FIFTH region distinct from all four stadiums above.
      const artworkBounds = layer === copper ? [20, 20, 26, 26] : [34.6, 20, 40.6, 26];
      const hasArtwork = allBounds.some((actual) =>
        artworkBounds.every((value, i) => Math.abs(actual[i] - value) < 1e-6),
      );
      expect(hasArtwork).toBe(true);
    }
  });

  it('zip: .GBL/.GBS/.GBO are all present, and the back artwork is X-mirrored exactly once', async () => {
    const entries = await zipEntries(docFor('3U', 12, 'fr4', { copper: [front], backCopper: [back] }));
    for (const ext of ['GTL', 'GTS', 'GTO', 'GBL', 'GBS', 'GBO', 'GKO']) {
      expect(entries.has(`zpd-panel-12hp.${ext}`)).toBe(true);
    }
    // Front artwork rect x [20,26] emits unmirrored at X20000000/X26000000.
    expect(entries.get('zpd-panel-12hp.GTL')).toContain('X20000000');
    // Back artwork, same doc-space rect, mirrors to width(60.6) - x:
    // [60.6-26, 60.6-20] = [34.6, 40.6] -> X34600000/X40600000. Never at the
    // authored coordinate (X20000000) or a double-mirrored one (X20000000
    // again) — either would mean the exactly-once X mirror broke.
    const gbl = entries.get('zpd-panel-12hp.GBL')!;
    expect(gbl).toContain('X34600000');
    expect(gbl).toContain('X40600000');
    expect(gbl).not.toContain('X20000000');
  });
});
