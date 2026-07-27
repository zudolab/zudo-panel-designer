// The #231 seam contract, filled by #235: template holes from the catalog,
// classified per material (Decision 11), stadium injections for the mask and
// FR-4 copper roles, and the drill IR whose bytes excellon.test.ts pins.
import { panelHeightMm, panelWidthMm } from '@zpd/core';
import { describe, expect, it } from 'vitest';
import { polygonSignedArea } from './flatten';
import { drillFilename, drillFileSet, emptyDrillIr, injectHoleFabrication } from './holes';
import type { IrPanel, IrRing } from './ir';
import { FIXTURE_OPTIONS, FIXTURE_PANEL } from './test-ir';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

// FIXTURE_PANEL is 3U-12hp: four standard slots, cx 10.16 / 50.44 on rows
// cy 3 / 125.5, slot 10.28, opening 4.0 × 11.08 (panel-templates.ts).
const fabricate = (material: 'fr4' | 'alumi', panel: IrPanel = FIXTURE_PANEL) =>
  injectHoleFabrication({ material, panel, tolerance: DEFAULT_IR_TOLERANCE });

/** 3U-1hp: the round-hole catalog entry, opening 4.0 × 4.0 (a circle). */
const ROUND_PANEL: IrPanel = {
  format: '3U',
  hp: 1,
  widthMm: panelWidthMm(1),
  heightMm: panelHeightMm('3U'),
};

