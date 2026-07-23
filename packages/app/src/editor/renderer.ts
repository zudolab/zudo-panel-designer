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
  rotatableLayer,
  rotatedRectAABB,
  type ColorIndex,
  type Guide,
  type Layer,
  type PcbLayerStack,
  type Pt,
  type Rect,
  type ResizeHandle,
} from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import type { Camera } from './camera';
import { projectFlatLayers } from './flat-projection';
import { guideScreenCoord, type GuideDraft } from './guides';
import { outsidePanelRegion } from './outside-panel-region';
import { getTextGeometry, reconcileTextGeometry } from './text-geometry';
import type { DraftRenderContext, MultiRotateChrome, PanelDims } from './types';

export { measureTextBbox } from './text-geometry';

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
  // Multi-select contract (#44): the full (normalized) selection, EXPANDED to
  // flat leaf ids since #151 (a raw group id matches no flat layer). The
  // chrome pass draws a dashed bbox per selected layer plus a combined bbox
  // when >1; resize handles / path nodes render only for a single selection.
  selectedIds: readonly string[];
  // Whether the SELECTION is a true single-leaf selection (#151). A lone
  // one-child GROUP also expands to exactly one leaf id here, but must get
  // the combined (no single-layer handles) treatment — the select tool
  // offers no grabs for it, so drawing handles would be dead chrome. When
  // absent, derived from selectedIds.length === 1 (pre-#151 behavior, keeps
  // group-free callers/tests bit-identical).
  singleSelection?: boolean;
  images: Map<string, HTMLImageElement>;
  showNodes: boolean; // draw path anchors/handles for the selected path layer
  showOutsidePanel: boolean; // ghost-paint off-panel layer content (issue #43)
  // View furniture guides (#54). Committed guides to paint as thin lines; the
  // master "Show guides" toggle is applied by the caller (it passes [] when
  // off). `guideDraft` is the live ruler-drag preview, or null when idle.
  guides?: readonly Guide[];
  guideDraft?: GuideDraft | null;
  // Live multi/group-rotate gesture (#152), forwarded from the active tool's
  // multiRotateChrome() hook. When set, the combined-selection chrome draws
  // the FROZEN start bounds ctx-rotated by the live delta (plus the delta
  // badge) instead of re-deriving live AABBs, which would pulsate and stay
  // axis-aligned while the leaves visually rotate.
  multiRotate?: MultiRotateChrome | null;
  // The active tool's draft preview hook (pen path, marquee, …). Drawn last,
  // unclipped, on top of the selection chrome.
  renderDraft?: (draft: DraftRenderContext) => void;
  // Fired once a text layer's still-loading font resolves, so the fallback
  // face drawn this frame gets replaced by the real glyphs on repaint (#67).
  requestRepaint: () => void;
}

// Canonical layer painter shared by the interactive editor and derived
// manufacturing surfaces. Geometry stays in one place while each consumer
// supplies the color/material channel it needs. Image layers remain an
// explicit opt-in because raster references are design furniture, not
// manufacturable panel artwork.
export interface LayerPaintOptions {
  readonly colorFor: (color: ColorIndex) => string;
  readonly images?: ReadonlyMap<string, HTMLImageElement>;
  readonly paintMissingImagePlaceholder?: boolean;
  readonly loadingTextAlpha?: number;
}

const editorPaletteColor = (color: ColorIndex): string => PALETTE[color].hex;

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
      return getTextGeometry(layer)?.box ?? null;
    case 'path':
      return pathBbox(layer.points, layer.extraSubpaths);
    case 'pattern':
      return { x: layer.x, y: layer.y, width: layer.size, height: layer.size };
  }
}

export function layerRotation(layer: Layer): number {
  return layer.type === 'shape' || layer.type === 'text' || layer.type === 'image'
    ? (layer.rotation ?? 0)
    : 0;
}

