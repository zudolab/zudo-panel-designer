// Canvas-2D full-repaint renderer. Every frame redraws the whole scene; layers
// draw in mm space via a single setTransform (dpr * pxPerMm scale + panel
// offset) so px only exists at this boundary. Ported from the working proto
// (_temp-resource/1-panel-designer-proto/src/renderer.ts) onto the real
// @zpd/core + @zpd/patterns APIs.
import {
  buildPath2D,
  MAX_PATTERN_SIZE_MM,
  mergeBboxes,
  normalizeRect,
  PALETTE,
  pathBbox,
  rectCenter,
  rectCorners,
  rotatedRectAABB,
  type Guide,
  type Layer,
  type Pt,
  type Rect,
  type ResizeHandle,
} from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import type { Camera } from './camera';
import { ensureFont, isFontLoaded, isFontLoading } from './fonts';
import { guideScreenCoord, type GuideDraft } from './guides';
import { outsidePanelRegion } from './outside-panel-region';
import type { DraftRenderContext, PanelDims } from './types';

const WORKSPACE_BG = '#26282c';
const SELECT_COLOR = '#4da3ff';
const HANDLE_SIZE = 8;
// Dimmed, not full opacity: in zpd the area beyond the panel edge is
// physically cut off in fabrication, so dimming encodes "this will not be
// manufactured" — don't "correct" this into full opacity later (issue #43).
const OUTSIDE_GHOST_ALPHA = 0.35;
// A text layer whose Google Font is still in flight paints at reduced
// opacity so the immediate fallback-face glyphs read as provisional (#67).
const LOADING_FONT_ALPHA = 0.3;

