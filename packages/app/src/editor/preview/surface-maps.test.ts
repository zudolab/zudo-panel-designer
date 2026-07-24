import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPcbLayerStack,
  PALETTE,
  PANEL_HEIGHT_MM,
  PANEL_THICKNESS_MM,
  PCB_SUBSTRATE,
  panelWidthMm,
  type DocState,
  type LayerNode,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { patternByName } from '@zpd/patterns';
import {
  ensureFontAttempt,
  type FontAttemptStatus,
  type FontInitialResult,
  type FontLoadAttempt,
} from '../fonts';
import { resetTextGeometryForTests, setTextMeasureForTests } from '../text-geometry';
import {
  openPreviewGenerationSession,
  type PreviewCanvasSource,
  type PreviewGenerationTicket,
} from './contracts';
import { representativeSurfaceMapDoc } from './surface-maps.fixtures';
import { projectFlatLayers } from '../flat-projection';
import {
  PCB_SUBSTRATE_SURFACE_MATERIAL,
  PCB_SURFACE_MATERIALS,
  createPreviewSurfaceMapGenerator,
  surfaceMapColorForPalette,
  surfaceMapSubstrateColor,
  type PreviewCanvasFactory,
} from './surface-maps';

vi.mock('../fonts', () => ({
  ensureFontAttempt: vi.fn(),
  fontRequestKey: (family: string, sampleText?: string) =>
    `${family.length}:${family}:${sampleText ?? ''}`,
}));

vi.mock('@zpd/patterns', () => ({
  patternByName: vi.fn(),
}));

interface PathCommand {
  readonly method: string;
  readonly args: readonly number[];
}

class RecordingPath2D {
  readonly commands: PathCommand[] = [];

  moveTo(...args: [number, number]): void {
    this.commands.push({ method: 'moveTo', args });
  }

  bezierCurveTo(...args: [number, number, number, number, number, number]): void {
    this.commands.push({ method: 'bezierCurveTo', args });
  }

  closePath(): void {
    this.commands.push({ method: 'closePath', args: [] });
  }
}

interface CanvasCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly globalAlpha: number;
  readonly globalCompositeOperation: string;
  // Global ordering across every recording canvas: sampling through a mask
  // sheet drawImage must only replay sheet calls issued BEFORE that
  // composite (the shared sheet is re-filled and re-punched per map).
  readonly seq: number;
}

type CallObserver = (call: CanvasCall) => void;

let nextCallSeq = 0;

