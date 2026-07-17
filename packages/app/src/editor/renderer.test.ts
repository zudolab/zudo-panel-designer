// Selection-chrome bounds (#45). selectionBboxes is the pure set the chrome
// pass strokes (one dashed box per selected layer) and the combined bbox unions
// over. Text is deliberately excluded here — it needs Canvas metrics
// (measureTextBbox), which jsdom/node lack; shapes and paths cover the rule.
import { describe, expect, it } from 'vitest';
import { mergeBboxes, type Layer, type ShapeLayer } from '@zpd/core';
import { selectionBboxes } from './renderer';
import type { PanelDims } from './types';

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function shape(id: string, x: number, y: number, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', x, y, width: 10, height: 10, color: 1, ...extra };
}

describe('selectionBboxes', () => {
  it('returns one axis-aligned bbox per selected layer, in selection order', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20), shape('c', 40, 40)];
    const boxes = selectionBboxes(layers, ['a', 'c'], PANEL);
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 40, y: 40, width: 10, height: 10 },
    ]);
  });

  it('skips hidden layers so their chrome vanishes with the layer paint', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 20, 20, { hidden: true })];
    expect(selectionBboxes(layers, ['a', 'b'], PANEL)).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('drops ids absent from the doc (stale after delete/undo)', () => {
    const layers: Layer[] = [shape('a', 0, 0)];
    expect(selectionBboxes(layers, ['a', 'ghost'], PANEL)).toHaveLength(1);
  });

  it('expands a rotated shape to its rotated AABB, not its raw rect', () => {
    // 90° rotation of a 10×10 square about its own center is bounds-identical,
    // so use a non-square to prove the AABB widened.
    const layers: Layer[] = [shape('r', 0, 0, { width: 20, height: 10, rotation: 90 })];
    const [box] = selectionBboxes(layers, ['r'], PANEL);
    expect(box.width).toBeCloseTo(10);
    expect(box.height).toBeCloseTo(20);
  });

  it('the combined bbox (mergeBboxes) encloses every selected layer', () => {
    const layers: Layer[] = [shape('a', 0, 0), shape('b', 40, 30)];
    const combined = mergeBboxes(selectionBboxes(layers, ['a', 'b'], PANEL));
    expect(combined).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });
});
