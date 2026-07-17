// Canvas-2D full-repaint renderer. Every frame redraws the whole scene; layers
// draw in mm space via a single setTransform (dpr * pxPerMm scale + panel
// offset) so px only exists at this boundary. Ported from the working proto
// (_temp-resource/1-panel-designer-proto/src/renderer.ts) onto the real
// @zpd/core + @zpd/patterns APIs.
import {
  buildPath2D,
  PALETTE,
  pathBbox,
  rotatedRectAABB,
  type Layer,
  type Pt,
  type Rect,
  type ResizeHandle,
} from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import type { Camera } from './camera';
import { ensureFont } from './fonts';
import { outsidePanelRegion } from './outside-panel-region';
import type { DraftRenderContext, PanelDims } from './types';

const WORKSPACE_BG = '#26282c';
const SELECT_COLOR = '#4da3ff';
const HANDLE_SIZE = 8;
// Dimmed, not full opacity: in zpd the area beyond the panel edge is
// physically cut off in fabrication, so dimming encodes "this will not be
// manufactured" — don't "correct" this into full opacity later (issue #43).
const OUTSIDE_GHOST_ALPHA = 0.35;

export interface RenderExtras {
  // Multi-select contract (#44): the full (normalized) selection. The chrome
  // pass below still renders only the exactly-one case — N-layer chrome is #45.
  selectedIds: readonly string[];
  images: Map<string, HTMLImageElement>;
  showNodes: boolean; // draw path anchors/handles for the selected path layer
  showOutsidePanel: boolean; // ghost-paint off-panel layer content (issue #43)
  // The active tool's draft preview hook (pen path, marquee, …). Drawn last,
  // unclipped, on top of the selection chrome.
  renderDraft?: (draft: DraftRenderContext) => void;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

// Text bbox in mm. 1 canvas px == 1 mm here, so the font size is the mm size.
// 1.25 line height mirrors the render below. Falls back to a rough estimate
// when no 2D context is available (jsdom), which never runs the real paint.
export function measureTextBbox(layer: {
  content: string;
  fontFamily: string;
  sizeMm: number;
  x: number;
  y: number;
}): Rect {
  const lineHeight = layer.sizeMm * 1.25;
  const lines = layer.content.split('\n');
  const ctx = getMeasureCtx();
  let width = 0;
  if (ctx) {
    ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
  } else {
    const longest = Math.max(...lines.map((l) => l.length), 1);
    width = longest * layer.sizeMm * 0.6;
  }
  return { x: layer.x, y: layer.y, width, height: lineHeight * lines.length };
}

// Layer bbox in mm (pre-rotation). Pattern layers cover the whole panel.
export function layerBbox(layer: Layer, panel: PanelDims): Rect | null {
  switch (layer.type) {
    case 'shape':
    case 'image':
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    case 'text':
      return measureTextBbox(layer);
    case 'path':
      return pathBbox(layer.points, layer.extraSubpaths);
    case 'pattern':
      return { x: 0, y: 0, width: panel.widthMm, height: panel.heightMm };
  }
}

export function layerRotation(layer: Layer): number {
  return layer.type === 'shape' || layer.type === 'text' ? (layer.rotation ?? 0) : 0;
}

export const RESIZE_HANDLE_IDS: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

export interface HandleRect {
  id: ResizeHandle;
  x: number;
  y: number;
  size: number;
}

// 8 resize handles in SCREEN px for an mm bbox (chrome lives in screen space).
export function resizeHandleRects(bbox: Rect, cam: Camera): HandleRect[] {
  const x0 = bbox.x * cam.pxPerMm + cam.offsetX;
  const y0 = bbox.y * cam.pxPerMm + cam.offsetY;
  const x1 = (bbox.x + bbox.width) * cam.pxPerMm + cam.offsetX;
  const y1 = (bbox.y + bbox.height) * cam.pxPerMm + cam.offsetY;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const at = (id: ResizeHandle, x: number, y: number): HandleRect => ({
    id,
    x: x - HANDLE_SIZE / 2,
    y: y - HANDLE_SIZE / 2,
    size: HANDLE_SIZE,
  });
  return [
    at('nw', x0, y0),
    at('n', xm, y0),
    at('ne', x1, y0),
    at('e', x1, ym),
    at('se', x1, y1),
    at('s', xm, y1),
    at('sw', x0, y1),
    at('w', x0, ym),
  ];
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  panel: PanelDims,
  images: Map<string, HTMLImageElement>,
): void {
  ctx.save();
  const rotation = layerRotation(layer);
  if (rotation) {
    const bbox = layerBbox(layer, panel);
    if (bbox) {
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
  }
  switch (layer.type) {
    case 'shape': {
      ctx.fillStyle = PALETTE[layer.color].hex;
      ctx.beginPath();
      if (layer.shape === 'rect') {
        ctx.rect(layer.x, layer.y, layer.width, layer.height);
      } else {
        // ctx.ellipse throws IndexSizeError on a negative radius, so normalize:
        // the center (x + w/2) already mirrors for a negative dim like the rect
        // branch does; the radii must be absolute.
        ctx.ellipse(
          layer.x + layer.width / 2,
          layer.y + layer.height / 2,
          Math.abs(layer.width) / 2,
          Math.abs(layer.height) / 2,
          0,
          0,
          Math.PI * 2,
        );
      }
      ctx.fill();
      break;
    }
    case 'pattern': {
      const gen = patternByName(layer.patternType);
      if (gen) {
        gen.draw(ctx, {
          widthMm: panel.widthMm,
          heightMm: panel.heightMm,
          color: PALETTE[layer.color].hex,
          params: layer.params,
        });
      }
      break;
    }
    case 'path': {
      const path = buildPath2D(layer.points, layer.closed, layer.extraSubpaths);
      if (path) {
        if (layer.fill !== null && layer.closed) {
          ctx.fillStyle = PALETTE[layer.fill].hex;
          ctx.fill(path, 'evenodd'); // holes/islands from tracing stay holes
        }
        if (layer.stroke !== null && layer.strokeWidth > 0) {
          ctx.strokeStyle = PALETTE[layer.stroke].hex;
          ctx.lineWidth = layer.strokeWidth;
          ctx.stroke(path);
        }
      }
      break;
    }
    case 'text': {
      ensureFont(layer.fontFamily); // fire-and-forget: kicks off the load so
      // the next repaint (tool/inspector both request one once it resolves)
      // has a shot at the real face instead of the fallback drawn right now
      ctx.fillStyle = PALETTE[layer.color].hex;
      ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
      ctx.textBaseline = 'top';
      const lineHeight = layer.sizeMm * 1.25;
      layer.content.split('\n').forEach((line, i) => {
        ctx.fillText(line, layer.x, layer.y + i * lineHeight);
      });
      break;
    }
    case 'image': {
      const img = images.get(layer.id);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
      } else {
        // placeholder outline until the raster finishes loading
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 0.3;
        ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
      }
      break;
    }
  }
  ctx.restore();
}

export function renderScene(
  canvas: HTMLCanvasElement,
  doc: { layers: Layer[] },
  panel: PanelDims,
  cam: Camera,
  extras: RenderExtras,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  // workspace background
  ctx.fillStyle = WORKSPACE_BG;
  ctx.fillRect(0, 0, cssW, cssH);

  const panelPxW = panel.widthMm * cam.pxPerMm;
  const panelPxH = panel.heightMm * cam.pxPerMm;

  // panel drop shadow + black soldermask base fill
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = PALETTE[0].hex;
  ctx.fillRect(cam.offsetX, cam.offsetY, panelPxW, panelPxH);
  ctx.restore();

  // ghost pass: off-panel layer content at low alpha (issue #43). Runs BEFORE
  // the clipped in-panel pass below, using its own disjoint even-odd clip —
  // see outside-panel-region.ts for which layers are eligible.
  const outsideRegion = outsidePanelRegion(
    extras.showOutsidePanel,
    doc.layers,
    { cssW, cssH },
    cam,
    panel,
  );
  if (outsideRegion) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      outsideRegion.outerRect.x,
      outsideRegion.outerRect.y,
      outsideRegion.outerRect.width,
      outsideRegion.outerRect.height,
    ); // whole viewport
    ctx.rect(
      outsideRegion.innerRect.x,
      outsideRegion.innerRect.y,
      outsideRegion.innerRect.width,
      outsideRegion.innerRect.height,
    ); // minus the panel
    // The even-odd clip is load-bearing, not cosmetic: outerRect + innerRect
    // under 'evenodd' clips to exactly the OUTSIDE region, disjoint from the
    // panel-clipped pass below — every pixel is painted by exactly one pass.
    // A plain full-viewport clip (no innerRect subtraction) would also paint
    // this ghost content UNDER the panel, so any layer with opacity < 1
    // inside the panel would double-composite against its own full-alpha
    // draw — a real Porter-Duff alpha bug hit by a reference implementation
    // of this feature. Do not "simplify" this into a single rect.
    ctx.clip('evenodd');
    ctx.globalAlpha = OUTSIDE_GHOST_ALPHA;
    ctx.translate(cam.offsetX, cam.offsetY);
    ctx.scale(cam.pxPerMm, cam.pxPerMm);
    for (const layer of outsideRegion.ghostLayers) {
      drawLayer(ctx, layer, panel, extras.images);
    }
    ctx.restore();
  }

  // all layers, clipped to the panel, drawn in mm space via one transform
  ctx.save();
  ctx.beginPath();
  ctx.rect(cam.offsetX, cam.offsetY, panelPxW, panelPxH);
  ctx.clip();
  ctx.translate(cam.offsetX, cam.offsetY);
  ctx.scale(cam.pxPerMm, cam.pxPerMm);
  for (const layer of doc.layers) {
    if (layer.hidden) continue;
    drawLayer(ctx, layer, panel, extras.images);
  }
  ctx.restore();

  // panel outline
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.offsetX + 0.5, cam.offsetY + 0.5, panelPxW - 1, panelPxH - 1);

  // selection chrome — UNCLIPPED, in screen space
  drawSelectionChrome(ctx, doc.layers, panel, cam, extras);

  // active tool's draft preview hook (pen path in Wave 5, etc.)
  extras.renderDraft?.(makeDraftContext(ctx, cam, panel));
}