function recordingContext(calls: CanvasCall[], observer?: CallObserver): CanvasRenderingContext2D {
  let state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over',
  };
  const stack: Record<string, unknown>[] = [];

  return new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property in state) return state[property];
        if (property === 'measureText') return () => ({ width: 0 });
        return (...args: unknown[]) => {
          if (property === 'save') stack.push({ ...state });
          if (property === 'restore') state = stack.pop() ?? state;
          const call: CanvasCall = {
            method: property,
            args,
            fillStyle: String(state.fillStyle),
            strokeStyle: String(state.strokeStyle),
            globalAlpha: Number(state.globalAlpha),
            globalCompositeOperation: String(state.globalCompositeOperation),
            seq: nextCallSeq++,
          };
          calls.push(call);
          observer?.(call);
          return undefined;
        };
      },
      set(_target, property: string, value: unknown) {
        state[property] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

class RecordingCanvas {
  readonly calls: CanvasCall[] = [];
  readonly context: CanvasRenderingContext2D;

  constructor(
    readonly width: number,
    readonly height: number,
    observer?: CallObserver,
  ) {
    this.context = recordingContext(this.calls, observer);
  }

  getContext(contextId: string): CanvasRenderingContext2D | null {
    return contextId === '2d' ? this.context : null;
  }
}

function recordingCanvasFactory(observer?: CallObserver): {
  readonly canvases: RecordingCanvas[];
  readonly factory: PreviewCanvasFactory;
} {
  const canvases: RecordingCanvas[] = [];
  return {
    canvases,
    factory: (widthPx, heightPx) => {
      const canvas = new RecordingCanvas(widthPx, heightPx, observer);
      canvases.push(canvas);
      return canvas as unknown as PreviewCanvasSource;
    },
  };
}

function settledAttempt(result: FontInitialResult): FontLoadAttempt {
  const initial = Promise.resolve(result);
  return {
    initial,
    done: initial.then(() => {}),
    getStatus: () => result,
    onLateReady: () => () => {},
  };
}

interface ControlledAttempt {
  readonly attempt: FontLoadAttempt;
  settle(result: FontInitialResult): void;
  lateReady(): void;
}

function controlledAttempt(): ControlledAttempt {
  let status: FontAttemptStatus = 'pending';
  let settleInitial: (result: FontInitialResult) => void = () => {};
  const lateReadyCallbacks = new Set<() => void>();
  const initial = new Promise<FontInitialResult>((resolve) => {
    settleInitial = resolve;
  });
  const attempt: FontLoadAttempt = {
    initial,
    done: initial.then(() => {}),
    getStatus: () => status,
    onLateReady(callback) {
      lateReadyCallbacks.add(callback);
      return () => lateReadyCallbacks.delete(callback);
    },
  };
  return {
    attempt,
    settle(result) {
      status = result;
      settleInitial(result);
    },
    lateReady() {
      status = 'late-ready';
      for (const callback of [...lateReadyCallbacks]) callback();
      lateReadyCallbacks.clear();
    },
  };
}

function ticket(
  surfaceRevision: number,
  signal = new AbortController().signal,
): PreviewGenerationTicket {
  return { surfaceRevision, signal };
}

function normalizedCalls(canvas: RecordingCanvas): unknown[] {
  // seq is deliberately omitted: it is a process-global counter, so it must
  // not leak into determinism comparisons between two independent runs.
  return canvas.calls.map((call) => ({
    method: call.method,
    fillStyle: call.fillStyle,
    strokeStyle: call.strokeStyle,
    globalAlpha: call.globalAlpha,
    globalCompositeOperation: call.globalCompositeOperation,
    args: call.args.map((arg) => {
      if (arg instanceof RecordingPath2D) return { pathCommands: arg.commands };
      // A drawImage source canvas normalizes to its dimensions only: the
      // sheet's own call log is compared separately, and its raw calls carry
      // process-global seq values.
      if (arg instanceof RecordingCanvas) {
        return { canvasRef: { width: arg.width, height: arg.height } };
      }
      return arg;
    }),
  }));
}

function pathContains(path: RecordingPath2D, x: number, y: number): boolean {
  const polygons: Array<Array<readonly [number, number]>> = [];
  let polygon: Array<readonly [number, number]> = [];
  for (const command of path.commands) {
    if (command.method === 'moveTo') {
      if (polygon.length > 0) polygons.push(polygon);
      polygon = [[command.args[0], command.args[1]]];
    } else if (command.method === 'bezierCurveTo') {
      polygon.push([command.args[4], command.args[5]]);
    } else if (command.method === 'closePath' && polygon.length > 0) {
      polygons.push(polygon);
      polygon = [];
    }
  }
  if (polygon.length > 0) polygons.push(polygon);

  let crossings = 0;
  for (const points of polygons) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) crossings += 1;
  }
  return crossings % 2 === 1;
}

// Replays a canvas call log at one sample point, modeling the negative-mask
// composite: `apply` receives the style of every covering paint — or null for
// a destination-out punch that erases the point. Mask-sheet drawImage calls
// recurse into the sheet's own log, truncated to calls issued before the
// composite (the shared sheet is re-filled and re-punched per map).
function replayStyleAt(
  calls: readonly CanvasCall[],
  x: number,
  y: number,
  apply: (style: string | null) => void,
): void {
  let pendingRect: readonly number[] | null = null;
  const contains = (rect: readonly number[]) =>
    x > rect[0] && x < rect[0] + rect[2] && y > rect[1] && y < rect[1] + rect[3];
  const applyCall = (call: CanvasCall): void => {
    apply(call.globalCompositeOperation === 'destination-out' ? null : call.fillStyle);
  };
  for (const call of calls) {
    if (call.method === 'beginPath') pendingRect = null;
    if (call.method === 'rect' && call.args.every((arg) => typeof arg === 'number')) {
      pendingRect = call.args as number[];
    }
    if (
      call.method === 'fillRect' &&
      call.args.every((arg) => typeof arg === 'number') &&
      contains(call.args as number[])
    ) {
      applyCall(call);
    }
    if (call.method === 'fill' && call.args.length === 0 && pendingRect) {
      if (contains(pendingRect)) applyCall(call);
      pendingRect = null;
    }
    if (
      call.method === 'fill' &&
      call.args[0] instanceof RecordingPath2D &&
      call.args[1] === 'evenodd' &&
      pathContains(call.args[0], x, y)
    ) {
      applyCall(call);
    }
    if (call.method === 'drawImage' && call.args[0] instanceof RecordingCanvas) {
      const sheetStyle = sheetStyleAt(
        call.args[0].calls.filter((sheetCall) => sheetCall.seq < call.seq),
        x,
        y,
      );
      if (sheetStyle !== null) apply(sheetStyle);
    }
  }
}

