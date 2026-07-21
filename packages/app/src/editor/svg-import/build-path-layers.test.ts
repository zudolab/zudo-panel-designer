// Pure math -- runs in the default node test environment (no jsdom needed).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_HP,
  panelWidthMm,
  parsePanelConfig,
  serializePanelConfig,
  snapToGrid,
  type ColorIndex,
  type DocState,
  type PathLayer,
} from '@zpd/core';
import { buildPathLayers, type BuildPathLayersOptions } from './build-path-layers';
import type { IrShape, SvgAnalysis } from './types';

function analysis(overrides: Partial<SvgAnalysis> = {}): SvgAnalysis {
  return {
    status: 'ok',
    shapes: [],
    diagnostics: [],
    sourceColors: [],
    viewport: { minX: 0, minY: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function counterId(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

function baseOpts(overrides: Partial<BuildPathLayersOptions> = {}): BuildPathLayersOptions {
  return {
    panelWidthMm: 60,
    panelHeightMm: 128.5,
    colorMappings: {},
    makeId: counterId(),
    ...overrides,
  };
}

const RED: ColorIndex = 0;
const GOLD: ColorIndex = 1;

function closedShape(name: string, fillHex: string | null): IrShape {
  return {
    name,
    fillHex,
    strokeHex: null,
    strokeWidth: 0,
    contours: [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ],
  };
}

describe('buildPathLayers -- refusals', () => {
  it('refuses a non-ok analysis', () => {
    const result = buildPathLayers(analysis({ status: 'fatal' }), baseOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('invalid-analysis');
  });

  it('refuses non-positive panel width', () => {
    const result = buildPathLayers(
      analysis({ shapes: [closedShape('a', null)] }),
      baseOpts({ panelWidthMm: 0 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('invalid-panel-dimensions');
  });

  it('refuses non-positive panel height', () => {
    const result = buildPathLayers(
      analysis({ shapes: [closedShape('a', null)] }),
      baseOpts({ panelHeightMm: -1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('invalid-panel-dimensions');
  });

  it('refuses zero shapes', () => {
    const result = buildPathLayers(analysis({ shapes: [] }), baseOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('no-shapes');
  });

  it('refuses a colorMappings missing a source hex', () => {
    const result = buildPathLayers(
      analysis({ shapes: [closedShape('a', '#ff0000')], sourceColors: ['#ff0000'] }),
      baseOpts({ colorMappings: {} }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('color-mapping-mismatch');
  });

  it('refuses a colorMappings with an unknown extra hex', () => {
    const result = buildPathLayers(
      analysis({ shapes: [closedShape('a', '#ff0000')], sourceColors: ['#ff0000'] }),
      baseOpts({ colorMappings: { '#ff0000': RED, '#00ff00': GOLD } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('color-mapping-mismatch');
  });

  it('refuses more than 300 layers instead of truncating', () => {
    const shapes: IrShape[] = Array.from({ length: 301 }, (_, i) => closedShape(`s${i}`, null));
    const result = buildPathLayers(analysis({ shapes }), baseOpts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fatal.code).toBe('too-many-layers');
  });

  it('accepts exactly 300 layers', () => {
    const shapes: IrShape[] = Array.from({ length: 300 }, (_, i) => closedShape(`s${i}`, null));
    const result = buildPathLayers(analysis({ shapes }), baseOpts());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.layers).toHaveLength(300);
  });
});

describe('buildPathLayers -- fit-and-center placement', () => {
  it('scales down a wide viewport, constrained by width', () => {
    const shape = closedShape('wide', null);
    const result = buildPathLayers(
      analysis({ shapes: [shape], viewport: { minX: 0, minY: 0, width: 100, height: 10 } }),
      baseOpts({ panelWidthMm: 60, panelHeightMm: 128.5 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // scaleW = 0.8*60/100 = 0.48, scaleH = 0.5*128.5/10 = 6.425 -> width wins
    const scale = 0.48;
    const originX = snapToGrid(0.1 * 60);
    const originY = snapToGrid(0.15 * 128.5);
    expect(result.layers[0].points[1]).toEqual({ x: originX + 10 * scale, y: originY });
  });

  it('scales down a tall viewport, constrained by height', () => {
    const shape = closedShape('tall', null);
    const result = buildPathLayers(
      analysis({ shapes: [shape], viewport: { minX: 0, minY: 0, width: 10, height: 100 } }),
      baseOpts({ panelWidthMm: 60, panelHeightMm: 128.5 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // scaleW = 0.8*60/10 = 4.8, scaleH = 0.5*128.5/100 = 0.6425 -> height wins
    const scale = 0.6425;
    const originX = snapToGrid(0.1 * 60);
    const originY = snapToGrid(0.15 * 128.5);
    expect(result.layers[0].points[1].x).toBeCloseTo(originX + 10 * scale, 6);
    expect(result.layers[0].points[1].y).toBeCloseTo(originY, 6);
  });

  it('upscales a small viewport with no 1x cap', () => {
    const shape = closedShape('tiny', null);
    const result = buildPathLayers(
      analysis({ shapes: [shape], viewport: { minX: 0, minY: 0, width: 1, height: 1 } }),
      baseOpts({ panelWidthMm: 60, panelHeightMm: 128.5 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // scaleW = 0.8*60/1 = 48, scaleH = 0.5*128.5/1 = 64.25 -> width wins, and
    // it is well above 1 -- confirms the raster importImageFile's `1` cap is
    // deliberately NOT applied here.
    const scale = 48;
    const originX = snapToGrid(0.1 * 60);
    expect(result.layers[0].points[1].x).toBeCloseTo(originX + 10 * scale, 6);
  });

  it('maps viewport-relative so a non-zero viewBox origin positions correctly', () => {
    const shape: IrShape = {
      name: 's',
      fillHex: null,
      strokeHex: null,
      strokeWidth: 0,
      contours: [
        {
          closed: true,
          points: [
            { x: -20, y: 10 }, // exactly the viewport origin
            { x: 80, y: 60 }, // viewport origin + (width, height)
          ],
        },
      ],
    };
    const result = buildPathLayers(
      analysis({ shapes: [shape], viewport: { minX: -20, minY: 10, width: 100, height: 50 } }),
      baseOpts({ panelWidthMm: 60, panelHeightMm: 128.5 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scale = Math.min((0.8 * 60) / 100, (0.5 * 128.5) / 50);
    const originX = snapToGrid(0.1 * 60);
    const originY = snapToGrid(0.15 * 128.5);
    expect(result.layers[0].points[0]).toEqual({ x: originX, y: originY });
    expect(result.layers[0].points[1].x).toBeCloseTo(originX + 100 * scale, 6);
    expect(result.layers[0].points[1].y).toBeCloseTo(originY + 50 * scale, 6);
  });

  it('snaps only the placement origin, not the scaled points', () => {
    // A width whose 0.1x is not already grid-aligned, so this actually
    // exercises snapping instead of vacuously passing.
    const width = AWKWARD_PANEL_WIDTH_MM;
    const rawOriginX = 0.1 * width;
    const snappedOriginX = snapToGrid(rawOriginX);
    expect(snappedOriginX).not.toBe(rawOriginX); // sanity: fixture actually exercises snapping

    const shape = closedShape('s', null);
    const result = buildPathLayers(
      analysis({ shapes: [shape], viewport: { minX: 0, minY: 0, width: 3, height: 3 } }),
      baseOpts({ panelWidthMm: width, panelHeightMm: 128.5 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[0].points[0]).toEqual({ x: snappedOriginX, y: snapToGrid(0.15 * 128.5) });
    // point 1 sits at origin + 10*scale, an arbitrary value the code must NOT
    // separately snap to the 0.1mm grid.
    const scale = Math.min((0.8 * width) / 3, (0.5 * 128.5) / 3);
    const expectedX = snappedOriginX + 10 * scale;
    expect(result.layers[0].points[1].x).toBeCloseTo(expectedX, 9);
    expect(result.layers[0].points[1].x).not.toBe(snapToGrid(expectedX));
  });
});

const AWKWARD_PANEL_WIDTH_MM = 63.37;

describe('buildPathLayers -- paint mapping and stroke width', () => {
  it('maps fill/stroke via colorMappings and scales strokeWidth', () => {
    const shape: IrShape = {
      name: 's',
      fillHex: '#111111',
      strokeHex: '#222222',
      strokeWidth: 2,
      contours: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    };
    const result = buildPathLayers(
      analysis({
        shapes: [shape],
        sourceColors: ['#111111', '#222222'],
        viewport: { minX: 0, minY: 0, width: 100, height: 100 },
      }),
      baseOpts({
        panelWidthMm: 60,
        panelHeightMm: 128.5,
        colorMappings: { '#111111': RED, '#222222': GOLD },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const layer = result.layers[0];
    expect(layer.fill).toBe(RED);
    expect(layer.stroke).toBe(GOLD);
    const scale = Math.min((0.8 * 60) / 100, (0.5 * 128.5) / 100);
    expect(layer.strokeWidth).toBeCloseTo(2 * scale, 9);
  });

  it('zeroes strokeWidth when stroke paint is null', () => {
    const shape: IrShape = {
      name: 's',
      fillHex: '#111111',
      strokeHex: null,
      strokeWidth: 5,
      contours: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      ],
    };
    const result = buildPathLayers(
      analysis({ shapes: [shape], sourceColors: ['#111111'] }),
      baseOpts({ colorMappings: { '#111111': RED } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[0].stroke).toBeNull();
    expect(result.layers[0].strokeWidth).toBe(0);
  });

  it('keeps null paint null when the shape has no fill', () => {
    const shape = closedShape('s', null);
    const result = buildPathLayers(analysis({ shapes: [shape] }), baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[0].fill).toBeNull();
  });
});

describe('buildPathLayers -- compound closed shapes', () => {
  it('emits one PathLayer with extraSubpaths for a multi-contour all-closed shape', () => {
    const shape: IrShape = {
      name: 'compound',
      fillHex: '#111111',
      strokeHex: null,
      strokeWidth: 0,
      contours: [
        { closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { closed: true, points: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }] },
      ],
    };
    const result = buildPathLayers(
      analysis({ shapes: [shape], sourceColors: ['#111111'] }),
      baseOpts({ colorMappings: { '#111111': RED } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers).toHaveLength(1);
    const layer = result.layers[0];
    expect(layer.closed).toBe(true);
    expect(layer.extraSubpaths).toHaveLength(1);
    expect(layer.extraSubpaths?.[0]).toHaveLength(3);
  });
});

describe('buildPathLayers -- open-stroke contour fan-out', () => {
  it('emits one PathLayer per contour for a stroke-only shape with open contours', () => {
    const shape: IrShape = {
      name: 'stroke-path',
      fillHex: null,
      strokeHex: '#333333',
      strokeWidth: 1,
      contours: [
        { closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { closed: false, points: [{ x: 20, y: 0 }, { x: 30, y: 0 }] },
      ],
    };
    const result = buildPathLayers(
      analysis({ shapes: [shape], sourceColors: ['#333333'] }),
      baseOpts({ colorMappings: { '#333333': GOLD } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers).toHaveLength(2);
    for (const layer of result.layers) {
      expect(layer.closed).toBe(false);
      expect(layer.extraSubpaths).toBeUndefined();
      expect(layer.stroke).toBe(GOLD);
      expect(layer.fill).toBeNull();
      expect(layer.points).toHaveLength(2);
    }
    // distinct ids per fanned-out layer
    expect(result.layers[0].id).not.toBe(result.layers[1].id);
  });
});

describe('buildPathLayers -- injected id purity/determinism', () => {
  it('produces identical output (including ids) for identical inputs given fresh matching factories', () => {
    const shapes = [closedShape('a', '#111111'), closedShape('b', null)];
    const opts = (): BuildPathLayersOptions =>
      baseOpts({ colorMappings: { '#111111': RED } });
    const a = analysis({ shapes, sourceColors: ['#111111'] });
    const result1 = buildPathLayers(a, opts());
    const result2 = buildPathLayers(a, opts());
    expect(result1).toEqual(result2);
  });

  it('never mutates the input IR', () => {
    const shapes = [closedShape('a', null)];
    const before = JSON.parse(JSON.stringify(shapes));
    buildPathLayers(analysis({ shapes }), baseOpts());
    expect(shapes).toEqual(before);
  });
});

describe('buildPathLayers -- serialize round trip', () => {
  it('produced layers survive a parsePanelConfig round trip', () => {
    const shapes: IrShape[] = [
      closedShape('a', '#111111'),
      {
        name: 'stroke-path',
        fillHex: null,
        strokeHex: '#222222',
        strokeWidth: 1,
        contours: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
      },
    ];
    const result = buildPathLayers(
      analysis({ shapes, sourceColors: ['#111111', '#222222'] }),
      baseOpts({
        panelWidthMm: panelWidthMm(DEFAULT_PANEL_HP),
        colorMappings: { '#111111': RED, '#222222': GOLD },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc: DocState = { panelHp: DEFAULT_PANEL_HP, layers: result.layers, guides: [] };
    const serialized = serializePanelConfig(doc);
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    const parsed = parsePanelConfig(roundTripped);

    expect(parsed.layers).toHaveLength(result.layers.length);
    expect(parsed.layers as PathLayer[]).toEqual(result.layers);
  });
});
