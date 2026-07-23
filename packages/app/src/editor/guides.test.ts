import { describe, expect, it } from 'vitest';
import { createPcbLayerStack } from '@zpd/core';
import type { DocState, Guide } from '@zpd/core';
import type { Camera } from './camera';
import {
  addGuide,
  createGuide,
  guideAtPoint,
  guideScreenCoord,
  positionForPoint,
  removeGuide,
  updateGuidePosition,
} from './guides';

// 2px/mm, panel origin offset 100px right / 50px down — arbitrary but exercises
// both the scale and the offset so a bug in either surfaces.
const CAM: Camera = { pxPerMm: 2, offsetX: 100, offsetY: 50 };

const h = (position: number, extra: Partial<Guide> = {}): Guide => ({
  id: `h-${position}`,
  orientation: 'horizontal',
  position,
  ...extra,
});
const v = (position: number, extra: Partial<Guide> = {}): Guide => ({
  id: `v-${position}`,
  orientation: 'vertical',
  position,
  ...extra,
});

const baseDoc = (guides: Guide[]): DocState => ({ panelHp: 12, layers: createPcbLayerStack(), guides });

describe('guideScreenCoord', () => {
  it('maps a horizontal guide to a screen y (position*pxPerMm + offsetY)', () => {
    expect(guideScreenCoord(h(10), CAM)).toBe(10 * 2 + 50);
  });
  it('maps a vertical guide to a screen x (position*pxPerMm + offsetX)', () => {
    expect(guideScreenCoord(v(10), CAM)).toBe(10 * 2 + 100);
  });
});

describe('positionForPoint', () => {
  it('is the inverse of guideScreenCoord for a horizontal guide', () => {
    const y = guideScreenCoord(h(12.5), CAM);
    expect(positionForPoint('horizontal', CAM, { x: 999, y })).toBe(12.5);
  });
  it('is the inverse for a vertical guide (ignores the off-axis coordinate)', () => {
    const x = guideScreenCoord(v(7.25), CAM);
    expect(positionForPoint('vertical', CAM, { x, y: 999 })).toBe(7.25);
  });
  it('rounds to 0.01mm to avoid float drift', () => {
    // y that maps to 3.333... mm -> rounded to 3.33
    const y = 3.333333 * 2 + 50;
    expect(positionForPoint('horizontal', CAM, { x: 0, y })).toBe(3.33);
  });
});

describe('guideAtPoint', () => {
  it('grabs a horizontal guide when the pointer is within tolerance of its line', () => {
    const g = h(10);
    const y = guideScreenCoord(g, CAM);
    expect(guideAtPoint([g], CAM, { x: 500, y: y + 3 }, 5)).toBe(g);
  });
  it('returns null when the pointer is beyond tolerance', () => {
    const g = h(10);
    const y = guideScreenCoord(g, CAM);
    expect(guideAtPoint([g], CAM, { x: 500, y: y + 8 }, 5)).toBeNull();
  });
  it('only matches on the axis perpendicular to the line (vertical uses x)', () => {
    const g = v(10);
    const x = guideScreenCoord(g, CAM);
    // far off in y should not matter for a vertical guide
    expect(guideAtPoint([g], CAM, { x: x + 2, y: 9999 }, 5)).toBe(g);
  });
  it('never grabs a hidden guide', () => {
    const g = h(10, { hidden: true });
    const y = guideScreenCoord(g, CAM);
    expect(guideAtPoint([g], CAM, { x: 0, y }, 5)).toBeNull();
  });
  it('picks the nearest guide when several are in range', () => {
    const near = h(10);
    const far = h(10.4);
    const yNear = guideScreenCoord(near, CAM);
    expect(guideAtPoint([far, near], CAM, { x: 0, y: yNear }, 20)).toBe(near);
  });
});

describe('mutations', () => {
  it('createGuide mints an id and carries orientation + position', () => {
    const g = createGuide('vertical', 12);
    expect(g.orientation).toBe('vertical');
    expect(g.position).toBe(12);
    expect(g.id).toMatch(/^guide-/);
    expect(g.hidden).toBeUndefined();
  });

  it('addGuide appends without mutating the source doc or guides array', () => {
    const doc = baseDoc([h(5)]);
    const next = addGuide(doc, createGuide('vertical', 8));
    expect(next.guides).toHaveLength(2);
    expect(doc.guides).toHaveLength(1); // original untouched
    expect(next.guides).not.toBe(doc.guides);
  });

  it('updateGuidePosition changes only the target guide', () => {
    const doc = baseDoc([h(5), v(8)]);
    const next = updateGuidePosition(doc, 'v-8', 12);
    expect(next.guides.find((g) => g.id === 'v-8')?.position).toBe(12);
    expect(next.guides.find((g) => g.id === 'h-5')?.position).toBe(5);
    expect(doc.guides.find((g) => g.id === 'v-8')?.position).toBe(8); // immutable
  });

  it('removeGuide drops the target and leaves the rest', () => {
    const doc = baseDoc([h(5), v(8)]);
    const next = removeGuide(doc, 'h-5');
    expect(next.guides).toHaveLength(1);
    expect(next.guides[0].id).toBe('v-8');
  });

  it('mutations never touch doc.layers (guides are not layers)', () => {
    const doc = baseDoc([h(5)]);
    expect(addGuide(doc, createGuide('vertical', 1)).layers).toBe(doc.layers);
    expect(removeGuide(doc, 'h-5').layers).toBe(doc.layers);
  });
});
