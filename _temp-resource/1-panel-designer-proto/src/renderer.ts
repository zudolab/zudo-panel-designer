// Canvas-2D full-repaint renderer. Layers draw in mm space via a single
// setTransform (camera pxPerMm scale + panel offset); px exists only here.
import type { Camera } from './camera';
import { PALETTE } from './palette';
import { buildPath2D, pathBbox, type Bbox } from './path-geometry';
import { patternByName, type PanelPatternGenerator } from './patterns';
import type { DocState, Layer, PathPoint } from './types';

export interface RenderExtras {
  selectedId: string | null;
  penDraft: { points: PathPoint[]; mouse: { x: number; y: number } | null } | null;
  images: Map<string, HTMLImageElement>;
  showNodes: boolean; // draw path anchors/handles for the selected path layer
}

export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLE_IDS)[number];

export function measureTextBbox(layer: {
  content: string;
  fontFamily: string;
  sizeMm: number;
  x: number;
  y: number;
}): Bbox {
  const ctx = getMeasureCtx();
  // 1 canvas px == 1 mm here: font size set directly in mm units
  ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
  const lines = layer.content.split('\n');
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width);
  }
  const lineHeight = layer.sizeMm * 1.25;
  return { x: layer.x, y: layer.y, width, height: lineHeight * lines.length };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) throw new Error('2d context unavailable');
  }
  return measureCtx;
}

export function layerBbox(layer: Layer, panelWmm: number, panelHmm: number): Bbox | null {
  switch (layer.type) {
    case 'shape':
    case 'image':
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    case 'text':
      return measureTextBbox(layer);
    case 'path':
      return pathBbox(layer.points, layer.extraSubpaths);
    case 'pattern':
      return { x: 0, y: 0, width: panelWmm, height: panelHmm };
  }
}