// Resolves an offscreen mask sheet at one point: the last covering
// source-over fill wins unless a later destination-out punch erased it —
// null means the sheet is transparent there (the opening shows what's below).
function sheetStyleAt(calls: readonly CanvasCall[], x: number, y: number): string | null {
  let style: string | null = null;
  replayStyleAt(calls, x, y, (coveringStyle) => {
    style = coveringStyle;
  });
  return style;
}

function topMaterialAt(calls: readonly CanvasCall[], x: number, y: number): string | null {
  let style: string | null = null;
  replayStyleAt(calls, x, y, (coveringStyle) => {
    // On an opaque map canvas a punch cannot erase to transparency; it simply
    // leaves the previously painted material visible.
    if (coveringStyle !== null) style = coveringStyle;
  });
  return style;
}

const originalPath2D = globalThis.Path2D;

beforeEach(() => {
  (globalThis as { Path2D: typeof Path2D }).Path2D = RecordingPath2D as unknown as typeof Path2D;
  resetTextGeometryForTests();
  setTextMeasureForTests((layer) => ({
    x: layer.x,
    y: layer.y,
    width:
      Math.max(...layer.content.split('\n').map((line) => line.length), 0) * layer.sizeMm * 0.6,
    height: layer.content.split('\n').length * layer.sizeMm * 1.25,
  }));
  vi.mocked(ensureFontAttempt).mockReturnValue(settledAttempt('ready'));
  vi.mocked(patternByName).mockImplementation((name) => {
    if (name !== 'fixture-grid') return undefined;
    return {
      name,
      displayName: 'Fixture grid',
      paramDefs: [],
      draw(ctx, options) {
        ctx.fillStyle = options.color;
        ctx.fillRect(0, 0, options.widthMm, 1);
      },
    };
  });
});

afterEach(() => {
  resetTextGeometryForTests();
  vi.clearAllMocks();
  (globalThis as { Path2D: typeof Path2D }).Path2D = originalPath2D;
});

describe('PCB surface material classification', () => {
  it('maps gold to shiny metal and keeps black/white distinctly matte and nonmetallic', () => {
    expect(PCB_SURFACE_MATERIALS[1]).toMatchObject({
      baseColor: PALETTE[1].hex,
      metalness: 1,
      roughness: 0.24,
    });
    expect(PCB_SURFACE_MATERIALS[0].metalness).toBe(0);
    expect(PCB_SURFACE_MATERIALS[2].metalness).toBe(0);
    expect(PCB_SURFACE_MATERIALS[1].roughness).toBeLessThan(PCB_SURFACE_MATERIALS[0].roughness);
    expect(PCB_SURFACE_MATERIALS[0].roughness).not.toBe(PCB_SURFACE_MATERIALS[2].roughness);
    expect(Object.isFrozen(PCB_SURFACE_MATERIALS)).toBe(true);
  });

  it('encodes scalar channels as deterministic linear-data grayscale bytes', () => {
    expect(surfaceMapColorForPalette('metalness', 0)).toBe('#000000');
    expect(surfaceMapColorForPalette('metalness', 1)).toBe('#ffffff');
    expect(surfaceMapColorForPalette('metalness', 2)).toBe('#000000');
    expect(surfaceMapColorForPalette('roughness', 0)).toBe('#a3a3a3');
    expect(surfaceMapColorForPalette('roughness', 1)).toBe('#3d3d3d');
    expect(surfaceMapColorForPalette('roughness', 2)).toBe('#d6d6d6');
  });

  it('pins the substrate coefficients to the shared core constant', () => {
    expect(PCB_SUBSTRATE_SURFACE_MATERIAL).toMatchObject({
      baseColor: PCB_SUBSTRATE.hex,
      metalness: 0,
      roughness: 0.55,
    });
    expect(Object.isFrozen(PCB_SUBSTRATE_SURFACE_MATERIAL)).toBe(true);
    expect(surfaceMapSubstrateColor('baseColor')).toBe(PCB_SUBSTRATE.hex);
    expect(surfaceMapSubstrateColor('metalness')).toBe('#000000');
    expect(surfaceMapSubstrateColor('roughness')).toBe('#8c8c8c');
  });
});

