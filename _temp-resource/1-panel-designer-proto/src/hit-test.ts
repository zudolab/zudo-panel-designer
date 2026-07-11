// Canvas hit-testing in mm space. Topmost-first; pattern layers are
// panel-wide and only selectable via the layer list.
import { hitTestPath } from './path-geometry';
import { measureTextBbox } from './renderer';
import type { DocState, Layer } from './types';

function pointInRotatedRect(
  mmX: number,
  mmY: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number | undefined,
  ellipse: boolean,
): boolean {
  let px = mmX;
  let py = mmY;
  if (rotation) {
    const rad = (-rotation * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const dx = mmX - cx;
    const dy = mmY - cy;
    px = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    py = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  if (ellipse) {
    const nx = (px - x - w / 2) / (w / 2);
    const ny = (py - y - h / 2) / (h / 2);
    return nx * nx + ny * ny <= 1;
  }
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function hitTestLayer(layer: Layer, mmX: number, mmY: number): boolean {
  switch (layer.type) {
    case 'shape':
      return pointInRotatedRect(
        mmX,
        mmY,
        layer.x,
        layer.y,
        layer.width,
        layer.height,
        layer.rotation,
        layer.shape === 'ellipse',
      );
    case 'image':
      return pointInRotatedRect(mmX, mmY, layer.x, layer.y, layer.width, layer.height, 0, false);
    case 'text': {
      const bbox = measureTextBbox(layer);
      return pointInRotatedRect(
        mmX,
        mmY,
        bbox.x,
        bbox.y,
        bbox.width,
        bbox.height,
        layer.rotation,
        false,
      );
    }
    case 'path':
      return hitTestPath(layer, mmX, mmY);
    case 'pattern':
      return false;
  }
}

export function hitTestDoc(doc: DocState, mmX: number, mmY: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
    const layer = doc.layers[i];
    if (layer.hidden) continue;
    if (hitTestLayer(layer, mmX, mmY)) return layer;
  }
  return null;
}
