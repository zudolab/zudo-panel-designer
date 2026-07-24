import { describe, expect, it } from 'vitest';
import { createDemoDoc } from './demo-doc';

describe('createDemoDoc fixed PCB stack', () => {
  it('keeps demo content inside canonical material containers', () => {
    const doc = createDemoDoc();
    expect(doc.layers.map((container) => container.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
    ]);
    expect(doc.layers[0].children.map((node) => node.id)).toEqual([
      'layer-default-dot-grid',
      'demo-ellipse',
      'demo-path',
      'demo-image',
    ]);
    expect(doc.layers[1].children.map((node) => node.id)).toEqual(['demo-mask-opening']);
    expect(doc.layers[2].children.map((node) => node.id)).toEqual(['demo-rect', 'demo-text']);
  });

  it('positions the mask opening over the copper ellipse so the demo shows copper through a mask opening', () => {
    const doc = createDemoDoc();
    const copperEllipse = doc.layers[0].children.find((node) => node.id === 'demo-ellipse') as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const maskOpening = doc.layers[1].children[0] as {
      id: string;
      color: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

    expect(maskOpening.color).toBe(0); // black routes to solder-mask container
    // The opening's bbox sits fully within the copper ellipse's bbox.
    expect(maskOpening.x).toBeGreaterThanOrEqual(copperEllipse.x);
    expect(maskOpening.y).toBeGreaterThanOrEqual(copperEllipse.y);
    expect(maskOpening.x + maskOpening.width).toBeLessThanOrEqual(
      copperEllipse.x + copperEllipse.width,
    );
    expect(maskOpening.y + maskOpening.height).toBeLessThanOrEqual(
      copperEllipse.y + copperEllipse.height,
    );
  });
});
