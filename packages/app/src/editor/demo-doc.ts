// Dev/demo document: createDefaultDoc(12) plus one layer of every type, so the
// shell exercises the whole renderer + inspector registry on first load. The
// image src is a tiny inline SVG (no network, works offline and in tests).
import { createDefaultDoc, type DocState } from '@zpd/core';

const DEMO_IMAGE_SRC =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">' +
      '<rect width="120" height="80" fill="#333"/>' +
      '<circle cx="60" cy="40" r="28" fill="#d4af37"/>' +
      '<text x="60" y="46" font-size="14" fill="#151515" text-anchor="middle">img</text>' +
      '</svg>',
  );

export function createDemoDoc(hp = 12): DocState {
  const base = createDefaultDoc(hp);
  return {
    panelHp: hp,
    guides: base.guides,
    layers: [
      ...base.layers, // the default dot-grid pattern
      {
        id: 'demo-rect',
        name: 'Rect',
        type: 'shape',
        shape: 'rect',
        x: 8,
        y: 14,
        width: 24,
        height: 16,
        color: 2,
      },
      {
        id: 'demo-ellipse',
        name: 'Ellipse',
        type: 'shape',
        shape: 'ellipse',
        x: 30,
        y: 40,
        width: 22,
        height: 22,
        color: 1,
      },
      {
        id: 'demo-path',
        name: 'Path',
        type: 'path',
        points: [
          { x: 10, y: 72 },
          { x: 30, y: 62, hin: { x: 22, y: 70 }, hout: { x: 38, y: 54 } },
          { x: 50, y: 74 },
        ],
        closed: false,
        fill: null,
        stroke: 1,
        strokeWidth: 0.8,
      },
      {
        id: 'demo-text',
        name: 'Text',
        type: 'text',
        content: 'ZPD',
        fontFamily: 'sans-serif',
        sizeMm: 9,
        x: 8,
        y: 90,
        color: 2,
      },
      {
        id: 'demo-image',
        name: 'Reference image',
        type: 'image',
        src: DEMO_IMAGE_SRC,
        x: 12,
        y: 104,
        width: 30,
        height: 20,
      },
    ],
  };
}