// Rotate-handle eligibility (#51, image joined in #147): exactly the types
// whose `rotation` field layerRotation reads. path/pattern have no rotation in
// the model — the chrome must not invent one for them.
export function canRotate(layer: Layer): boolean {
  return layer.type === 'shape' || layer.type === 'text' || layer.type === 'image';
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
// through scaleLayer unchanged (#97 kept multi-scale pattern-free on purpose;
// single-pattern sizing lives in the inspector — see inspectors/pattern.tsx),
// and a path with no points anywhere (the parser
// accepts them; pathBbox gives it a 0×0 box, not null) has no coordinates to
// scale.
function layerCanScale(layer: Layer): boolean {
  switch (layer.type) {
    case 'pattern':
      return false;
    case 'path':
      return layer.points.length > 0 || (layer.extraSubpaths?.some((s) => s.length > 0) ?? false);
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
  const scalable = layers.some((l) => selectedIds.includes(l.id) && !l.hidden && layerCanScale(l));
  return scalable ? mergeBboxes(boxes) : null;
}

// Whether the rotate BAKE can change this layer at all (#152): patterns pass
// through rotateLayersAboutPivot unchanged (core rotate.ts, the multi-scale
// precedent), and a path with no points anywhere has no geometry to rotate —
// same reasoning as layerCanScale above, kept separate because the two gates
// answer different gestures and must stay free to diverge.
export function layerCanRotateBake(layer: Layer): boolean {
  if (!rotatableLayer(layer)) return false;
  if (layer.type === 'path') {
    return layer.points.length > 0 || (layer.extraSubpaths?.some((s) => s.length > 0) ?? false);
  }
  return true;
}

// The bounds that offer the multi/group ROTATE knob, or null when the
// selection doesn't qualify (#152). Extends the multiResizeBbox shared-gate
// pattern: this ONE function gates BOTH the chrome pass and the select tool's
// knob grab, so what is drawn is exactly what is grabbable. The union spans
// the ROTATABLE, bakeable, MEASURABLE leaves only — the same set
// captureMultiRotateSession freezes — so the idle knob, the grab hit-test,
// the gesture pivot and the mid-gesture chrome all share ONE bounds/pivot
// pair. A knob anchored to the full selection union instead would (a) jump
// to the frozen rotatable-only bounds on the first tick and stop tracking
// the pointer's ray whenever a selected pattern displaces the union, and
// (b) promise a gesture that grabs a null session when the only rotatable
// member is unmeasurable (invalid-size text) or unbakeable (empty path).
// Unlike multiResizeBbox there is deliberately NO ≥2-boxes requirement: a
// one-child group is combined overlay mode with a single leaf and still
// rotates (the caller supplies the combined-mode precondition — the chrome's
// combined branch, and the tool's resolveSelectionOverlayMode check).
export function multiRotateBbox(
  layers: readonly Layer[],
  selectedIds: readonly string[],
): Rect | null {
  reconcileTextGeometry(layers);
  const boxes: Rect[] = [];
  for (const layer of layers) {
    if (!selectedIds.includes(layer.id) || layer.hidden || !layerCanRotateBake(layer)) continue;
    const raw = layerBbox(layer);
    if (!raw) continue;
    boxes.push(normalizeRect(rotatedRectAABB(raw, layerRotation(layer))));
  }
  return boxes.length > 0 ? mergeBboxes(boxes) : null;
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

// The multi-rotate knob's SCREEN position (#152): the single-rotate handle
// geometry (same ROTATE_HANDLE_OFFSET_PX conventions) above `bounds`, orbited
// about `pivot` by the live gesture delta. Draw and hit-test both go through
// this one function — the chrome wraps the same math in a ctx-rotate, so a
// divergence would make the knob visible-but-unclickable. deltaDeg 0 (the
// idle chrome, and every grab — a grab always happens with no gesture active)
// is an exact pass-through of rotateHandleScreenPos.
export function multiRotateKnobScreenPos(
  bounds: Rect,
  pivot: Pt,
  deltaDeg: number,
  cam: Camera,
): Pt {
  const base = rotateHandleScreenPos(bounds, 0, cam);
  if (!deltaDeg) return base;
  const c = mmToScreen(pivot, cam);
  const rad = (deltaDeg * Math.PI) / 180;
  const dx = base.x - c.x;
  const dy = base.y - c.y;
  return {
    x: c.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: c.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

// Signed delta label for the multi-rotate badge (#152): `+37.5°` / `-45.0°`.
// The -0 fold keeps a tiny counter-clockwise jitter from flashing "-0.0°".
export function formatRotateDeltaBadge(deltaDeg: number): string {
  const d = deltaDeg === 0 ? 0 : deltaDeg;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}°`;
}

export function paintLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  options: LayerPaintOptions,
): void {
  const textGeometry = layer.type === 'text' ? getTextGeometry(layer) : null;
  // Invalid text sizes are preserved in the model for inspector recovery, but
  // they have no render geometry and must not reach font loading or fillText.
  if (layer.type === 'text' && !textGeometry) return;
  ctx.save();
  const rotation = layerRotation(layer);
  if (rotation) {
    const bbox = textGeometry?.box ?? layerBbox(layer);
    if (bbox) {
      const cx = textGeometry?.pivot.x ?? bbox.x + bbox.width / 2;
      const cy = textGeometry?.pivot.y ?? bbox.y + bbox.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
  }
  switch (layer.type) {
    case 'shape': {
      ctx.fillStyle = options.colorFor(layer.color);
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
          color: options.colorFor(layer.color),
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
          ctx.fillStyle = options.colorFor(layer.fill);
          ctx.fill(path, 'evenodd'); // holes/islands from tracing stay holes
        }
        if (layer.stroke !== null && layer.strokeWidth > 0) {
          ctx.strokeStyle = options.colorFor(layer.stroke);
          ctx.lineWidth = layer.strokeWidth;
          ctx.stroke(path);
        }
      }
      break;
    }
    case 'text': {
      // textGeometry was resolved before the transform above, so paint origin,
      // transform pivot, chrome and hit testing all consume one result.
      const geometry = textGeometry!;
      ctx.fillStyle = options.colorFor(layer.color);
      ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
      ctx.textBaseline = 'top';
      // Multiply into the CALLER's alpha (1 for the normal in-panel pass,
      // OUTSIDE_GHOST_ALPHA for the off-panel ghost pass) rather than
      // overwriting it — otherwise a loading/loaded google font would blow
      // away the ghost dim and always paint at 1 or 0.3 regardless of it.
      const inheritedAlpha = ctx.globalAlpha;
      const loadingTextAlpha = options.loadingTextAlpha ?? 1;
      ctx.globalAlpha = geometry.loading ? inheritedAlpha * loadingTextAlpha : inheritedAlpha;
      const lineHeight = layer.sizeMm * 1.25;
      layer.content.split('\n').forEach((line, i) => {
        ctx.fillText(line, geometry.box.x, geometry.box.y + i * lineHeight);
      });
      break;
    }
    case 'image': {
      const img = options.images?.get(layer.id);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
      } else if (options.paintMissingImagePlaceholder) {
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
  doc: { layers: Layer[] | PcbLayerStack },
  panel: PanelDims,
  cam: Camera,
  extras: RenderExtras,
): void {
  // Editor.tsx normally supplies the identity-stable flat fast path, while
  // standalone callers may supply the persisted PCB stack. Normalize both at
  // this boundary so painting, ghosts, text geometry, and chrome always share
  // one effective-material array in physical bottom-to-top order.
  const layers = projectFlatLayers(doc.layers);
  reconcileTextGeometry(layers, extras.requestRepaint);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const layerPaintOptions: LayerPaintOptions = {
    colorFor: editorPaletteColor,
    images: extras.images,
    paintMissingImagePlaceholder: true,
    loadingTextAlpha: LOADING_FONT_ALPHA,
  };

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
    layers,
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
      paintLayer(ctx, layer, layerPaintOptions);
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
  for (const layer of layers) {
    if (layer.hidden) continue;
    paintLayer(ctx, layer, layerPaintOptions);
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
  drawSelectionChrome(ctx, layers, cam, extras);

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
export function selectionBboxes(layers: readonly Layer[], selectedIds: readonly string[]): Rect[] {
  reconcileTextGeometry(layers);
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

// Stem + circular knob above a bbox's (rotated) top-edge midpoint — the ONE
// rotate affordance, shared byte-identically by the single-selection chrome
// (#51) and the multi/group-rotate chrome (#152, drawn with rotationDeg 0
// inside the gesture's ctx-rotate wrap). Caller owns save/restore.
function drawRotateKnob(
  ctx: CanvasRenderingContext2D,
  bbox: Rect,
  rotationDeg: number,
  cam: Camera,
): void {
  const topMid = mmToScreen(
    rotateMmPoint({ x: bbox.x + bbox.width / 2, y: bbox.y }, rectCenter(bbox), rotationDeg),
    cam,
  );
  const knob = rotateHandleScreenPos(bbox, rotationDeg, cam);
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

// Small dark pill with the signed delta text, anchored near the live knob
// position (#152). Screen space, drawn OUTSIDE the gesture's rotate wrap so
// the text stays upright at any delta.
function drawAngleBadge(ctx: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 10;
  const h = 18;
  ctx.fillStyle = 'rgba(20,22,26,0.85)';
  ctx.fillRect(x, y - h, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 5, y - h / 2);
  ctx.restore();
}

// Mid-gesture multi-rotate chrome (#152): the FROZEN start bounds under one
// outer ctx-rotate wrap (about the frozen pivot, by the live delta) covering
// the dashed rect, the corner handles, and the knob — so the whole box
// visibly turns with the content instead of pulsating as a re-derived AABB
// union would. The signed delta badge rides the live knob position, outside
// the wrap. Per-leaf boxes are deliberately NOT drawn mid-gesture: each
// leaf's live AABB pulsates while it rotates (the frozen box is the chrome).
function drawMultiRotateGestureChrome(
  ctx: CanvasRenderingContext2D,
  mr: MultiRotateChrome,
  cam: Camera,
): void {
  const pivotScreen = mmToScreen(mr.pivot, cam);
  ctx.save();
  ctx.translate(pivotScreen.x, pivotScreen.y);
  ctx.rotate((mr.deltaDeg * Math.PI) / 180);
  ctx.translate(-pivotScreen.x, -pivotScreen.y);
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  strokeMmRect(ctx, mr.bounds, cam);
  ctx.setLineDash([]);
  drawHandleSquares(ctx, cornerHandleRects(mr.bounds, cam));
  drawRotateKnob(ctx, mr.bounds, 0, cam);
  ctx.restore();
  const knob = multiRotateKnobScreenPos(mr.bounds, mr.pivot, mr.deltaDeg, cam);
  drawAngleBadge(ctx, formatRotateDeltaBadge(mr.deltaDeg), knob.x + 16, knob.y - 8);
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
  // multi-resize is #52. `selected` is defined iff the selection is a true
  // single LEAF (#151 — a one-child group expands to one leaf id too, but
  // takes the combined branch below) — and boxes is then non-empty, so the
  // layer is present + visible.
  const selected =
    (extras.singleSelection ?? extras.selectedIds.length === 1) && extras.selectedIds.length === 1
      ? layers.find((l) => l.id === extras.selectedIds[0])
      : undefined;
  const rotation = selected ? layerRotation(selected) : 0;
  // RAW (pre-rotation) bbox: the oriented chrome + handles anchor to it, not
  // to the axis-aligned AABB in `boxes`.
  const rawBbox = selected ? layerBbox(selected) : null;

  // Live multi-rotate gesture (#152): the frozen-bounds chrome REPLACES the
  // whole combined-selection chrome for the duration of the stream.
  if (!selected && extras.multiRotate) {
    drawMultiRotateGestureChrome(ctx, extras.multiRotate, cam);
    return;
  }

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
    // Multi/group rotate knob (#152): same shared-gate pattern. Drawn after
    // (= on top of) the corner handles, matching its precedence in the grab
    // chain (rotate wins over resize where they overlap).
    const rotateBbox = multiRotateBbox(layers, extras.selectedIds);
    if (rotateBbox) drawRotateKnob(ctx, rotateBbox, 0, cam);
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

  // Rotate handle (#51, image joined in #147): shape/text/image — the types
  // layerRotation reads. A stem connects the rotated top-edge midpoint to a
  // circular knob (shared with the multi-rotate chrome, #152).
  if (canRotate(selected) && rawBbox) {
    drawRotateKnob(ctx, rawBbox, rotation, cam);
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