export function rotatedAabb(bbox: Bbox, rotation: number | undefined): Bbox {
  if (!rotation) return bbox;
  const rad = (rotation * Math.PI) / 180;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ].map((c) => {
    const dx = c.x - cx;
    const dy = c.y - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  });
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  panelWmm: number,
  panelHmm: number,
  images: Map<string, HTMLImageElement>,
): void {
  ctx.save();
  if ((layer.type === 'shape' || layer.type === 'text') && layer.rotation) {
    const bbox = layerBbox(layer, panelWmm, panelHmm);
    if (bbox) {
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((layer.rotation * Math.PI) / 180);
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
        ctx.ellipse(
          layer.x + layer.width / 2,
          layer.y + layer.height / 2,
          layer.width / 2,
          layer.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      }
      ctx.fill();
      break;
    }
    case 'pattern': {
      const gen: PanelPatternGenerator = patternByName(layer.patternType);
      gen.draw(ctx, {
        widthMm: panelWmm,
        heightMm: panelHmm,
        color: PALETTE[layer.color].hex,
        params: layer.params,
      });
      break;
    }
    case 'path': {
      const path = buildPath2D(layer.points, layer.closed, layer.extraSubpaths);
      if (layer.fill !== null && layer.closed) {
        ctx.fillStyle = PALETTE[layer.fill].hex;
        ctx.fill(path, 'evenodd'); // holes/islands from tracing stay holes
      }
      if (layer.stroke !== null && layer.strokeWidth > 0) {
        ctx.strokeStyle = PALETTE[layer.stroke].hex;
        ctx.lineWidth = layer.strokeWidth;
        ctx.stroke(path);
      }
      break;
    }
    case 'text': {
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
  doc: DocState,
  panelWmm: number,
  panelHmm: number,
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

  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, cssW, cssH);

  const panelPxW = panelWmm * cam.pxPerMm;
  const panelPxH = panelHmm * cam.pxPerMm;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = PALETTE[0].hex; // soldermask base
  ctx.fillRect(cam.offsetX, cam.offsetY, panelPxW, panelPxH);
  ctx.restore();

  // layers, clipped to panel, drawn in mm space
  ctx.save();
  ctx.beginPath();
  ctx.rect(cam.offsetX, cam.offsetY, panelPxW, panelPxH);
  ctx.clip();
  ctx.translate(cam.offsetX, cam.offsetY);
  ctx.scale(cam.pxPerMm, cam.pxPerMm);
  for (const layer of doc.layers) {
    if (layer.hidden) continue;
    drawLayer(ctx, layer, panelWmm, panelHmm, extras.images);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.offsetX + 0.5, cam.offsetY + 0.5, panelPxW - 1, panelPxH - 1);

  drawSelectionChrome(ctx, doc, panelWmm, panelHmm, cam, extras);
  drawPenDraft(ctx, cam, extras);
}

export function resizeHandleRects(
  bbox: Bbox,
  cam: Camera,
): { id: HandleId; x: number; y: number; size: number }[] {
  const size = 8;
  const x0 = bbox.x * cam.pxPerMm + cam.offsetX;
  const y0 = bbox.y * cam.pxPerMm + cam.offsetY;
  const x1 = (bbox.x + bbox.width) * cam.pxPerMm + cam.offsetX;
  const y1 = (bbox.y + bbox.height) * cam.pxPerMm + cam.offsetY;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const at = (id: HandleId, x: number, y: number) => ({ id, x: x - size / 2, y: y - size / 2, size });
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

function drawSelectionChrome(
  ctx: CanvasRenderingContext2D,
  doc: DocState,
  panelWmm: number,
  panelHmm: number,
  cam: Camera,
  extras: RenderExtras,
): void {
  const selected = doc.layers.find((l) => l.id === extras.selectedId);
  if (!selected) return;
  const rawBbox = layerBbox(selected, panelWmm, panelHmm);
  if (!rawBbox) return;
  const rotation = selected.type === 'shape' || selected.type === 'text' ? selected.rotation : 0;
  const bbox = rotatedAabb(rawBbox, rotation);

  ctx.save();
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(
    bbox.x * cam.pxPerMm + cam.offsetX,
    bbox.y * cam.pxPerMm + cam.offsetY,
    bbox.width * cam.pxPerMm,
    bbox.height * cam.pxPerMm,
  );
  ctx.setLineDash([]);

  const resizable =
    (selected.type === 'shape' || selected.type === 'image') && !rotation;
  if (resizable) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1;
    for (const h of resizeHandleRects(bbox, cam)) {
      ctx.fillRect(h.x, h.y, h.size, h.size);
      ctx.strokeRect(h.x, h.y, h.size, h.size);
    }
  }

  if (selected.type === 'path' && extras.showNodes) {
    for (const p of selected.points) {
      for (const [handle, mark] of [
        [p.hin, 'hin'],
        [p.hout, 'hout'],
      ] as const) {
        void mark;
        if (!handle) continue;
        const hp = { x: handle.x * cam.pxPerMm + cam.offsetX, y: handle.y * cam.pxPerMm + cam.offsetY };
        const ap = { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
        ctx.strokeStyle = 'rgba(77,163,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(hp.x, hp.y);
        ctx.stroke();
        ctx.fillStyle = '#4da3ff';
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of selected.points) {
      const ap = { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
      ctx.strokeRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
    }
  }
  ctx.restore();
}

function drawPenDraft(ctx: CanvasRenderingContext2D, cam: Camera, extras: RenderExtras): void {
  const draft = extras.penDraft;
  if (!draft || draft.points.length === 0) return;
  ctx.save();
  ctx.translate(cam.offsetX, cam.offsetY);
  ctx.scale(cam.pxPerMm, cam.pxPerMm);
  const path = buildPath2D(draft.points, false);
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.5 / cam.pxPerMm;
  ctx.stroke(path);
  if (draft.mouse) {
    const last = draft.points[draft.points.length - 1];
    ctx.setLineDash([4 / cam.pxPerMm, 3 / cam.pxPerMm]);
    ctx.beginPath();
    const c1 = last.hout ?? { x: last.x, y: last.y };
    ctx.moveTo(last.x, last.y);
    ctx.bezierCurveTo(c1.x, c1.y, draft.mouse.x, draft.mouse.y, draft.mouse.x, draft.mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // anchor markers in screen space
  ctx.save();
  draft.points.forEach((p, i) => {
    const ap = { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
    ctx.fillStyle = i === 0 ? '#ffd75e' : '#ffffff';
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
    ctx.strokeRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
  });
  ctx.restore();
}

export function renderPatternThumb(
  canvas: HTMLCanvasElement,
  gen: PanelPatternGenerator,
  sizePx: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = sizePx * dpr;
  canvas.height = sizePx * dpr;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  const spanMm = 30; // thumbnail shows a 30mm square of the pattern
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale((sizePx * dpr) / spanMm, (sizePx * dpr) / spanMm);
  ctx.fillStyle = PALETTE[0].hex;
  ctx.fillRect(0, 0, spanMm, spanMm);
  const params = Object.fromEntries(gen.paramDefs.map((d) => [d.key, d.defaultValue]));
  gen.draw(ctx, { widthMm: spanMm, heightMm: spanMm, color: PALETTE[1].hex, params });
}
