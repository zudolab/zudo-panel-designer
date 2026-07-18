import { describe, expect, it } from 'vitest';
import type { Layer } from '@zpd/core';
import type { Camera } from './camera';
import { outsidePanelRegion } from './outside-panel-region';
import type { PanelDims } from './types';

const CAM: Camera = { pxPerMm: 4, offsetX: 20, offsetY: 30 };
const PANEL: PanelDims = { widthMm: 50, heightMm: 128.5 };
const VIEWPORT = { cssW: 800, cssH: 600 };

// Crosses the panel's right edge (x + width = 64 > widthMm 50) — the
// baseline "eligible for the ghost pass" fixture used across most tests.
const offPanelShapeLayer: Layer = {
  id: 'shape-off-panel',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 40,
  y: 14,
  width: 24,
  height: 16,
  color: 2,
};
// Fully inside [0,0]..[widthMm,heightMm] — the exterior clip would reject
// every pixel this paints, so the ghost pass must cull it (perf).
const inPanelShapeLayer: Layer = {
  id: 'shape-in-panel',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 2,
  y: 2,
  width: 10,
  height: 10,
  color: 2,
};
const hiddenOffPanelShapeLayer: Layer = { ...offPanelShapeLayer, id: 'shape-hidden', hidden: true };
// Centerline fully inside the panel (min x 0.25), but a 1mm stroke reaches
// half its width (0.5mm) past the left edge to x -0.25 — it DOES paint a ghost
// sliver, so the painted-extent cull must keep it. On the centerline bbox alone
// it would be wrongly culled.
const strokeCrossingPathLayer: Layer = {
  id: 'path-stroke-crossing',
  name: 'Stroked path',
  type: 'path',
  points: [
    { x: 0.25, y: 10 },
    { x: 20, y: 20 },
    { x: 20, y: 40 },
  ],
  closed: false,
  fill: null,
  stroke: 1,
  strokeWidth: 1,
};
// Same geometry, but comfortably inside on every side even after the stroke —
// still culled (confirms the stroke expansion didn't over-include).
const strokeInsidePathLayer: Layer = {
  ...strokeCrossingPathLayer,
  id: 'path-stroke-inside',
  points: [
    { x: 5, y: 10 },
    { x: 20, y: 20 },
    { x: 20, y: 40 },
  ],
};
// Mirrored shape: x 10, width -20 → visually spans -10..10, crossing the left
// edge. The raw boundary test (x + negativeWidth) reads it as contained.
const mirroredOffPanelShapeLayer: Layer = {
  id: 'shape-mirrored-off-panel',
  name: 'Mirrored rect',
  type: 'shape',
  shape: 'rect',
  x: 10,
  y: 14,
  width: -20,
  height: 16,
  color: 2,
};
// Cover geometry for the 50mm-wide test panel — the square crosses the panel
// boundary on both x sides, so it is ghost-ELIGIBLE since #97 (movable
// pattern square; only the perf cull can exclude a pattern now).
const patternLayer: Layer = {
  id: 'pattern-1',
  name: 'Dot grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x: (50 - 128.5) / 2,
  y: 0,
  size: 128.5,
};
// A pattern square fully inside the panel — the perf cull (not any pattern
// rule) keeps it out of ghostLayers, exactly like the in-panel shape above.
const inPanelPatternLayer: Layer = {
  ...patternLayer,
  id: 'pattern-inside',
  x: 5,
  y: 5,
  size: 20,
};

describe('outsidePanelRegion', () => {
  it('ON branch: returns the outer viewport rect and inner panel rect in css px', () => {
    const region = outsidePanelRegion(true, [offPanelShapeLayer], VIEWPORT, CAM, PANEL);
    expect(region).not.toBeNull();
    expect(region!.outerRect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(region!.innerRect).toEqual({
      x: CAM.offsetX,
      y: CAM.offsetY,
      width: PANEL.widthMm * CAM.pxPerMm,
      height: PANEL.heightMm * CAM.pxPerMm,
    });
  });

  it('OFF branch: returns null so the caller skips the whole ghost pass', () => {
    expect(
      outsidePanelRegion(false, [offPanelShapeLayer, patternLayer], VIEWPORT, CAM, PANEL),
    ).toBeNull();
  });

  // #97 flipped the old pattern-skip rule: patterns are ghost-eligible now
  // that they can be moved off-panel (the square clip bounds the draw).
  it('pattern layers whose square crosses the panel boundary ARE ghost-eligible', () => {
    const region = outsidePanelRegion(true, [offPanelShapeLayer, patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([offPanelShapeLayer, patternLayer]);
  });

  it('perf cull still applies to patterns: a square fully inside the panel never ghosts', () => {
    const region = outsidePanelRegion(true, [inPanelPatternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([]);
  });

  it('excludes hidden layers from ghostLayers, matching the main layer pass', () => {
    const region = outsidePanelRegion(
      true,
      [offPanelShapeLayer, hiddenOffPanelShapeLayer],
      VIEWPORT,
      CAM,
      PANEL,
    );
    expect(region!.ghostLayers).toEqual([offPanelShapeLayer]);
  });

  it('perf cull: excludes layers whose bbox stays fully inside the panel', () => {
    const region = outsidePanelRegion(
      true,
      [offPanelShapeLayer, inPanelShapeLayer],
      VIEWPORT,
      CAM,
      PANEL,
    );
    expect(region!.ghostLayers).toEqual([offPanelShapeLayer]);
  });

  // #97: the default doc's cover square hangs off-panel on both x sides, so
  // the pattern-only default doc now ghosts its square margins (this was the
  // pre-#97 "always empty" regression case, inverted on purpose).
  it('the default-doc cover square ghosts its off-panel margins', () => {
    const region = outsidePanelRegion(true, [patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([patternLayer]);
  });

  it('painted-extent cull: keeps a stroked path whose stroke crosses an edge though its centerline is inside', () => {
    const region = outsidePanelRegion(true, [strokeCrossingPathLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([strokeCrossingPathLayer]);
  });

  it('painted-extent cull: still culls a stroked path that stays inside even with its stroke', () => {
    const region = outsidePanelRegion(true, [strokeInsidePathLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([]);
  });

  it('mirror-aware cull: keeps a mirrored shape (negative width) that visually crosses an edge', () => {
    const region = outsidePanelRegion(true, [mirroredOffPanelShapeLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([mirroredOffPanelShapeLayer]);
  });
});
