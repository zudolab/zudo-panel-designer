import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';

describe('createDefaultDoc', () => {
  it('defaults to a 12HP panel with one gold dot-grid pattern layer', () => {
    const doc = createDefaultDoc();
    expect(doc.panelHp).toBe(12);
    expect(doc.layers).toHaveLength(1);
    const [layer] = doc.layers;
    if ('kind' in layer) throw new Error('unreachable');
    expect(layer.type).toBe('pattern');
    if (layer.type !== 'pattern') throw new Error('unreachable');
    expect(layer.patternType).toBe('dot-grid');
    expect(layer.color).toBe(1);
  });

  it('gives the default pattern layer explicit cover geometry via the shared helper (#96)', () => {
    const [layer] = createDefaultDoc().layers;
    if ('kind' in layer || layer.type !== 'pattern') throw new Error('unreachable');
    expect({ x: layer.x, y: layer.y, size: layer.size }).toEqual(
      patternCoverGeometry({ widthMm: panelWidthMm(12), heightMm: PANEL_HEIGHT_MM }),
    );
  });

  it('accepts an explicit HP override and covers that panel size', () => {
    const doc = createDefaultDoc(20);
    expect(doc.panelHp).toBe(20);
    const [layer] = doc.layers;
    if ('kind' in layer || layer.type !== 'pattern') throw new Error('unreachable');
    expect({ x: layer.x, y: layer.y, size: layer.size }).toEqual(
      patternCoverGeometry({ widthMm: panelWidthMm(20), heightMm: PANEL_HEIGHT_MM }),
    );
  });

  it('produces deterministic, stable ids across calls (safe for e2e fixtures)', () => {
    const a = createDefaultDoc();
    const b = createDefaultDoc();
    expect(a.layers[0].id).toBe(b.layers[0].id);
    expect(a).toEqual(b);
  });
});
