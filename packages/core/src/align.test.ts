import { describe, expect, it } from 'vitest';
import { alignLayers, distributeLayers, type AlignRect } from './align';

const a: AlignRect = { id: 'a', x: 0, y: 0, w: 10, h: 10 };
const b: AlignRect = { id: 'b', x: 30, y: 20, w: 20, h: 5 };
const c: AlignRect = { id: 'c', x: 60, y: 40, w: 5, h: 30 };

const panel = { x: 0, y: 0, width: 100, height: 50 };

function applied(id: string, results: { id: string; dx: number; dy: number }[]) {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}

describe('alignLayers — selection reference', () => {
  it('align-left: moves every rect to the min x of the combined bbox', () => {
    const results = alignLayers([a, b, c], 'left', { mode: 'selection' });
    expect(applied('a', results)).toEqual({ id: 'a', dx: 0, dy: 0 }); // a.x is already the min
    expect(applied('b', results)).toEqual({ id: 'b', dx: -30, dy: 0 });
    expect(applied('c', results)).toEqual({ id: 'c', dx: -60, dy: 0 });
  });

  it('align-right: moves every rect so its right edge hits the combined bbox max', () => {
    // combined bbox right edge = max(0+10, 30+20, 60+5) = 65
    const results = alignLayers([a, b, c], 'right', { mode: 'selection' });
    expect(applied('a', results).dx).toBe(65 - 10 - 0);
    expect(applied('b', results).dx).toBe(65 - 20 - 30);
    expect(applied('c', results).dx).toBe(0); // c is already flush right
  });

  it('align-center-h: centers every rect on the combined bbox horizontal midpoint', () => {
    // combined bbox: minX=0, maxX=65 -> center = 32.5
    const results = alignLayers([a, b], 'center-h', { mode: 'selection' });
    const bounds = { minX: 0, maxX: 50 }; // just a and b: max(0+10,30+20)=50
    const centerX = (bounds.minX + bounds.maxX) / 2;
    expect(applied('a', results).dx).toBe(centerX - a.w / 2 - a.x);
    expect(applied('b', results).dx).toBe(centerX - b.w / 2 - b.x);
  });

  it('align-top / align-middle-v / align-bottom operate on the y axis only', () => {
    const top = alignLayers([a, b, c], 'top', { mode: 'selection' });
    expect(applied('a', top)).toEqual({ id: 'a', dx: 0, dy: 0 });
    expect(applied('b', top).dy).toBe(-20);
    expect(applied('c', top).dy).toBe(-40);

    const bottom = alignLayers([a, b, c], 'bottom', { mode: 'selection' });
    // combined bbox bottom = max(0+10, 20+5, 40+30) = 70
    expect(applied('c', bottom).dy).toBe(0);
    expect(applied('a', bottom).dy).toBe(70 - 10 - 0);

    const middle = alignLayers([a, c], 'middle-v', { mode: 'selection' });
    // a: y 0..10, c: y 40..70 -> combined 0..70, center 35
    expect(applied('a', middle).dy).toBe(35 - 5 - 0);
    expect(applied('c', middle).dy).toBe(35 - 15 - 40);
  });

  it('is a no-op with fewer than 2 rects', () => {
    expect(alignLayers([a], 'left', { mode: 'selection' })).toEqual([]);
    expect(alignLayers([], 'left', { mode: 'selection' })).toEqual([]);
  });
});

describe('alignLayers — panel reference', () => {
  it('works with a single rect', () => {
    const results = alignLayers([a], 'left', { mode: 'panel', panel });
    expect(results).toEqual([{ id: 'a', dx: 0, dy: 0 }]);
  });

  it('align-center-h centers on the panel width', () => {
    const results = alignLayers([a], 'center-h', { mode: 'panel', panel });
    expect(applied('a', results).dx).toBe(100 / 2 - a.w / 2 - a.x);
  });

  it('align-right/align-bottom hit the panel edges', () => {
    const results = alignLayers([a], 'right', { mode: 'panel', panel });
    expect(applied('a', results).dx).toBe(100 - a.w - a.x);
    const bottomResults = alignLayers([a], 'bottom', { mode: 'panel', panel });
    expect(applied('a', bottomResults).dy).toBe(50 - a.h - a.y);
  });

  it('applies independently to every rect (each aligns to the panel, not to each other)', () => {
    const results = alignLayers([a, b], 'left', { mode: 'panel', panel });
    expect(applied('a', results).dx).toBe(panel.x - a.x);
    expect(applied('b', results).dx).toBe(panel.x - b.x);
  });
});