describe('createPreviewSurfaceMapGenerator', () => {
  it('composes fixed materials identically across base color and scalar maps', () => {
    const artwork = {
      copper: [
        {
          id: 'copper',
          name: 'Copper',
          type: 'shape' as const,
          shape: 'rect' as const,
          x: 2,
          y: 2,
          width: 20,
          height: 20,
          color: 0 as const, // stale on purpose
        },
        {
          id: 'image',
          name: 'Reference image',
          type: 'image' as const,
          src: 'data:image/png;base64,fixture',
          x: 2,
          y: 2,
          width: 30,
          height: 20,
        },
      ],
      mask: [
        {
          id: 'mask',
          name: 'Opening with re-masked hole',
          type: 'path' as const,
          points: [
            { x: 8, y: 2 },
            { x: 32, y: 2 },
            { x: 32, y: 22 },
            { x: 8, y: 22 },
          ],
          extraSubpaths: [
            [
              { x: 12, y: 6 },
              { x: 16, y: 6 },
              { x: 16, y: 12 },
              { x: 12, y: 12 },
            ],
          ],
          closed: true,
          fill: 2 as const, // stale on purpose
          stroke: null,
          strokeWidth: 0,
        },
      ],
      silk: [
        {
          id: 'silk',
          name: 'Silk',
          type: 'shape' as const,
          shape: 'rect' as const,
          x: 24,
          y: 2,
          width: 6,
          height: 6,
          color: 1 as const, // stale on purpose
        },
      ],
    };
    const generate = (hidden: { mask?: boolean; silk?: boolean } = {}) => {
      const stack = createPcbLayerStack({
        copper: artwork.copper,
        'solder-mask': artwork.mask,
        silkscreen: artwork.silk,
      });
      if (hidden.mask) stack[1] = { ...stack[1], hidden: true };
      if (hidden.silk) stack[2] = { ...stack[2], hidden: true };
      const recording = recordingCanvasFactory();
      const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
      const snapshot = generator.generate({
        doc: { panelHp: 8, layers: stack },
        ticket: ticket(21),
        preferredPixelsPerMm: 1,
        maximumTextureSizePx: 512,
      });
      generator.close();
      return snapshot;
    };
    // Negative mask semantics: the sheet covers everything the punches do not
    // open, an opening resolves to what lies beneath (copper, else substrate).
    const samples = [
      { point: [4, 4] as const, material: 0 as const }, // un-punched mask over copper
      { point: [10, 4] as const, material: 1 as const }, // opening over copper
      { point: [14, 8] as const, material: 0 as const }, // even-odd hole re-masks
      { point: [28, 12] as const, material: 'substrate' } as const, // opening over nothing
      { point: [26, 4] as const, material: 2 as const }, // silk over mask
    ];
    const expected = (
      mapName: 'baseColor' | 'metalness' | 'roughness',
      material: 0 | 1 | 2 | 'substrate',
    ) =>
      material === 'substrate'
        ? surfaceMapSubstrateColor(mapName)
        : surfaceMapColorForPalette(mapName, material);

    const visible = generate();
    for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
      const canvas = visible.maps[mapName].source as unknown as RecordingCanvas;
      for (const sample of samples) {
        expect(topMaterialAt(canvas.calls, sample.point[0], sample.point[1])).toBe(
          expected(mapName, sample.material),
        );
      }
      // Exactly one drawImage: the punched mask sheet. Image layers stay
      // excluded from the maps entirely.
      const drawImageCalls = canvas.calls.filter((call) => call.method === 'drawImage');
      expect(drawImageCalls).toHaveLength(1);
      expect(drawImageCalls[0]!.args[0]).toBeInstanceOf(RecordingCanvas);
    }

    const maskHidden = generate({ mask: true });
    const silkHidden = generate({ silk: true });
    for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
      const maskHiddenCanvas = maskHidden.maps[mapName].source as unknown as RecordingCanvas;
      // Hidden mask container: no sheet at all — bare copper on substrate.
      expect(maskHiddenCanvas.calls.some((call) => call.method === 'drawImage')).toBe(false);
      expect(topMaterialAt(maskHiddenCanvas.calls, 4, 4)).toBe(expected(mapName, 1));
      expect(topMaterialAt(maskHiddenCanvas.calls, 10, 4)).toBe(expected(mapName, 1));
      expect(topMaterialAt(maskHiddenCanvas.calls, 28, 12)).toBe(expected(mapName, 'substrate'));
      // Hidden silkscreen: the opening at its footprint has no copper below.
      expect(
        topMaterialAt((silkHidden.maps[mapName].source as unknown as RecordingCanvas).calls, 26, 4),
      ).toBe(expected(mapName, 'substrate'));
    }
  });

  it('sizes every map within the runtime cap and returns exact physical/orientation metadata', () => {
    const doc = representativeSurfaceMapDoc();
    const before = JSON.stringify(doc);
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });

    const snapshot = generator.generate({
      doc,
      ticket: ticket(7),
      maximumTextureSizePx: 256,
    });

    expect(snapshot.surfaceRevision).toBe(7);
    expect(snapshot.physicalDimensions).toEqual({
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: PANEL_HEIGHT_MM,
      thicknessMm: PANEL_THICKNESS_MM,
    });
    expect(snapshot.rasterSize.widthPx).toBeLessThanOrEqual(256);
    expect(snapshot.rasterSize.heightPx).toBeLessThanOrEqual(256);
    expect(snapshot.rasterSize.widthPx / snapshot.rasterSize.heightPx).toBeCloseTo(
      panelWidthMm(doc.panelHp) / PANEL_HEIGHT_MM,
      2,
    );
    expect(snapshot.orientation.documentTopLeftUv).toEqual({ u: 0, v: 1 });
    // Three maps plus the one shared mask sheet, all at the chosen raster.
    expect(recording.canvases).toHaveLength(4);
    expect(recording.canvases.every((canvas) => canvas.width === snapshot.rasterSize.widthPx)).toBe(
      true,
    );
    expect(
      recording.canvases.every((canvas) => canvas.height === snapshot.rasterSize.heightPx),
    ).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    generator.close();
  });

  it('keeps canonical geometry, clipping, exclusions, and document-order material overrides', () => {
    const doc = representativeSurfaceMapDoc();
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc,
      ticket: ticket(9),
      preferredPixelsPerMm: 2,
      maximumTextureSizePx: 512,
    });
    const baseColor = snapshot.maps.baseColor.source as unknown as RecordingCanvas;
    const metalness = snapshot.maps.metalness.source as unknown as RecordingCanvas;
    const roughness = snapshot.maps.roughness.source as unknown as RecordingCanvas;
    const maskSheet = recording.canvases.find(
      (canvas) => canvas !== baseColor && canvas !== metalness && canvas !== roughness,
    )!;

    for (const [mapName, canvas] of [
      ['baseColor', baseColor],
      ['metalness', metalness],
      ['roughness', roughness],
    ] as const) {
      // Negative mask: un-punched copper reads as soldermask, the opening
      // reveals copper, silkscreen stays positive on top.
      expect(topMaterialAt(canvas.calls, 4, 4)).toBe(surfaceMapColorForPalette(mapName, 0));
      expect(topMaterialAt(canvas.calls, 10, 10)).toBe(surfaceMapColorForPalette(mapName, 1));
      expect(topMaterialAt(canvas.calls, 14, 14)).toBe(surfaceMapColorForPalette(mapName, 2));

      const panelRectIndex = canvas.calls.findIndex(
        (call) =>
          call.method === 'rect' &&
          call.args[0] === 0 &&
          call.args[1] === 0 &&
          call.args[2] === panelWidthMm(doc.panelHp) &&
          call.args[3] === PANEL_HEIGHT_MM,
      );
      const panelClipIndex = canvas.calls.findIndex(
        (call, index) => call.method === 'clip' && index > panelRectIndex,
      );
      const firstLayerFillIndex = canvas.calls.findIndex((call) => call.method === 'fill');
      expect(panelRectIndex).toBeGreaterThan(-1);
      expect(panelClipIndex).toBeGreaterThan(panelRectIndex);
      expect(firstLayerFillIndex).toBeGreaterThan(panelClipIndex);
      const patternTranslateIndex = canvas.calls.findIndex(
        (call) => call.method === 'translate' && call.args[0] === 25 && call.args[1] === 30,
      );
      const patternRectIndex = canvas.calls.findIndex(
        (call, index) =>
          index > patternTranslateIndex &&
          call.method === 'rect' &&
          call.args[0] === 0 &&
          call.args[1] === 0 &&
          call.args[2] === 12 &&
          call.args[3] === 12,
      );
      const patternClipIndex = canvas.calls.findIndex(
        (call, index) => index > patternRectIndex && call.method === 'clip',
      );
      const patternDrawIndex = canvas.calls.findIndex(
        (call, index) => index > patternClipIndex && call.method === 'fillRect',
      );
      expect(patternTranslateIndex).toBeGreaterThan(-1);
      expect(patternRectIndex).toBeGreaterThan(patternTranslateIndex);
      expect(patternClipIndex).toBeGreaterThan(patternRectIndex);
      expect(patternDrawIndex).toBeGreaterThan(patternClipIndex);
      // Exactly one drawImage per map — the punched mask sheet — while image
      // layers stay excluded from the maps.
      const drawImageCalls = canvas.calls.filter((call) => call.method === 'drawImage');
      expect(drawImageCalls).toHaveLength(1);
      expect(drawImageCalls[0]!.args[0]).toBe(maskSheet);
      expect(canvas.calls.some((call) => call.method === 'strokeRect')).toBe(false);
      expect(
        canvas.calls.some(
          (call) =>
            call.method === 'rect' &&
            call.args[0] === 10 &&
            call.args[1] === 110 &&
            call.args[2] === 3,
        ),
      ).toBe(false);
      expect(
        canvas.calls.some(
          (call) =>
            call.method === 'rotate' &&
            Math.abs(Number(call.args[0]) - Math.PI / 4) < Number.EPSILON,
        ),
      ).toBe(true);
      expect(
        canvas.calls.some(
          (call) =>
            call.method === 'rotate' &&
            Math.abs(Number(call.args[0]) - Math.PI / 6) < Number.EPSILON,
        ),
      ).toBe(true);
      expect(canvas.calls.some((call) => call.method === 'fillText')).toBe(true);
    }

    // The shared sheet is re-filled with each map's soldermask value and
    // punched under destination-out: the fixture's path opening keeps its
    // even-odd holes and its stroke erases alpha too.
    const mapNames = ['baseColor', 'metalness', 'roughness'] as const;
    expect(
      maskSheet.calls.some(
        (call) =>
          call.method === 'fill' &&
          call.args[0] instanceof RecordingPath2D &&
          call.args[1] === 'evenodd' &&
          call.globalCompositeOperation === 'destination-out',
      ),
    ).toBe(true);
    const sheetBackgroundFills = maskSheet.calls.filter((call) => call.method === 'fillRect');
    expect(sheetBackgroundFills.map((call) => call.fillStyle)).toEqual(
      mapNames.map((mapName) => surfaceMapColorForPalette(mapName, 0)),
    );
    expect(
      sheetBackgroundFills.every((call) => call.globalCompositeOperation === 'source-over'),
    ).toBe(true);
    const sheetStrokes = maskSheet.calls.filter((call) => call.method === 'stroke');
    expect(sheetStrokes.map((call) => call.strokeStyle)).toEqual(
      mapNames.map((mapName) => surfaceMapColorForPalette(mapName, 0)),
    );
    expect(sheetStrokes.every((call) => call.globalCompositeOperation === 'destination-out')).toBe(
      true,
    );
    expect(maskSheet.calls.some((call) => call.method === 'drawImage')).toBe(false);

    expect(patternByName).toHaveBeenCalledTimes(3);
    generator.close();
  });

  it('replays the representative operation corpus deterministically', () => {
    const doc = representativeSurfaceMapDoc();
    const first = recordingCanvasFactory();
    const second = recordingCanvasFactory();
    const firstGenerator = createPreviewSurfaceMapGenerator({ canvasFactory: first.factory });
    const secondGenerator = createPreviewSurfaceMapGenerator({ canvasFactory: second.factory });
    const input = {
      doc,
      ticket: ticket(11),
      preferredPixelsPerMm: 2,
      maximumTextureSizePx: 512,
    };

    firstGenerator.generate(input);
    secondGenerator.generate(input);

    expect(second.canvases.map(normalizedCalls)).toEqual(first.canvases.map(normalizedCalls));
    firstGenerator.close();
    secondGenerator.close();
  });

  it('stops aborted work before another map can be published', () => {
    const controller = new AbortController();
    let abortedOnGold = false;
    const recording = recordingCanvasFactory((call) => {
      if (!abortedOnGold && call.method === 'fill' && call.fillStyle === PALETTE[1].hex) {
        abortedOnGold = true;
        controller.abort();
      }
    });
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });

    expect(() =>
      generator.generate({
        doc: representativeSurfaceMapDoc(),
        ticket: ticket(12, controller.signal),
        maximumTextureSizePx: 256,
      }),
    ).toThrow(expect.objectContaining({ name: 'AbortError' }));
    expect(recording.canvases).toHaveLength(1);
    generator.close();
  });

  it('integrates with the generation session so replaced snapshots stay unpublished', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const session = openPreviewGenerationSession(1);
    const first = session.initialGeneration;
    const snapshot = generator.generate({
      doc: { panelHp: 4, layers: createPcbLayerStack() },
      ticket: first,
      maximumTextureSizePx: 128,
    });

    expect(session.canPublish(first, snapshot)).toBe(true);
    const replacement = session.beginGeneration(2);
    expect(first.signal.aborted).toBe(true);
    expect(session.canPublish(first, snapshot)).toBe(false);
    expect(replacement.signal.aborted).toBe(false);
    session.close();
    generator.close();
  });

  it('coalesces actual font readiness at the latest generated revision without dimming material', async () => {
    const firstFont = controlledAttempt();
    const secondFont = controlledAttempt();
    vi.mocked(ensureFontAttempt).mockImplementation((family) =>
      family === 'First Font' ? firstFont.attempt : secondFont.attempt,
    );
    const text = (id: string, fontFamily: string): TextLayer => ({
      id,
      name: id,
      type: 'text',
      content: id,
      fontFamily,
      sizeMm: 5,
      x: 2,
      y: id === 'first' ? 2 : 12,
      color: 1,
    });
    const doc: Pick<DocState, 'panelHp' | 'layers'> = {
      panelHp: 4,
      layers: createPcbLayerStack({
        silkscreen: [text('first', 'First Font'), text('second', 'Second Font')],
      }),
    };
    const onFontReadyRevision = vi.fn();
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({
      canvasFactory: recording.factory,
      onFontReadyRevision,
    });

    generator.generate({ doc, ticket: ticket(3), maximumTextureSizePx: 256 });
    generator.generate({ doc, ticket: ticket(4), maximumTextureSizePx: 256 });
    expect(
      recording.canvases
        .flatMap((canvas) => canvas.calls)
        .filter((call) => call.method === 'fillText'),
    ).toSatisfy((calls: CanvasCall[]) => calls.every((call) => call.globalAlpha === 1));

    firstFont.settle('ready');
    secondFont.settle('ready');
    await Promise.resolve();
    await Promise.resolve();

    expect(onFontReadyRevision).toHaveBeenCalledTimes(1);
    expect(onFontReadyRevision).toHaveBeenCalledWith(4);
    generator.close();
  });

  it('suppresses a pending font invalidation after the latest document removes that text', async () => {
    const font = controlledAttempt();
    vi.mocked(ensureFontAttempt).mockReturnValue(font.attempt);
    const onFontReadyRevision = vi.fn();
    const generator = createPreviewSurfaceMapGenerator({
      canvasFactory: recordingCanvasFactory().factory,
      onFontReadyRevision,
    });
    const layer: TextLayer = {
      id: 'removed',
      name: 'removed',
      type: 'text',
      content: 'REMOVED',
      fontFamily: 'Pending Font',
      sizeMm: 5,
      x: 2,
      y: 2,
      color: 1,
    };

    generator.generate({
      doc: { panelHp: 4, layers: createPcbLayerStack({ silkscreen: [layer] }) },
      ticket: ticket(4),
      maximumTextureSizePx: 128,
    });
    generator.generate({
      doc: { panelHp: 4, layers: createPcbLayerStack() },
      ticket: ticket(5),
      maximumTextureSizePx: 128,
    });
    font.settle('ready');
    await Promise.resolve();
    await Promise.resolve();

    expect(onFontReadyRevision).not.toHaveBeenCalled();
    generator.close();
  });

  it('invalidates once when a timed-out face becomes genuinely ready, and not after close', async () => {
    const font = controlledAttempt();
    const closedFont = controlledAttempt();
    vi.mocked(ensureFontAttempt).mockImplementation((family) =>
      family === 'Late Font' ? font.attempt : closedFont.attempt,
    );
    const layer = (id: string, fontFamily: string, y: number): TextLayer => ({
      id,
      name: id,
      type: 'text',
      content: id,
      fontFamily,
      sizeMm: 5,
      x: 2,
      y,
      color: 2,
    });
    const onFontReadyRevision = vi.fn();
    const generator = createPreviewSurfaceMapGenerator({
      canvasFactory: recordingCanvasFactory().factory,
      onFontReadyRevision,
    });
    generator.generate({
      doc: {
        panelHp: 4,
        layers: createPcbLayerStack({
          silkscreen: [layer('late', 'Late Font', 2), layer('closed', 'Closed Font', 12)],
        }),
      },
      ticket: ticket(6),
      maximumTextureSizePx: 128,
    });

    font.settle('timed-out');
    closedFont.settle('timed-out');
    await Promise.resolve();
    expect(onFontReadyRevision).not.toHaveBeenCalled();
    font.lateReady();
    await Promise.resolve();
    expect(onFontReadyRevision).toHaveBeenCalledOnce();
    expect(onFontReadyRevision).toHaveBeenCalledWith(6);

    generator.close();
    closedFont.lateReady();
    await Promise.resolve();
    expect(onFontReadyRevision).toHaveBeenCalledOnce();
  });

  it('rejects canvas factories that cannot honor the selected raster size', () => {
    const badFactory: PreviewCanvasFactory = (widthPx, heightPx) =>
      new RecordingCanvas(widthPx - 1, heightPx) as unknown as PreviewCanvasSource;
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: badFactory });

    expect(() =>
      generator.generate({
        doc: { panelHp: 4, layers: createPcbLayerStack() },
        ticket: ticket(8),
        maximumTextureSizePx: 128,
      }),
    ).toThrow('incorrectly sized canvas');
    generator.close();
  });
});

