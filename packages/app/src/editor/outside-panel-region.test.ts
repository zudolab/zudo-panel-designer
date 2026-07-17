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
const patternLayer: Layer = {
  id: 'pattern-1',
  name: 'Dot grid',
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
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

  it('pattern-skip rule: excludes pattern layers from ghostLayers', () => {
    const region = outsidePanelRegion(true, [offPanelShapeLayer, patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([offPanelShapeLayer]);
    expect(region!.ghostLayers.some((l) => l.type === 'pattern')).toBe(false);
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

  it('regression: the default doc always ghosts as empty when only a pattern layer exists', () => {
    const region = outsidePanelRegion(true, [patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([]);
  });
});
