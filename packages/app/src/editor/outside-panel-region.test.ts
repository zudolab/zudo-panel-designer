import { describe, expect, it } from 'vitest';
import type { Layer } from '@zpd/core';
import type { Camera } from './camera';
import { outsidePanelRegion } from './outside-panel-region';
import type { PanelDims } from './types';

const CAM: Camera = { pxPerMm: 4, offsetX: 20, offsetY: 30 };
const PANEL: PanelDims = { widthMm: 50, heightMm: 128.5 };
const VIEWPORT = { cssW: 800, cssH: 600 };

const shapeLayer: Layer = {
  id: 'shape-1',
  name: 'Rect',
  type: 'shape',
  shape: 'rect',
  x: 8,
  y: 14,
  width: 24,
  height: 16,
  color: 2,
};
const hiddenShapeLayer: Layer = { ...shapeLayer, id: 'shape-hidden', hidden: true };
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
    const region = outsidePanelRegion(true, [shapeLayer], VIEWPORT, CAM, PANEL);
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
    expect(outsidePanelRegion(false, [shapeLayer, patternLayer], VIEWPORT, CAM, PANEL)).toBeNull();
  });

  it('pattern-skip rule: excludes pattern layers from ghostLayers', () => {
    const region = outsidePanelRegion(true, [shapeLayer, patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([shapeLayer]);
    expect(region!.ghostLayers.some((l) => l.type === 'pattern')).toBe(false);
  });

  it('excludes hidden layers from ghostLayers, matching the main layer pass', () => {
    const region = outsidePanelRegion(true, [shapeLayer, hiddenShapeLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([shapeLayer]);
  });

  it('regression: the default doc always ghosts as empty when only a pattern layer exists', () => {
    const region = outsidePanelRegion(true, [patternLayer], VIEWPORT, CAM, PANEL);
    expect(region!.ghostLayers).toEqual([]);
  });
});
