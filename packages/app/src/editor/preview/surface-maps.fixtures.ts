import { createPcbLayerStack, type DocState } from '@zpd/core';

// Compact manufacturing corpus: every entry exercises a surface-map rule,
// while the first three rectangles form stable interior sampling points away
// from antialiased edges (gold-only, black-over-gold, white-over-black).
export function representativeSurfaceMapDoc(): DocState {
  return {
    panelHp: 8,
    guides: [{ id: 'guide-design-only', orientation: 'horizontal', position: 64 }],
    layers: createPcbLayerStack({
      copper: [
        {
          id: 'gold-base',
          name: 'Gold base',
          type: 'shape',
          shape: 'rect',
          x: 2,
          y: 2,
          width: 20,
          height: 20,
          color: 0, // deliberately stale: container membership must win
        },
        {
          id: 'bounded-pattern',
          name: 'Bounded pattern',
          type: 'pattern',
          patternType: 'fixture-grid',
          params: { pitch: 3 },
          color: 2, // deliberately stale
          x: 25,
          y: 30,
          size: 12,
        },
        {
          id: 'copper-reveal-base',
          name: 'Copper under mask opening',
          type: 'shape',
          shape: 'rect',
          x: 2,
          y: 30,
          width: 20,
          height: 20,
          color: 0, // deliberately stale
        },
        {
          id: 'rotated-ellipse',
          name: 'Rotated ellipse',
          type: 'shape',
          shape: 'ellipse',
          x: 25,
          y: 52,
          width: 10,
          height: 6,
          rotation: 45,
          color: 0, // deliberately stale
        },
        {
          id: 'partly-off-panel',
          name: 'Partly off panel',
          type: 'shape',
          shape: 'rect',
          x: -8,
          y: 105,
          width: 12,
          height: 30,
          color: 2, // deliberately stale
        },
        {
          id: 'hidden-gold',
          name: 'Hidden gold',
          type: 'shape',
          shape: 'rect',
          x: 10,
          y: 110,
          width: 3,
          height: 3,
          color: 0, // deliberately stale
          hidden: true,
        },
        {
          id: 'design-image',
          name: 'Design-only raster',
          type: 'image',
          src: 'data:image/png;base64,fixture',
          x: 20,
          y: 90,
          width: 8,
          height: 8,
        },
      ],
      'solder-mask': [
        {
          id: 'black-over-gold',
          name: 'Black over gold',
          type: 'shape',
          shape: 'rect',
          x: 8,
          y: 8,
          width: 12,
          height: 12,
          color: 2, // deliberately stale
        },
        {
          id: 'mask-opening',
          name: 'Positive mask with copper reveal',
          type: 'path',
          points: [
            { x: 2, y: 30 },
            { x: 22, y: 30 },
            { x: 22, y: 50 },
            { x: 2, y: 50 },
          ],
          extraSubpaths: [
            [
              { x: 8, y: 36 },
              { x: 16, y: 36 },
              { x: 16, y: 44 },
              { x: 8, y: 44 },
            ],
          ],
          closed: true,
          fill: 2, // deliberately stale
          stroke: 1, // deliberately stale
          strokeWidth: 0.8,
        },
      ],
      silkscreen: [
        {
          id: 'white-over-black',
          name: 'White over black',
          type: 'shape',
          shape: 'rect',
          x: 12,
          y: 12,
          width: 4,
          height: 4,
          color: 0, // deliberately stale
        },
        {
          id: 'rotated-text',
          name: 'Rotated text',
          type: 'text',
          content: 'PCB\nGOLD',
          fontFamily: 'Fixture Sans',
          sizeMm: 6,
          x: 4,
          y: 70,
          rotation: 30,
          color: 0, // deliberately stale
        },
      ],
    }),
  };
}