function makeDraftContext(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  panel: PanelDims,
): DraftRenderContext {
  return {
    ctx,
    camera: cam,
    panel,
    toScreen: (mm: Pt) => ({
      x: mm.x * cam.pxPerMm + cam.offsetX,
      y: mm.y * cam.pxPerMm + cam.offsetY,
    }),
    inMmSpace(draw: () => void) {
      ctx.save();
      ctx.translate(cam.offsetX, cam.offsetY);
      ctx.scale(cam.pxPerMm, cam.pxPerMm);
      draw();
      ctx.restore();
    },
  };
}

function drawSelectionChrome(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  panel: PanelDims,
  cam: Camera,
  extras: RenderExtras,
): void {
  // Single-selection chrome only in this wave (#44) — #45 draws N-layer chrome.
  const selectedId = extras.selectedIds.length === 1 ? extras.selectedIds[0] : null;
  const selected = layers.find((l) => l.id === selectedId);
  if (!selected) return;
  if (selected.hidden) return; // the layer pass skips hidden layers — chrome must too
  const rawBbox = layerBbox(selected, panel);
  if (!rawBbox) return;
  const rotation = layerRotation(selected);
  const bbox = rotatedRectAABB(rawBbox, rotation);

  ctx.save();
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(
    bbox.x * cam.pxPerMm + cam.offsetX,
    bbox.y * cam.pxPerMm + cam.offsetY,
    bbox.width * cam.pxPerMm,
    bbox.height * cam.pxPerMm,
  );
  ctx.setLineDash([]);

  // resize handles only when the layer is eligible (not rotated)
  const resizable = (selected.type === 'shape' || selected.type === 'image') && !rotation;
  if (resizable) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1;
    for (const h of resizeHandleRects(bbox, cam)) {
      ctx.fillRect(h.x, h.y, h.size, h.size);
      ctx.strokeRect(h.x, h.y, h.size, h.size);
    }
  }

  // path node anchors + bezier handles when node-editing
  if (selected.type === 'path' && extras.showNodes) {
    for (const p of selected.points) {
      for (const handle of [p.hin, p.hout]) {
        if (!handle) continue;
        const hp = {
          x: handle.x * cam.pxPerMm + cam.offsetX,
          y: handle.y * cam.pxPerMm + cam.offsetY,
        };
        const ap = { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
        ctx.strokeStyle = 'rgba(77,163,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
        ctx.fillStyle = SELECT_COLOR;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of selected.points) {
      const ap = { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = SELECT_COLOR;
      ctx.lineWidth = 1.5;
      ctx.fillRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
      ctx.strokeRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
    }
  }
  ctx.restore();
}
