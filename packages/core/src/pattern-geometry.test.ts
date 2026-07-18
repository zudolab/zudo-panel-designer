import { describe, expect, it } from 'vitest';
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';

describe('patternCoverGeometry', () => {
  it('side = the larger panel dimension, centered (12HP: 128.5mm square)', () => {
    const widthMm = panelWidthMm(12); // 60.6
    const geo = patternCoverGeometry({ widthMm, heightMm: PANEL_HEIGHT_MM });
    expect(geo.size).toBe(PANEL_HEIGHT_MM);
    expect(geo.x).toBe((widthMm - PANEL_HEIGHT_MM) / 2);
    expect(geo.y).toBe(0);
  });

  it('a wider-than-tall panel takes the width as the side and overhangs vertically', () => {
    const geo = patternCoverGeometry({ widthMm: 200, heightMm: 100 });
    expect(geo).toEqual({ x: 0, y: -50, size: 200 });
  });

  it('a square panel is covered exactly, no overhang', () => {
    expect(patternCoverGeometry({ widthMm: 80, heightMm: 80 })).toEqual({ x: 0, y: 0, size: 80 });
  });

  it('the square fully covers the panel for every spec-table HP', () => {
    for (const hp of [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20]) {
      const widthMm = panelWidthMm(hp);
      const { x, y, size } = patternCoverGeometry({ widthMm, heightMm: PANEL_HEIGHT_MM });
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(x + size).toBeGreaterThanOrEqual(widthMm);
      expect(y + size).toBeGreaterThanOrEqual(PANEL_HEIGHT_MM);
    }
  });
});