describe('fixture sanity', () => {
  it('keeps the simple overlap samples away from antialiased boundaries', () => {
    const projected = projectFlatLayers(representativeSurfaceMapDoc().layers);
    const layers = ['gold-base', 'opening-over-gold', 'white-over-black'].map((id) =>
      projected.find((layer) => layer.id === id)!,
    ) as ShapeLayer[];
    expect(layers.map((layer) => layer.color)).toEqual([1, 0, 2]);
    expect(layers.every((layer) => layer.shape === 'rect' && !layer.rotation)).toBe(true);
  });
});

// #150 regression fixture: the flat projection at the surface-map read
// boundary must make a grouped doc export EXACTLY what the equivalent flat
// doc exports — the 3D manufacturing output may not know groups exist.
describe('flat projection parity (#150)', () => {
  it('a grouped doc generates byte-identical surface maps to its flat-equivalent doc', () => {
    const rect = (id: string, x: number): ShapeLayer => ({
      id,
      name: id,
      type: 'shape',
      shape: 'rect',
      x,
      y: 10,
      width: 12,
      height: 8,
      color: 2,
    });
    const leaves = [rect('s1', 4), rect('s2', 20), rect('s3', 36)];
    const flatDoc: DocState = {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({ silkscreen: [...leaves] }),
    };
    const groupedLayers: LayerNode[] = [
      leaves[0],
      {
        kind: 'group',
        id: 'g1',
        name: 'G1',
        children: [leaves[1], { kind: 'group', id: 'g2', name: 'G2', children: [leaves[2]] }],
      },
    ];
    const groupedDoc: DocState = {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({ silkscreen: groupedLayers }),
    };

    const run = (doc: DocState) => {
      const recording = recordingCanvasFactory();
      const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
      generator.generate({
        doc,
        ticket: ticket(1),
        preferredPixelsPerMm: 2,
        maximumTextureSizePx: 512,
      });
      generator.close();
      return recording.canvases.map((canvas) => normalizedCalls(canvas));
    };

    expect(JSON.stringify(run(groupedDoc))).toBe(JSON.stringify(run(flatDoc)));
  });
});
