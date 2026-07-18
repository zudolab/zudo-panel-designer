// Pure region math for the "show content outside the panel" ghost pass
// (issue #43). No Canvas here — this is the *decision* (which layers ghost,
// what the two clip rects are), node-testable without a canvas context.
// renderer.ts turns the result into the actual ctx.rect()/ctx.clip() calls;
// see outside-panel-region.test.ts for the ON/OFF/pattern-eligibility
// coverage and editor-view.spec.ts for the pixel-level proof that the canvas
// clip itself behaves (this module can't prove that on its own).
import { normalizeRect, rotatedRectAABB, type Layer } from '@zpd/core';
import type { Camera } from './camera';
import { layerBbox, layerRotation } from './renderer';
import type { PanelDims } from './types';

export interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutsidePanelRegion {
  // whole viewport, in css px — the ghost pass's outer clip rect
  outerRect: PxRect;
  // the panel, in css px — subtracted from outerRect via an even-odd clip so
  // the ghost pass only ever paints OUTSIDE the panel (see renderer.ts for
  // why that disjointness is load-bearing)
  innerRect: PxRect;
  // layers eligible for the ghost pass. Hidden layers are never drawn.
  // Pattern layers are ELIGIBLE since #97 (they're user-movable, so the
  // off-panel part of the square must read as "will not be manufactured"
  // like any other layer's): their draw branch clips to the layer's own
  // x/y/size square via a SEPARATE beginPath/rect/clip that INTERSECTS
  // whatever clip the caller holds (see renderer.ts drawLayer — never fold
  // that rect into this pass's even-odd outer clip), so a ghosted pattern
  // paints exactly square ∖ panel at low alpha, and the generators'
  // deliberate edge overscan (param-utils.ts centeredStart()) can never
  // flood the gutter beyond the square. That overscan was the original
  // reason patterns were excluded here; the square clip (#96) solved it.
  // The one cull left is pure PERFORMANCE (see crossesPanelBoundary): a
  // layer whose (rotation-aware) painted bbox stays fully inside the panel
  // can never contribute a visible ghost pixel — the exterior clip rejects
  // every pixel it paints — so drawing it here would just re-render (and,
  // for path layers, rebuild the Path2D) the whole layer a second time per
  // repaint for zero visual effect, costly on a large trace with hundreds
  // of path layers.
  ghostLayers: Layer[];
}

// A layer whose PAINTED bbox stays fully within [0,0]..[panel.widthMm,
// panel.heightMm] can never contribute a visible ghost pixel — see the
// perf-cull note on ghostLayers above. "Painted" is load-bearing: the cull
// decides whether a layer is drawn at all, so it must use the extent the layer
// actually paints, not the geometric centerline. A stroked path centered inside
// the panel but whose stroke half-width crosses an edge WOULD paint a ghost
// sliver — culling it on the centerline bbox would wrongly drop that sliver.
function crossesPanelBoundary(layer: Layer, panel: PanelDims): boolean {
  const rawBbox = layerBbox(layer);
  if (!rawBbox) return false;
  // normalizeRect: a mirrored shape/image (negative width/height) is inside-out
  // through the raw boundary test (x + negativeWidth < x), so an off-panel
  // mirror would read as contained. rotatedRectAABB already normalizes when it
  // rotates; normalize covers the unrotated case.
  let bbox = normalizeRect(rotatedRectAABB(rawBbox, layerRotation(layer)));
  // Include the painted stroke extent: pathBbox is the centerline, so a stroked
  // path's paint reaches half its stroke width beyond it on every side. (Only
  // PathLayer carries a stroke in the model; paths never rotate.)
  if (layer.type === 'path' && layer.stroke !== null && layer.strokeWidth > 0) {
    const half = layer.strokeWidth / 2;
    bbox = {
      x: bbox.x - half,
      y: bbox.y - half,
      width: bbox.width + layer.strokeWidth,
      height: bbox.height + layer.strokeWidth,
    };
  }
  return (
    bbox.x < 0 || bbox.y < 0 || bbox.x + bbox.width > panel.widthMm || bbox.y + bbox.height > panel.heightMm
  );
}

// Returns null when the toggle is off, so renderer.ts can skip the whole
// ghost pass with a single falsy check.
export function outsidePanelRegion(
  showOutsidePanel: boolean,
  layers: Layer[],
  viewport: { cssW: number; cssH: number },
  cam: Camera,
  panel: PanelDims,
): OutsidePanelRegion | null {
  if (!showOutsidePanel) return null;
  return {
    outerRect: { x: 0, y: 0, width: viewport.cssW, height: viewport.cssH },
    innerRect: {
      x: cam.offsetX,
      y: cam.offsetY,
      width: panel.widthMm * cam.pxPerMm,
      height: panel.heightMm * cam.pxPerMm,
    },
    ghostLayers: layers.filter((layer) => !layer.hidden && crossesPanelBoundary(layer, panel)),
  };
}
