import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';

describe('createDefaultDoc', () => {
  it('defaults to a 12HP panel with one gold dot-grid pattern layer', () => {
    const doc = createDefaultDoc();
    expect(doc.panelHp).toBe(12);
    expect(doc.layers).toHaveLength(1);
    const [layer] = doc.layers;
    expect(layer.type).toBe('pattern');
    if (layer.type !== 'pattern') throw new Error('unreachable');
    expect(layer.patternType).toBe('dot-grid');
    expect(layer.color).toBe(1);
  });

  it('accepts an explicit HP override', () => {
    expect(createDefaultDoc(20).panelHp).toBe(20);
  });

  it('produces deterministic, stable ids across calls (safe for e2e fixtures)', () => {
    const a = createDefaultDoc();
    const b = createDefaultDoc();
    expect(a.layers[0].id).toBe(b.layers[0].id);
    expect(a).toEqual(b);
  });
});