describe('distributeLayers — selection reference', () => {
  const x0 = { id: 'x0', x: 0, y: 0, w: 10, h: 10 };
  const x1 = { id: 'x1', x: 15, y: 0, w: 10, h: 10 };
  const x2 = { id: 'x2', x: 50, y: 0, w: 10, h: 10 };

  it('is a no-op with fewer than 3 rects', () => {
    expect(distributeLayers([a, b], 'horizontal')).toEqual([]);
    expect(distributeLayers([a, b], 'horizontal', { mode: 'selection' })).toEqual([]);
    expect(distributeLayers([], 'horizontal')).toEqual([]);
    expect(distributeLayers([a], 'horizontal')).toEqual([]);
  });

  it('spaces the middle rect(s) with equal gaps, endpoints unmoved', () => {
    // span: 0 .. 60, total width 30 -> gap = (60-0-30)/2 = 15
    const results = distributeLayers([x0, x1, x2], 'horizontal');
    expect(applied('x0', results)).toEqual({ id: 'x0', dx: 0, dy: 0 }); // first anchored
    expect(applied('x2', results)).toEqual({ id: 'x2', dx: 0, dy: 0 }); // last anchored
    // x1 should move to x0.x + x0.w + gap = 0 + 10 + 15 = 25
    expect(applied('x1', results).dx).toBe(25 - x1.x);
  });

  it('defaults to selection when no reference is given', () => {
    const withDefault = distributeLayers([x0, x1, x2], 'horizontal');
    const withExplicit = distributeLayers([x0, x1, x2], 'horizontal', { mode: 'selection' });
    expect(withDefault).toEqual(withExplicit);
  });

  it('distributes on the vertical axis using y/h', () => {
    const y0 = { id: 'y0', x: 0, y: 0, w: 10, h: 10 };
    const y1 = { id: 'y1', x: 0, y: 15, w: 10, h: 10 };
    const y2 = { id: 'y2', x: 0, y: 50, w: 10, h: 10 };
    const results = distributeLayers([y0, y1, y2], 'vertical');
    expect(applied('y0', results).dy).toBe(0);
    expect(applied('y2', results).dy).toBe(0);
    expect(applied('y1', results).dy).toBe(25 - y1.y);
  });

  it('order in the input array does not matter (sorted internally by position)', () => {
    const results = distributeLayers([x2, x0, x1], 'horizontal');
    expect(applied('x1', results).dx).toBe(25 - x1.x);
  });
});

describe('distributeLayers — panel reference', () => {
  it('spaces rects with equal gaps across the full panel span, including before/after', () => {
    const r1 = { id: 'r1', x: 0, y: 0, w: 10, h: 10 };
    const r2 = { id: 'r2', x: 40, y: 0, w: 10, h: 10 };
    // total width 20, 2 rects -> 3 gaps across panel.width=100 -> gap = 80/3
    const gap = (panel.width - 20) / 3;
    const results = distributeLayers([r1, r2], 'horizontal', { mode: 'panel', panel });
    expect(applied('r1', results).dx).toBe(gap - r1.x);
    expect(applied('r2', results).dx).toBe(gap + 10 + gap - r2.x);
  });

  it('works with a single rect (centers it with equal gap on both sides)', () => {
    const r1 = { id: 'r1', x: 0, y: 0, w: 10, h: 10 };
    const gap = (panel.width - 10) / 2;
    const results = distributeLayers([r1], 'horizontal', { mode: 'panel', panel });
    expect(applied('r1', results).dx).toBe(gap - r1.x);
  });
});
