// Pure region math for the "show content outside the panel" ghost pass
// (issue #43). No Canvas here — this is the *decision* (which layers ghost,
// what the two clip rects are), node-testable without a canvas context.
// renderer.ts turns the result into the actual ctx.rect()/ctx.clip() calls;
// see outside-panel-region.test.ts for the ON/OFF/pattern-skip coverage and
// editor-view.spec.ts for the pixel-level proof that the canvas clip itself
// behaves (this module can't prove that on its own).
import type { Layer } from '@zpd/core';
import type { Camera } from './camera';
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
  // Pattern layers are excluded — this is a correctness rule, not an
  // optimization: patterns deliberately overscan the panel edges (see
  // packages/patterns/src/patterns.ts, centeredStart()) so they read as
  // intentional at any panel size, and today's ctx.clip() in the main pass
  // is what hides that overscan. Ghosting patterns would flood the entire
  // gutter with dot-grid. Patterns are semantically panel-bound (see
  // hit-test.ts: "pattern layers are panel-wide") — not bbox-bound, so
  // layerBbox() returning the panel rect for a pattern must not be read as
  // "patterns can't paint outside it".
  ghostLayers: Layer[];
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
    ghostLayers: layers.filter((layer) => !layer.hidden && layer.type !== 'pattern'),
  };
}
