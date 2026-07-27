import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import { mapPcbLeavesById } from './group-ops';
import { createPcbLayerStack } from './palette';
import { stackForSide, withStackForSide } from './panel-side';
import type { Layer, ShapeLayer } from './types';

const SHAPE: ShapeLayer = {
  id: 'shape-1',
  name: 'Shape',
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  color: 1,
};

describe('stackForSide', () => {
  it('front reads doc.layers, back reads doc.backLayers (same references)', () => {
    const doc = createDefaultDoc();
    expect(stackForSide(doc, 'front')).toBe(doc.layers);
    expect(stackForSide(doc, 'back')).toBe(doc.backLayers);
  });
});

describe('withStackForSide', () => {
  it('round-trips the front side, leaving the back stack and other fields untouched', () => {
    const doc = createDefaultDoc();
    const nextStack = createPcbLayerStack({ copper: [SHAPE] });
    const next = withStackForSide(doc, 'front', nextStack);
    expect(stackForSide(next, 'front')).toBe(nextStack);
    expect(next.layers).toBe(nextStack);
    expect(next.backLayers).toBe(doc.backLayers);
    expect(next.guides).toBe(doc.guides);
    expect(next.panelHp).toBe(doc.panelHp);
    expect(next.format).toBe(doc.format);
    expect(next.material).toBe(doc.material);
  });

  it('round-trips the back side, leaving the front stack untouched', () => {
    const doc = createDefaultDoc();
    const nextStack = createPcbLayerStack('back', { silkscreen: [SHAPE] });
    const next = withStackForSide(doc, 'back', nextStack);
    expect(stackForSide(next, 'back')).toBe(nextStack);
    expect(next.backLayers).toBe(nextStack);
    expect(next.layers).toBe(doc.layers);
  });

  it('returns the SAME doc reference when the stack is already current (identity no-op)', () => {
    const doc = createDefaultDoc();
    expect(withStackForSide(doc, 'front', doc.layers)).toBe(doc);
    expect(withStackForSide(doc, 'back', doc.backLayers)).toBe(doc);
  });

  it('composes a no-op stack op into a no-op doc op (identity chains through)', () => {
    const doc = createDefaultDoc();
    // mapPcbLeavesById with no ids returns the same stack reference, so the
    // whole read-op-write chain must return the same doc reference.
    const side = 'back';
    const next = withStackForSide(
      doc,
      side,
      mapPcbLeavesById(stackForSide(doc, side), [], (leaf: Layer) => leaf),
    );
    expect(next).toBe(doc);
  });
});
