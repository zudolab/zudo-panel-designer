import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fit,
  MAX_PX_PER_MM,
  MIN_PX_PER_MM,
  panBy,
  project,
  unproject,
  zoomAt,
  type Camera,
} from './camera';

const cam: Camera = { pxPerMm: 4, offsetX: 100, offsetY: 60 };

describe('project/unproject', () => {
  it('are exact inverses', () => {
    const mm = { x: 12.34, y: 56.78 };
    const round = unproject(cam, project(cam, mm));
    expect(round.x).toBeCloseTo(mm.x, 9);
    expect(round.y).toBeCloseTo(mm.y, 9);
  });

  it('project maps mm origin to the camera offset', () => {
    expect(project(cam, { x: 0, y: 0 })).toEqual({ x: 100, y: 60 });
  });
});

describe('fit', () => {
  it('centers the panel in the viewport', () => {
    const c = fit(60, 128.5, { width: 800, height: 600 }, 48);
    // panel centered: left+right offsets equal
    const rightOffset = 800 - (c.offsetX + 60 * c.pxPerMm);
    expect(c.offsetX).toBeCloseTo(rightOffset, 6);
    const bottomOffset = 600 - (c.offsetY + 128.5 * c.pxPerMm);
    expect(c.offsetY).toBeCloseTo(bottomOffset, 6);
  });

  it('fits within the margin on the constraining axis', () => {
    const margin = 48;
    const c = fit(60, 128.5, { width: 800, height: 600 }, margin);
    // height is the tighter axis here
    expect(128.5 * c.pxPerMm).toBeLessThanOrEqual(600 - margin * 2 + 1e-6);
  });

  it('clamps zoom into the sane range', () => {
    const tiny = fit(1000, 1000, { width: 100, height: 100 });
    expect(tiny.pxPerMm).toBe(MIN_PX_PER_MM);
    const huge = fit(0.01, 0.01, { width: 2000, height: 2000 });
    expect(huge.pxPerMm).toBe(MAX_PX_PER_MM);
  });
});

describe('zoomAt', () => {
  it('keeps the mm point under the cursor stationary', () => {
    const screen = { x: 320, y: 240 };
    const before = unproject(cam, screen);
    const zoomed = zoomAt(cam, screen, 1.5);
    const after = unproject(zoomed, screen);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomed.pxPerMm).toBeCloseTo(6, 9);
  });

  it('clamps and does not overshoot past MAX', () => {
    const zoomed = zoomAt({ pxPerMm: 80, offsetX: 0, offsetY: 0 }, { x: 0, y: 0 }, 4);
    expect(zoomed.pxPerMm).toBe(MAX_PX_PER_MM);
  });
});

describe('panBy / clampZoom', () => {
  it('panBy shifts only the offsets', () => {
    const p = panBy(cam, 10, -20);
    expect(p).toEqual({ pxPerMm: 4, offsetX: 110, offsetY: 40 });
  });

  it('clampZoom bounds the value', () => {
    expect(clampZoom(0.1)).toBe(MIN_PX_PER_MM);
    expect(clampZoom(1000)).toBe(MAX_PX_PER_MM);
    expect(clampZoom(10)).toBe(10);
  });
});
