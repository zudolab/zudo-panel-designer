import { describe, expect, it } from 'vitest';
import {
  PANEL_FORMAT_HEIGHTS,
  panelHeightMm,
  panelHoles,
  panelTemplateProvenance,
  supportedHps,
} from './panel-templates';

describe('PANEL_FORMAT_HEIGHTS / panelHeightMm', () => {
  it('1U is 39.65mm, 3U is 128.5mm', () => {
    expect(PANEL_FORMAT_HEIGHTS['1U']).toBe(39.65);
    expect(PANEL_FORMAT_HEIGHTS['3U']).toBe(128.5);
    expect(panelHeightMm('1U')).toBe(39.65);
    expect(panelHeightMm('3U')).toBe(128.5);
  });
});

describe('supportedHps', () => {
  it('1U is capped at the reference set', () => {
    expect(supportedHps('1U')).toEqual([1, 2, 3, 4, 5, 6, 8, 10]);
  });

  it('3U keeps the existing 20hp product size on top of the reference set', () => {
    expect(supportedHps('3U')).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20]);
  });
});

describe('panelHoles 1U (kicad-source)', () => {
  it('1hp: round holes at cx 2.5, top/bottom cy 3.0/36.65', () => {
    expect(panelHoles('1U', 1)).toEqual([
      {
        cx: 2.5,
        cy: 3.0,
        shape: 'round',
        drillDiameter: 3.2,
        opening: { width: 3.6, length: 3.6 },
      },
      {
        cx: 2.5,
        cy: 36.65,
        shape: 'round',
        drillDiameter: 3.2,
        opening: { width: 3.6, length: 3.6 },
      },
    ]);
  });

  it('2hp: symmetric slots at cx 4.9, slotLength 8.0', () => {
    expect(panelHoles('1U', 2)).toEqual([
      {
        cx: 4.9,
        cy: 3.0,
        shape: 'slot',
        drillDiameter: 3.2,
        slotLength: 8.0,
        opening: { width: 3.6, length: 8.4 },
      },
      {
        cx: 4.9,
        cy: 36.65,
        shape: 'slot',
        drillDiameter: 3.2,
        slotLength: 8.0,
        opening: { width: 3.6, length: 8.4 },
      },
    ]);
  });

  it('3hp: top cx 6.04, bottom cx 8.85, slotLength 10.3', () => {
    const holes = panelHoles('1U', 3);
    expect(holes[0]).toMatchObject({ cx: 6.04, cy: 3.0, shape: 'slot', slotLength: 10.3 });
    expect(holes[1]).toMatchObject({ cx: 8.85, cy: 36.65, shape: 'slot', slotLength: 10.3 });
    expect(holes[0]?.opening).toEqual({ width: 3.6, length: 10.7 });
  });

  // The 1U-4hp bottom cx is 8.8 in the kicad source, NOT width - 11.05
  // (= 8.95) -- this deliberate asymmetry must be preserved verbatim.
  it('4hp: top cx 11.05, bottom cx 8.8 (deliberate asymmetry, NOT width - 11.05)', () => {
    const holes = panelHoles('1U', 4);
    expect(holes[0]?.cx).toBe(11.05);
    expect(holes[1]?.cx).toBe(8.8);
    expect(holes[1]?.cx).not.toBe(20.0 - 11.05);
  });

  it('5/6/8/10hp: top cx pinned at 11.05, bottom cx per size', () => {
    expect(panelHoles('1U', 5).map((h) => h.cx)).toEqual([11.05, 13.95]);
    expect(panelHoles('1U', 6).map((h) => h.cx)).toEqual([11.05, 18.95]);
    expect(panelHoles('1U', 8).map((h) => h.cx)).toEqual([11.05, 29.25]);
    expect(panelHoles('1U', 10).map((h) => h.cx)).toEqual([11.05, 39.45]);
  });

  it('every 1U size has drillDiameter 3.2 and two holes (top + bottom row)', () => {
    for (const hp of supportedHps('1U')) {
      const holes = panelHoles('1U', hp);
      expect(holes).toHaveLength(2);
      for (const hole of holes) {
        expect(hole.drillDiameter).toBe(3.2);
      }
      expect(holes[0]?.cy).toBe(3.0);
      expect(holes[1]?.cy).toBe(36.65);
    }
  });
});