function bounds(ring: IrRing): [number, number, number, number] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function expectBoundsClose(ring: IrRing, expected: readonly [number, number, number, number]) {
  const actual = bounds(ring);
  for (let i = 0; i < 4; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
}

describe('injectHoleFabrication — drill classification (Decision 11)', () => {
  it('routes FR-4 holes into PTH with the other side empty', () => {
    const { drill } = fabricate('fr4');
    expect(drill.npth).toEqual({ plating: 'npth', tools: [], hits: [], slots: [] });
    expect(drill.pth.plating).toBe('pth');
    expect(drill.pth.tools).toEqual([{ code: 1, diameterMm: 3.2 }]);
    expect(drill.pth.hits).toEqual([]);
    expect(drill.pth.slots).toHaveLength(4);
  });

  it('routes alumi holes into NPTH with the other side empty', () => {
    const { drill } = fabricate('alumi');
    expect(drill.pth).toEqual({ plating: 'pth', tools: [], hits: [], slots: [] });
    expect(drill.npth.slots).toHaveLength(4);
    expect(drill.npth.tools).toEqual([{ code: 1, diameterMm: 3.2 }]);
  });

  it('spans a slot between endpoint centres: slotLength − drillDiameter, centred on cx', () => {
    const { slots } = fabricate('fr4').drill.pth;
    // 10.28 − 3.2 = 7.08 → cx ± 3.54.
    expect(slots[0].tool).toBe(1);
    expect(slots[0].start.x).toBeCloseTo(10.16 - 3.54, 9);
    expect(slots[0].end.x).toBeCloseTo(10.16 + 3.54, 9);
    expect(slots[3].start.x).toBeCloseTo(50.44 - 3.54, 9);
    expect(slots[3].end.x).toBeCloseTo(50.44 + 3.54, 9);
  });

  it('keeps drill coordinates in DOCUMENT space — the emitter flips, never this module', () => {
    const { slots } = fabricate('fr4').drill.pth;
    // Catalog order: top row (cy 3) first, bottom row (cy 125.5) after. A
    // pre-flipped IR would read 125.5 here and double-flip in the emitter.
    expect(slots[0].start.y).toBe(3);
    expect(slots[1].start.y).toBe(3);
    expect(slots[2].start.y).toBe(125.5);
    expect(slots[3].start.y).toBe(125.5);
  });

  it('emits a round hole as a hit, not a slot', () => {
    const { drill } = fabricate('fr4', ROUND_PANEL);
    expect(drill.pth.slots).toEqual([]);
    expect(drill.pth.hits).toEqual([
      { tool: 1, x: 2.5, y: 3 },
      { tool: 1, x: 2.5, y: 125.5 },
    ]);
  });
});

describe('injectHoleFabrication — mask/copper injections (Decisions 11/12/13)', () => {
  it('injects mask openings on BOTH sides for both materials, copper stadiums only on FR-4', () => {
    const fr4 = fabricate('fr4').injections;
    expect(Object.keys(fr4).sort()).toEqual([
      'b-copper',
      'b-solder-mask',
      'copper',
      'solder-mask',
    ]);
    // Same canonical front-view regions on every role — injections never
    // mirror (Decision 13), and the copper stadium is the SAME shape as the
    // opening (the drill void pierces it; the plated barrel takes the HASL).
    expect(fr4.copper).toEqual(fr4['solder-mask']);
    expect(fr4['b-solder-mask']).toEqual(fr4['solder-mask']);

    const alumi = fabricate('alumi').injections;
    expect(Object.keys(alumi).sort()).toEqual(['b-solder-mask', 'solder-mask']);
  });

  it('builds each opening as the catalog stadium — bounds, area, winding, flattened', () => {
    const openings = fabricate('fr4').injections['solder-mask']!;
    expect(openings).toHaveLength(4);

    // First hole: (10.16, 3), opening 4.0 × 11.08 → half-extents 5.54 × 2.0.
    expectBoundsClose(openings[0].outer, [10.16 - 5.54, 1, 10.16 + 5.54, 5]);
    expectBoundsClose(openings[3].outer, [50.44 - 5.54, 123.5, 50.44 + 5.54, 127.5]);

    // Stadium area: flat · width + π r² with flat = 11.08 − 4.0. Flattened
    // vertices sit ON the arc, so the polygon area is a hair UNDER the exact
    // value — ~5e-3 mm² at r = 2 with the 2.5 µm chord budget.
    const exactArea = 7.08 * 4 + Math.PI * 4;
    for (const region of openings) {
      expect(polygonSignedArea(region.outer)).toBeLessThanOrEqual(exactArea);
      expect(polygonSignedArea(region.outer)).toBeGreaterThan(exactArea - 0.02);
      expect(polygonSignedArea(region.outer)).toBeGreaterThan(0); // outer-ring sign
      expect(region.holes).toEqual([]);
      expect(region.outer.length).toBeGreaterThanOrEqual(3);
      expect(region.outer[0]).not.toEqual(region.outer[region.outer.length - 1]);
    }
  });

  it('degenerates a round hole opening (width === length) to a circle', () => {
    const openings = fabricate('fr4', ROUND_PANEL).injections['solder-mask']!;
    expect(openings).toHaveLength(2);
    expectBoundsClose(openings[0].outer, [0.5, 1, 4.5, 5]);
    // Inscribed-polygon area, a hair under the exact π r² (see above).
    expect(polygonSignedArea(openings[0].outer)).toBeLessThanOrEqual(Math.PI * 4);
    expect(polygonSignedArea(openings[0].outer)).toBeGreaterThan(Math.PI * 4 - 0.02);
  });

  it('is deterministic — the same context fabricates the same result twice', () => {
    expect(JSON.stringify(fabricate('fr4'))).toBe(JSON.stringify(fabricate('fr4')));
    expect(JSON.stringify(fabricate('alumi'))).toBe(JSON.stringify(fabricate('alumi')));
  });
});

describe('drillFilename', () => {
  it("shares gerberFileSet's stem and the reference sets' -PTH/-NPTH suffix", () => {
    expect(drillFilename('pth', 12)).toBe('zpd-panel-12hp-PTH.drl');
    expect(drillFilename('npth', 12)).toBe('zpd-panel-12hp-NPTH.drl');
  });
});

describe('drillFileSet', () => {
  it('emits both files, PTH first, the unused side header-only — byte-exact', () => {
    const [pth, npth] = drillFileSet(fabricate('alumi').drill, FIXTURE_PANEL, FIXTURE_OPTIONS);

    expect(pth.plating).toBe('pth');
    expect(pth.filename).toBe('zpd-panel-12hp-PTH.drl');
    expect(pth.text).toBe(
      [
        'M48',
        '; #@! TF.CreationDate,2026-07-25T09:30:00+09:00',
        '; #@! TF.GenerationSoftware,zudolab,zudo-panel-designer,0.0.0',
        '; #@! TF.FileFunction,Plated,1,2,PTH',
        'FMAT,2',
        'METRIC',
        '%',
        'G90',
        'G05',
        'M30',
        '',
      ].join('\n'),
    );

    expect(npth.plating).toBe('npth');
    expect(npth.filename).toBe('zpd-panel-12hp-NPTH.drl');
    expect(npth.text).toContain('; #@! TF.FileFunction,NonPlated,1,2,NPTH');
    expect(npth.text).toContain('T1C3.2');
    expect(npth.text).toContain('M15');
  });

  it('keeps an empty drill pair header-only on both sides', () => {
    for (const file of drillFileSet(emptyDrillIr(), FIXTURE_PANEL, FIXTURE_OPTIONS)) {
      expect(file.text).toContain('G05\nM30\n');
      expect(file.text).not.toContain('T1');
    }
  });

  it('is LF-terminated ASCII, same discipline as the Gerber bodies', () => {
    for (const drill of [emptyDrillIr(), fabricate('fr4').drill]) {
      for (const file of drillFileSet(drill, FIXTURE_PANEL, FIXTURE_OPTIONS)) {
        expect(file.text).not.toContain('\r');
        expect(file.text.endsWith('M30\n')).toBe(true);
        // eslint-disable-next-line no-control-regex
        expect(file.text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
      }
    }
  });
});
