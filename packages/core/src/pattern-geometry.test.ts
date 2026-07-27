import { describe, expect, it } from 'vitest';
import { panelWidthMm } from './panel-sizes';
import { panelHeightMm } from './panel-templates';
import { patternCoverGeometry } from './pattern-geometry';

describe('patternCoverGeometry', () => {
  it('side = the larger panel dimension, centered (12HP: 128.5mm square)', () => {
    const widthMm = panelWidthMm(12); // 60.6
    const heightMm = panelHeightMm('3U');
    const geo = patternCoverGeometry({ widthMm, heightMm });
    expect(geo.size).toBe(heightMm);
    expect(geo.x).toBe((widthMm - heightMm) / 2);
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
    const heightMm = panelHeightMm('3U');
    for (const hp of [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20]) {
      const widthMm = panelWidthMm(hp);
      const { x, y, size } = patternCoverGeometry({ widthMm, heightMm });
      expect(x).toBeLessThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0);
      expect(x + size).toBeGreaterThanOrEqual(widthMm);
      expect(y + size).toBeGreaterThanOrEqual(heightMm);
    }
  });
});