describe('panelHoles 3U (ordered-gerber)', () => {
  it('1hp: round holes at cx 2.5, top/bottom cy 3.0/125.5', () => {
    expect(panelHoles('3U', 1)).toEqual([
      {
        cx: 2.5,
        cy: 3.0,
        shape: 'round',
        drillDiameter: 3.2,
        opening: { width: 4.0, length: 4.0 },
      },
      {
        cx: 2.5,
        cy: 125.5,
        shape: 'round',
        drillDiameter: 3.2,
        opening: { width: 4.0, length: 4.0 },
      },
    ]);
  });

  it('2hp: top cx 3.505, bottom cx 6.295, slotLength 5.2', () => {
    const holes = panelHoles('3U', 2);
    expect(holes[0]).toMatchObject({ cx: 3.505, cy: 3.0, slotLength: 5.2 });
    expect(holes[1]).toMatchObject({ cx: 6.295, cy: 125.5, slotLength: 5.2 });
    expect(holes[0]?.opening).toEqual({ width: 4.0, length: 6.0 });
  });

  it('3/4hp: top cx 6.045, bottom cx per size, slotLength 10.28', () => {
    expect(panelHoles('3U', 3).map((h) => h.cx)).toEqual([6.045, 8.855]);
    expect(panelHoles('3U', 4).map((h) => h.cx)).toEqual([6.045, 13.955]);
  });

  // 3U-5hp bottom cx is 14.838, NOT width - 10.16 (= 14.84) -- confirmed
  // against the ordered gerber flash coordinates, keep verbatim.
  it('5hp: top cx 10.16, bottom cx 14.838 (NOT width - 10.16)', () => {
    const holes = panelHoles('3U', 5);
    expect(holes[0]?.cx).toBe(10.16);
    expect(holes[1]?.cx).toBe(14.838);
    expect(holes[1]?.cx).not.toBe(25.0 - 10.16);
  });

  it('6/8/10hp: top cx pinned at 10.16, bottom cx per size', () => {
    expect(panelHoles('3U', 6).map((h) => h.cx)).toEqual([10.16, 19.84]);
    expect(panelHoles('3U', 8).map((h) => h.cx)).toEqual([10.16, 30.14]);
    expect(panelHoles('3U', 10).map((h) => h.cx)).toEqual([10.16, 40.34]);
  });

  it('12/14/16hp: 4 slots at cx 10.16 and width - 10.16, both rows', () => {
    expect(panelHoles('3U', 12).map((h) => [h.cx, h.cy])).toEqual([
      [10.16, 3.0],
      [50.44, 3.0],
      [10.16, 125.5],
      [50.44, 125.5],
    ]);
    expect(panelHoles('3U', 14).map((h) => h.cx)).toEqual([10.16, 60.64, 10.16, 60.64]);
    expect(panelHoles('3U', 16).map((h) => h.cx)).toEqual([10.16, 70.74, 10.16, 70.74]);
  });

  it('20hp: 4 slots at cx 10.16 and 91.14, both rows', () => {
    expect(panelHoles('3U', 20).map((h) => [h.cx, h.cy])).toEqual([
      [10.16, 3.0],
      [91.14, 3.0],
      [10.16, 125.5],
      [91.14, 125.5],
    ]);
  });

  it('every listed 3U size has drillDiameter 3.2 and slotLength/opening.length 10.28/11.08 above 2hp', () => {
    for (const hp of supportedHps('3U')) {
      if (hp <= 2) continue;
      for (const hole of panelHoles('3U', hp)) {
        expect(hole.drillDiameter).toBe(3.2);
        expect(hole.slotLength).toBe(10.28);
        expect(hole.opening).toEqual({ width: 4.0, length: 11.08 });
      }
    }
  });
});

describe('panelTemplateProvenance', () => {
  it('1U is kicad-source for every listed size', () => {
    for (const hp of supportedHps('1U')) {
      expect(panelTemplateProvenance('1U', hp)).toBe('kicad-source');
    }
  });

  it('3U is ordered-gerber for every listed size except 20hp', () => {
    for (const hp of supportedHps('3U')) {
      const expected = hp === 20 ? 'derived' : 'ordered-gerber';
      expect(panelTemplateProvenance('3U', hp)).toBe(expected);
    }
  });

  it('an hp outside the catalog is always derived', () => {
    expect(panelTemplateProvenance('1U', 7)).toBe('derived');
    expect(panelTemplateProvenance('3U', 7)).toBe('derived');
    expect(panelTemplateProvenance('3U', 24)).toBe('derived');
  });
});

describe('panelHoles derivation rule (unlisted hp)', () => {
  it('1U unlisted hp: top cx 11.05, bottom cx width - 11.05, slot 10.3', () => {
    const holes = panelHoles('1U', 7); // panelWidthMm(7) falls back to 7 * 5.08 = 35.56
    expect(holes).toHaveLength(2);
    expect(holes[0]).toMatchObject({ cx: 11.05, cy: 3.0, shape: 'slot', slotLength: 10.3 });
    expect(holes[1]?.cy).toBe(36.65);
    expect(holes[1]?.cx).toBeCloseTo(35.56 - 11.05, 5);
  });

  it('3U unlisted hp in [5,10]: top cx 10.16, bottom cx width - 10.16', () => {
    const holes = panelHoles('3U', 9); // panelWidthMm(9) falls back to 9 * 5.08 = 45.72
    expect(holes).toHaveLength(2);
    expect(holes[0]?.cx).toBe(10.16);
    expect(holes[1]?.cx).toBeCloseTo(45.72 - 10.16, 5);
  });

  it('3U unlisted hp >= 12: 4 slots at cx 10.16 and width - 10.16, both rows', () => {
    const holes = panelHoles('3U', 24); // beyond the 20hp product max
    const width = 24 * 5.08;
    expect(holes).toHaveLength(4);
    expect(holes.map((h) => h.cx)).toEqual([10.16, width - 10.16, 10.16, width - 10.16]);
    expect(holes.map((h) => h.cy)).toEqual([3.0, 3.0, 125.5, 125.5]);
  });
});
