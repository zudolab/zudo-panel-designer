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
    expect(doc.layers[1].children).toEqual([]);
    expect(doc.layers[2].children.map((node) => node.id)).toEqual(['demo-rect', 'demo-text']);
  });
});