export interface RenderExtras {
  // Multi-select contract (#44): the full (normalized) selection. The chrome
  // pass draws a dashed bbox per selected layer plus a combined bbox when >1;
  // resize handles / path nodes render only when exactly one is selected (#45).
  selectedIds: readonly string[];
  images: Map<string, HTMLImageElement>;
  showNodes: boolean; // draw path anchors/handles for the selected path layer
  showOutsidePanel: boolean; // ghost-paint off-panel layer content (issue #43)
  // View furniture guides (#54). Committed guides to paint as thin lines; the
  // master "Show guides" toggle is applied by the caller (it passes [] when
  // off). `guideDraft` is the live ruler-drag preview, or null when idle.
  guides?: readonly Guide[];
  guideDraft?: GuideDraft | null;
  // The active tool's draft preview hook (pen path, marquee, …). Drawn last,
  // unclipped, on top of the selection chrome.
  renderDraft?: (draft: DraftRenderContext) => void;
  // Fired once a text layer's still-loading font resolves, so the fallback
  // face drawn this frame gets replaced by the real glyphs on repaint (#67).
  requestRepaint: () => void;
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

// Layer bbox in mm (pre-rotation). Pattern layers are bbox-bound since #96:
// their bounds are the layer's own x/y/size square, not the panel rect, so no
// layer type needs the panel dims here anymore.
//
// CANONICAL BOUNDS (#45): this app-side function is the ONE source of layer
// bounds for selection chrome AND the marquee (#47) — both MUST read it so a
// text layer's chrome and marquee-hit agree to the pixel. It uses real Canvas
// text metrics (measureTextBbox). Core's estimateTextBbox in hit-test.ts is a
// rough character-count fallback that exists only because @zpd/core is
// dependency-free with no Canvas in Node; it is a Node-side hit-test fallback,
// NOT a bounds source for anything the user sees. Do not re-point chrome/marquee
// at core's estimate — they would visibly disagree for text.
export function layerBbox(layer: Layer): Rect | null {
  switch (layer.type) {
    case 'shape':
    case 'image':
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    case 'text':
      return measureTextBbox(layer);
    case 'path':
      return pathBbox(layer.points, layer.extraSubpaths);
    case 'pattern':
      return { x: layer.x, y: layer.y, width: layer.size, height: layer.size };
  }
}

export function layerRotation(layer: Layer): number {
  return layer.type === 'shape' || layer.type === 'text' ? (layer.rotation ?? 0) : 0;
}

// Rotate-handle eligibility (#51): exactly the types whose `rotation` field
// layerRotation reads. path/image/pattern have no rotation in the model — the
// chrome must not invent one for them.
export function canRotate(layer: Layer): boolean {
  return layer.type === 'shape' || layer.type === 'text';
}

// Rotate a point about a center, degrees clockwise (same convention as
// bbox.ts). rotationDeg 0 is an exact pass-through so unrotated geometry stays
// bit-identical to the pre-#51 axis-aligned math.
function rotateMmPoint(pt: Pt, center: Pt, rotationDeg: number): Pt {
  if (!rotationDeg) return pt;
  const rad = (rotationDeg * Math.PI) / 180;
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function mmToScreen(p: Pt, cam: Camera): Pt {
  return { x: p.x * cam.pxPerMm + cam.offsetX, y: p.y * cam.pxPerMm + cam.offsetY };
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

// Multi-resize (#52): a multi-selection's combined bbox wears CORNER handles
// only. Uniform scale is the only group transform the model can express
// (core scale.ts — non-uniform scale of a rotated member would need a shear),
// so edge handles, which promise a one-axis stretch, are deliberately NOT
// offered for a multi-selection.
export const CORNER_HANDLE_IDS: readonly ResizeHandle[] = ['nw', 'ne', 'se', 'sw'];

export interface HandleRect {
  id: ResizeHandle;
  x: number;
  y: number;
  size: number;
}

// 8 resize handles in SCREEN px for an mm bbox (chrome lives in screen space).
// `bbox` is the RAW (pre-rotation) rect; a non-zero rotationDeg (#51) places
// each handle at the ROTATED corner/edge-midpoint so the handles ride the
// oriented chrome. The squares themselves stay screen-axis-aligned — grab
// hit-testing stays a plain point-in-rect check.
export function resizeHandleRects(bbox: Rect, cam: Camera, rotationDeg = 0): HandleRect[] {
  const x0 = bbox.x;
  const y0 = bbox.y;
  const x1 = bbox.x + bbox.width;
  const y1 = bbox.y + bbox.height;
  const xm = x0 + bbox.width / 2;
  const ym = y0 + bbox.height / 2;
  const center = rectCenter(bbox);
  const at = (id: ResizeHandle, x: number, y: number): HandleRect => {
    const p = mmToScreen(rotateMmPoint({ x, y }, center, rotationDeg), cam);
    return { id, x: p.x - HANDLE_SIZE / 2, y: p.y - HANDLE_SIZE / 2, size: HANDLE_SIZE };
  };
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

// The 4 corner handles of an (axis-aligned) bbox — the multi-resize
// affordance (#52). Same squares/screen-space contract as resizeHandleRects.
export function cornerHandleRects(bbox: Rect, cam: Camera): HandleRect[] {
  return resizeHandleRects(bbox, cam).filter((h) => CORNER_HANDLE_IDS.includes(h.id));
}

// Whether core's scaleLayer can change this layer at all (#52): patterns pass
// through scaleLayer unchanged (they carry an x/y/size square since #96, but
// pattern scaling stays excluded until the interaction sub — this gate is
// deliberately unchanged), and a path with no points anywhere (the parser
// accepts them; pathBbox gives it a 0×0 box, not null) has no coordinates to
// scale.
function layerCanScale(layer: Layer): boolean {
  switch (layer.type) {
    case 'pattern':
      return false;
    case 'path':
      return (
        layer.points.length > 0 || (layer.extraSubpaths?.some((s) => s.length > 0) ?? false)
      );
    default:
      return true;
  }
}

// The combined bbox that offers multi-resize corner handles, or null when the
// selection doesn't qualify (#52). Gates BOTH the chrome pass and the select
// tool's handle grab — the one source of eligibility, so what is drawn is
// exactly what is grabbable. Qualification: >1 visible selection bboxes (the
// same set the combined-bbox chrome unions over) AND at least one visible
// member scaleLayer can actually change — otherwise the handles would promise
// a gesture that cannot affect the doc (and would write a phantom undo entry).
export function multiResizeBbox(
  layers: readonly Layer[],
  selectedIds: readonly string[],
): Rect | null {
  if (selectedIds.length < 2) return null;
  const boxes = selectionBboxes(layers, selectedIds);
  if (boxes.length < 2) return null;
  const scalable = layers.some(
    (l) => selectedIds.includes(l.id) && !l.hidden && layerCanScale(l),
  );
  return scalable ? mergeBboxes(boxes) : null;
}

// The rotate handle floats a fixed SCREEN distance beyond the top-edge
// midpoint, along the layer's rotated "up" direction, so it tracks the
// oriented chrome at any rotation and stays the same size at any zoom.
export const ROTATE_HANDLE_OFFSET_PX = 20;
const ROTATE_HANDLE_RADIUS_PX = 5;

export function rotateHandleScreenPos(bbox: Rect, rotationDeg: number, cam: Camera): Pt {
  const topMid = mmToScreen(
    rotateMmPoint({ x: bbox.x + bbox.width / 2, y: bbox.y }, rectCenter(bbox), rotationDeg),
    cam,
  );
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    x: topMid.x + Math.sin(rad) * ROTATE_HANDLE_OFFSET_PX,
    y: topMid.y - Math.cos(rad) * ROTATE_HANDLE_OFFSET_PX,
  };
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  images: Map<string, HTMLImageElement>,
  requestRepaint: () => void,
): void {
  ctx.save();
  const rotation = layerRotation(layer);
  if (rotation) {
    const bbox = layerBbox(layer);
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
      // Generators assume a positive draw span and LOOP over all of it (the
      // canvas clip bounds pixels, not JS work) — a malformed or absurd size
      // must never reach draw(). The parse boundary guarantees
      // 0 < size <= MAX_PATTERN_SIZE_MM, but docs are also built in memory
      // by tests/the bridge.
      if (
        gen &&
        Number.isFinite(layer.size) &&
        layer.size > 0 &&
        layer.size <= MAX_PATTERN_SIZE_MM
      ) {
        ctx.save();
        ctx.translate(layer.x, layer.y);
        // The square clip is its OWN clip op so it composes (intersects) with
        // whatever clip the caller holds — main pass: panel ∩ square. Never
        // fold this rect into the ghost pass's even-odd clip path
        // (renderer.ts's outerRect+innerRect trick): an extra rect in that
        // path would flip its even-odd regions, not bound the pattern.
        ctx.beginPath();
        ctx.rect(0, 0, layer.size, layer.size);
        ctx.clip();
        // The generator draws in object-local square space: origin at the
        // square's top-left, span = the square side (see @zpd/patterns
        // types.ts). Generator API unchanged.
        gen.draw(ctx, {
          widthMm: layer.size,
          heightMm: layer.size,
          color: PALETTE[layer.color].hex,
          params: layer.params,
        });
        ctx.restore();
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
      // fire-and-forget, guarded so an already-settled (family, content)
      // pair doesn't re-arm a repaint every single frame (that would loop
      // forever, since this runs on every paint): kicks off the load once
      // per pair, then repaints once it resolves so the fallback face drawn
      // right now gets replaced by the real glyphs (#67). Keyed on content
      // too (not just fontFamily) so a second text layer sharing a Google
      // Font but needing different glyphs (e.g. a CJK subset) still gets
      // its own load attempt instead of being skipped as "already loaded".
      if (!isFontLoaded(layer.fontFamily, layer.content)) {
        ensureFont(layer.fontFamily, layer.content).then(() => requestRepaint());
      }
      ctx.fillStyle = PALETTE[layer.color].hex;
      ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
      ctx.textBaseline = 'top';
      // Multiply into the CALLER's alpha (1 for the normal in-panel pass,
      // OUTSIDE_GHOST_ALPHA for the off-panel ghost pass) rather than
      // overwriting it — otherwise a loading/loaded google font would blow
      // away the ghost dim and always paint at 1 or 0.3 regardless of it.
      const inheritedAlpha = ctx.globalAlpha;
      ctx.globalAlpha = isFontLoading(layer.fontFamily, layer.content)
        ? inheritedAlpha * LOADING_FONT_ALPHA
        : inheritedAlpha;
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

// Evicts cache entries not backed by a same-id, SAME-SRC image layer in
// `layers` (#69). The asset-loading effect that populates this cache only
// ADDS entries keyed by id (`!imagesRef.current.has(layer.id)`), so on a
// whole-document replace a fresh doc that happens to reuse an id — with a
// DIFFERENT src — would otherwise keep painting the stale bitmap forever.
// Typed structurally over `{ src }` (not HTMLImageElement) so this stays
// DOM-free and unit-testable; Editor.tsx's real cache satisfies it as-is.
export function reconcileImageCache(
  cache: Map<string, { src: string }>,
  layers: readonly Layer[],
): void {
  const nextSrcById = new Map<string, string>();
  for (const layer of layers) {
    if (layer.type === 'image') nextSrcById.set(layer.id, layer.src);
  }
  for (const [id, img] of cache) {
    if (nextSrcById.get(id) !== img.src) cache.delete(id);
  }
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
      drawLayer(ctx, layer, extras.images, extras.requestRepaint);
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
    drawLayer(ctx, layer, extras.images, extras.requestRepaint);
  }
  ctx.restore();

  // panel outline
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.offsetX + 0.5, cam.offsetY + 0.5, panelPxW - 1, panelPxH - 1);

  // guides (#54) — thin lines across the whole viewport, above layer content
  // and below the selection chrome/handles.
  drawGuides(ctx, cam, cssW, cssH, extras);

  // selection chrome — UNCLIPPED, in screen space
  drawSelectionChrome(ctx, doc.layers, cam, extras);

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

// Guide furniture colors (#54). A distinct cyan so guides never read as
// selection chrome (blue) or panel outline (white).
const GUIDE_COLOR = '#12b5cb';
const GUIDE_HIDDEN_ALPHA = 0.3; // faint, per the Guide type contract
const GUIDE_DELETE_COLOR = 'rgba(255,90,90,0.85)'; // "will delete on drop"

// One thin, device-pixel-crisp guide line spanning the whole viewport. `coord`
// is the screen px on the line's fixed axis (screen y for horizontal, x for
// vertical). The caller sets stroke style / dash before calling.
function strokeGuideLine(
  ctx: CanvasRenderingContext2D,
  orientation: Guide['orientation'],
  coord: number,
  cssW: number,
  cssH: number,
): void {
  const p = Math.round(coord) + 0.5; // center in a device px for a crisp 1px line
  ctx.beginPath();
  if (orientation === 'horizontal') {
    ctx.moveTo(0, p);
    ctx.lineTo(cssW, p);
  } else {
    ctx.moveTo(p, 0);
    ctx.lineTo(p, cssH);
  }
  ctx.stroke();
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  cssW: number,
  cssH: number,
  extras: RenderExtras,
): void {
  const guides = extras.guides ?? [];
  const draft = extras.guideDraft ?? null;
  if (guides.length === 0 && !draft) return;

  ctx.save();
  ctx.lineWidth = 1;

  // committed guides — the one being moved is drawn from the draft instead.
  for (const guide of guides) {
    if (draft?.movingId === guide.id) continue;
    ctx.strokeStyle = GUIDE_COLOR;
    ctx.globalAlpha = guide.hidden ? GUIDE_HIDDEN_ALPHA : 1;
    ctx.setLineDash(guide.hidden ? [3, 3] : []);
    strokeGuideLine(ctx, guide.orientation, guideScreenCoord(guide, cam), cssW, cssH);
  }

  // live drag preview: a create drag only shows while over the canvas; a move
  // drag off the canvas paints a "will delete" affordance instead.
  if (draft && (draft.overCanvas || draft.movingId !== null)) {
    const coord =
      draft.orientation === 'horizontal'
        ? draft.position * cam.pxPerMm + cam.offsetY
        : draft.position * cam.pxPerMm + cam.offsetX;
    const deleting = draft.movingId !== null && !draft.overCanvas;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = deleting ? GUIDE_DELETE_COLOR : GUIDE_COLOR;
    ctx.setLineDash(deleting ? [4, 4] : []);
    strokeGuideLine(ctx, draft.orientation, coord, cssW, cssH);
  }

  ctx.setLineDash([]);
  ctx.restore();
}

// Axis-aligned selection bboxes (mm) for the chrome pass: one per selected,
// non-hidden layer, in selection order. Hidden layers are skipped — the layer
// paint pass skips them (renderer.ts) so their chrome must vanish too. This is
// also the set the combined bbox unions over. Kept pure + exported so the
// selection-bounds rule is unit-testable without a Canvas.
export function selectionBboxes(
  layers: readonly Layer[],
  selectedIds: readonly string[],
): Rect[] {
  const boxes: Rect[] = [];
  for (const id of selectedIds) {
    const layer = layers.find((l) => l.id === id);
    if (!layer || layer.hidden) continue;
    const raw = layerBbox(layer);
    if (!raw) continue;
    // normalizeRect: a mirrored shape/image (negative width/height) reaches
    // here as a negative-sized rect when unrotated (rotatedRectAABB only
    // normalizes via min/max when it actually rotates). mergeBboxes, the
    // corner handles, and the scale anchor all assume min=origin, so an
    // un-normalized negative box yields a wrong combined outline and anchor.
    boxes.push(normalizeRect(rotatedRectAABB(raw, layerRotation(layer))));
  }
  return boxes;
}

// Hover chrome (#47): a solid 1px outline at reduced alpha — deliberately
// weaker than the dashed selection chrome so it reads as "would select", not
// "is selected". Layer-hover only: the reference implementation's 1.2×
// handle-hover enlargement is a deliberate, recorded exclusion.
const HOVER_COLOR = 'rgba(77,163,255,0.55)';

export function drawHoverOutline(ctx: CanvasRenderingContext2D, rect: Rect, cam: Camera): void {
  ctx.save();
  ctx.strokeStyle = HOVER_COLOR;
  ctx.lineWidth = 1;
  strokeMmRect(ctx, rect, cam);
  ctx.restore();
}

function strokeMmRect(ctx: CanvasRenderingContext2D, rect: Rect, cam: Camera): void {
  ctx.strokeRect(
    rect.x * cam.pxPerMm + cam.offsetX,
    rect.y * cam.pxPerMm + cam.offsetY,
    rect.width * cam.pxPerMm,
    rect.height * cam.pxPerMm,
  );
}

// Oriented chrome outline (#51): the rect's 4 corners rotated about its
// center, stroked as a closed polygon in screen space.
function strokeOrientedMmRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  rotationDeg: number,
  cam: Camera,
): void {
  const center = rectCenter(rect);
  const pts = rectCorners(rect).map((c) => mmToScreen(rotateMmPoint(c, center, rotationDeg), cam));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
}

// White squares with the selection-blue border — the one handle style, shared
// by single-selection resize handles and the multi-selection corners (#52).
function drawHandleSquares(ctx: CanvasRenderingContext2D, rects: readonly HandleRect[]): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1;
  for (const h of rects) {
    ctx.fillRect(h.x, h.y, h.size, h.size);
    ctx.strokeRect(h.x, h.y, h.size, h.size);
  }
}

function drawSelectionChrome(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  cam: Camera,
  extras: RenderExtras,
): void {
  const boxes = selectionBboxes(layers, extras.selectedIds);
  if (boxes.length === 0) return;

  // Handles + rotate affordance + path nodes are single-selection concerns:
  // multi-resize is #52. `selected` is defined iff EXACTLY one layer is
  // selected — and boxes is then non-empty, so the layer is present + visible.
  const selected =
    extras.selectedIds.length === 1
      ? layers.find((l) => l.id === extras.selectedIds[0])
      : undefined;
  const rotation = selected ? layerRotation(selected) : 0;
  // RAW (pre-rotation) bbox: the oriented chrome + handles anchor to it, not
  // to the axis-aligned AABB in `boxes`.
  const rawBbox = selected ? layerBbox(selected) : null;

  ctx.save();
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  if (selected && rotation && rawBbox) {
    // Oriented chrome (#51): a single rotated layer wears the ORIENTED rect
    // outline. The old axis-aligned rotatedRectAABB box would be incoherent
    // against a rotate handle and rotated-corner resize handles.
    strokeOrientedMmRect(ctx, rawBbox, rotation, cam);
  } else {
    // one dashed bbox per selected layer …
    for (const b of boxes) strokeMmRect(ctx, b, cam);
    // … plus the combined bbox that encloses them all when more than one is
    // selected. mergeBboxes is the shared union (#45) — no bespoke union here.
    if (boxes.length > 1) strokeMmRect(ctx, mergeBboxes(boxes), cam);
  }
  ctx.setLineDash([]);

  if (!selected) {
    // Multi-resize affordance (#52): corner handles on the combined bbox.
    // multiResizeBbox is the shared eligibility gate — the select tool grabs
    // exactly the rects drawn here.
    const multiBbox = multiResizeBbox(layers, extras.selectedIds);
    if (multiBbox) drawHandleSquares(ctx, cornerHandleRects(multiBbox, cam));
    ctx.restore();
    return;
  }

  // Resize handles: rotation no longer disqualifies a shape — the handles sit
  // at the rotated corners and the drag resolves via resizeRotatedRect (#48).
  // Type gate only (isResizable was deleted in #48): shape/image are the
  // types with free width/height.
  const resizable = selected.type === 'shape' || selected.type === 'image';
  if (resizable && rawBbox) {
    drawHandleSquares(ctx, resizeHandleRects(rawBbox, cam, rotation));
  }

  // Rotate handle (#51): shape/text only — the types layerRotation reads. A
  // stem connects the rotated top-edge midpoint to a circular knob.
  if (canRotate(selected) && rawBbox) {
    const topMid = mmToScreen(
      rotateMmPoint(
        { x: rawBbox.x + rawBbox.width / 2, y: rawBbox.y },
        rectCenter(rawBbox),
        rotation,
      ),
      cam,
    );
    const knob = rotateHandleScreenPos(rawBbox, rotation, cam);
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(knob.x, knob.y);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, ROTATE_HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
