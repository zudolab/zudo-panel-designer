import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultDoc,
  createPcbLayerStack,
  PALETTE,
  PANEL_THICKNESS_MM,
  PCB_SUBSTRATE,
  PCB_SUBSTRATE_ALUMI,
  panelHeightMm,
  panelHoles,
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
import {
  peekTextGeometry,
  resetTextGeometryForTests,
  setTextMeasureForTests,
} from '../text-geometry';
import {
  openPreviewGenerationSession,
  type PreviewCanvasSource,
  type PreviewGenerationTicket,
} from './contracts';
import { representativeSurfaceMapDoc } from './surface-maps.fixtures';
import { projectFlatLayers } from '../flat-projection';
import {
  PCB_SUBSTRATE_SURFACE_MATERIAL,
  PCB_SUBSTRATE_SURFACE_MATERIALS,
  PCB_SURFACE_MATERIALS,
  PREVIEW_HEIGHT_COPPER_COLOR,
  PREVIEW_HEIGHT_MASK_COLOR,
  createPreviewSurfaceMapGenerator,
  surfaceMapColorForPalette,
  surfaceMapSubstrateColor,
  type PreviewCanvasFactory,
  type PreviewSurfaceGenerationInput,
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

function docPick(
  overrides: Partial<PreviewSurfaceGenerationInput['doc']> = {},
): PreviewSurfaceGenerationInput['doc'] {
  return {
    panelHp: 4,
    format: '3U',
    material: 'fr4',
    layers: createPcbLayerStack(),
    backLayers: createPcbLayerStack('back'),
    ...overrides,
  };
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

// Point-in-fill for an arc-built subpath (the screw-hole stadium tracer):
// polygonizes each recorded clockwise arc in draw order — canvas auto-connects
// consecutive arcs with lines — and runs the same crossing test as
// pathContains.
function arcPathContains(arcs: ReadonlyArray<readonly number[]>, x: number, y: number): boolean {
  const points: Array<readonly [number, number]> = [];
  for (const [cx, cy, radius, startAngle, endAngle] of arcs) {
    const sweepEnd = endAngle < startAngle ? endAngle + Math.PI * 2 : endAngle;
    const steps = 64;
    for (let step = 0; step <= steps; step += 1) {
      const angle = startAngle + ((sweepEnd - startAngle) * step) / steps;
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Replays a canvas call log at one sample point, modeling the negative-mask
// composite: `apply` receives the style of every covering paint — or null for
// a destination-out punch that erases the point — plus the composite
// operation the paint landed under (the height map adds its mask sheet via
// 'lighter'). Mask-sheet drawImage calls recurse into the sheet's own log,
// truncated to calls issued before the composite (the shared sheet is
// re-filled and re-punched per map).
function replayStyleAt(
  calls: readonly CanvasCall[],
  x: number,
  y: number,
  apply: (style: string | null, compositeOperation: string) => void,
): void {
  let pendingRect: readonly number[] | null = null;
  let pendingArcs: Array<readonly number[]> = [];
  const contains = (rect: readonly number[]) =>
    x > rect[0] && x < rect[0] + rect[2] && y > rect[1] && y < rect[1] + rect[3];
  const applyCall = (call: CanvasCall): void => {
    apply(
      call.globalCompositeOperation === 'destination-out' ? null : call.fillStyle,
      call.globalCompositeOperation,
    );
  };
  for (const call of calls) {
    if (call.method === 'beginPath') {
      pendingRect = null;
      pendingArcs = [];
    }
    if (call.method === 'rect' && call.args.every((arg) => typeof arg === 'number')) {
      pendingRect = call.args as number[];
    }
    if (call.method === 'arc' && call.args.slice(0, 5).every((arg) => typeof arg === 'number')) {
      pendingArcs.push(call.args.slice(0, 5) as number[]);
    }
    if (
      call.method === 'fillRect' &&
      call.args.every((arg) => typeof arg === 'number') &&
      contains(call.args as number[])
    ) {
      applyCall(call);
    }
    if (call.method === 'fill' && call.args.length === 0 && pendingArcs.length > 0) {
      if (arcPathContains(pendingArcs, x, y)) applyCall(call);
      pendingArcs = [];
      pendingRect = null;
    } else if (call.method === 'fill' && call.args.length === 0 && pendingRect) {
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
      if (sheetStyle !== null) apply(sheetStyle, call.globalCompositeOperation);
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

function grayLevel(style: string): number {
  return Number.parseInt(style.slice(1, 3), 16) / 255;
}

// Models the height map's additive composite at one point: a source-over
// paint replaces the accumulated level, a 'lighter' composite adds to it.
function heightLevelAt(calls: readonly CanvasCall[], x: number, y: number): number {
  let level = 0;
  replayStyleAt(calls, x, y, (style, compositeOperation) => {
    if (style === null) return;
    level =
      compositeOperation === 'lighter' ? Math.min(1, level + grayLevel(style)) : grayLevel(style);
  });
  return level;
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
    // FR-4 regression pin (#232): the fr4 entry IS the pre-material-aware
    // constant, so existing documents cannot drift.
    expect(PCB_SUBSTRATE_SURFACE_MATERIALS.fr4).toBe(PCB_SUBSTRATE_SURFACE_MATERIAL);
    expect(surfaceMapSubstrateColor('baseColor', 'fr4')).toBe(PCB_SUBSTRATE.hex);
    expect(surfaceMapSubstrateColor('metalness', 'fr4')).toBe('#000000');
    expect(surfaceMapSubstrateColor('roughness', 'fr4')).toBe('#8c8c8c');
  });

  it('gives alumi a shining-gray substrate fed from the shared core constant', () => {
    expect(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi).toMatchObject({
      baseColor: PCB_SUBSTRATE_ALUMI.hex,
      metalness: 1,
    });
    // "Shining gray": full metalness, clearly lower roughness than every
    // non-metal surface in the palette so the aluminum reads polished.
    expect(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi.roughness).toBeLessThanOrEqual(0.25);
    expect(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi.roughness).toBeLessThan(
      PCB_SUBSTRATE_SURFACE_MATERIAL.roughness,
    );
    expect(Object.isFrozen(PCB_SUBSTRATE_SURFACE_MATERIALS)).toBe(true);
    expect(Object.isFrozen(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi)).toBe(true);
    expect(surfaceMapSubstrateColor('baseColor', 'alumi')).toBe(PCB_SUBSTRATE_ALUMI.hex);
    expect(surfaceMapSubstrateColor('metalness', 'alumi')).toBe('#ffffff');
    expect(surfaceMapSubstrateColor('roughness', 'alumi')).toBe('#333333');
  });
});

describe('createPreviewSurfaceMapGenerator', () => {
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
      doc: docPick({ panelHp: 8, layers: stack }),
      ticket: ticket(21),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });
    generator.close();
    return snapshot;
  };

  it('composes fixed materials identically across base color and scalar maps', () => {
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
        ? surfaceMapSubstrateColor(mapName, 'fr4')
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

  it('encodes the combined top surface additively in the height map', () => {
    const copperLevel = grayLevel(PREVIEW_HEIGHT_COPPER_COLOR);
    const maskLevel = grayLevel(PREVIEW_HEIGHT_MASK_COLOR);
    const visible = generate();
    const heightCanvas = visible.maps.height.source as unknown as RecordingCanvas;

    // The four physical levels order strictly: substrate < mask-only <
    // open copper < mask-over-copper (epic #176 pinned semantics).
    const substrate = heightLevelAt(heightCanvas.calls, 28, 12); // opening over nothing
    const maskOnly = heightLevelAt(heightCanvas.calls, 36, 40); // covered, no copper
    const openCopper = heightLevelAt(heightCanvas.calls, 10, 4); // opening over copper
    const maskOverCopper = heightLevelAt(heightCanvas.calls, 4, 4); // un-punched mask over copper
    expect(substrate).toBe(0);
    expect(maskOnly).toBeCloseTo(maskLevel, 10);
    expect(openCopper).toBeCloseTo(copperLevel, 10);
    expect(maskOverCopper).toBeCloseTo(copperLevel + maskLevel, 10);
    expect(substrate).toBeLessThan(maskOnly);
    expect(maskOnly).toBeLessThan(openCopper);
    expect(openCopper).toBeLessThan(maskOverCopper);
    // The even-odd hole re-masks: mask thickness returns on top of copper.
    expect(heightLevelAt(heightCanvas.calls, 14, 8)).toBeCloseTo(copperLevel + maskLevel, 10);
    // Silkscreen ink never adds height, even where it paints in other maps.
    expect(heightLevelAt(heightCanvas.calls, 26, 4)).toBe(0);

    // Exactly one sheet composite, and it is additive.
    const drawImageCalls = heightCanvas.calls.filter((call) => call.method === 'drawImage');
    expect(drawImageCalls).toHaveLength(1);
    expect(drawImageCalls[0]!.globalCompositeOperation).toBe('lighter');

    // Hidden mask container: no sheet, so no mask thickness anywhere.
    const maskHidden = generate({ mask: true });
    const maskHiddenCanvas = maskHidden.maps.height.source as unknown as RecordingCanvas;
    expect(maskHiddenCanvas.calls.some((call) => call.method === 'drawImage')).toBe(false);
    expect(heightLevelAt(maskHiddenCanvas.calls, 4, 4)).toBeCloseTo(copperLevel, 10);
    expect(heightLevelAt(maskHiddenCanvas.calls, 36, 40)).toBe(0);
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
      heightMm: panelHeightMm(doc.format),
      thicknessMm: PANEL_THICKNESS_MM,
    });
    expect(snapshot.rasterSize.widthPx).toBeLessThanOrEqual(256);
    expect(snapshot.rasterSize.heightPx).toBeLessThanOrEqual(256);
    expect(snapshot.rasterSize.widthPx / snapshot.rasterSize.heightPx).toBeCloseTo(
      panelWidthMm(doc.panelHp) / panelHeightMm(doc.format),
      2,
    );
    expect(snapshot.orientation.documentTopLeftUv).toEqual({ u: 0, v: 1 });
    expect(snapshot.backOrientation.documentTopLeftUv).toEqual({ u: 1, v: 1 });
    expect(snapshot.material).toBe('fr4');
    // The golden screw-hole catalog rides along for the hole-cutting
    // consumer (#234), derived from (format, hp), never stored.
    expect(snapshot.holes).toEqual(panelHoles(doc.format, doc.panelHp));
    expect(snapshot.backMaps).not.toBeNull();
    // Two four-map faces plus the one shared mask sheet, all at the raster.
    expect(recording.canvases).toHaveLength(9);
    expect(recording.canvases.every((canvas) => canvas.width === snapshot.rasterSize.widthPx)).toBe(
      true,
    );
    expect(
      recording.canvases.every((canvas) => canvas.height === snapshot.rasterSize.heightPx),
    ).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    generator.close();
  });

  it('derives the panel height from the document format', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc: docPick({ format: '1U' }),
      ticket: ticket(2),
      maximumTextureSizePx: 256,
    });

    expect(panelHeightMm('1U')).toBe(39.65);
    expect(snapshot.physicalDimensions.heightMm).toBe(panelHeightMm('1U'));
    expect(snapshot.holes).toEqual(panelHoles('1U', 4));
    generator.close();
  });

  it('paints the back map set from the back stack in canonical coordinates', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc: docPick({
        panelHp: 8,
        backLayers: createPcbLayerStack('back', {
          copper: [
            {
              id: 'back-copper',
              name: 'Back copper',
              type: 'shape',
              shape: 'rect',
              x: 2,
              y: 2,
              width: 20,
              height: 20,
              color: 1,
            },
          ],
          'solder-mask': [
            {
              id: 'back-opening',
              name: 'Back opening',
              type: 'shape',
              shape: 'rect',
              x: 8,
              y: 8,
              width: 8,
              height: 8,
              color: 0,
            },
          ],
        }),
      }),
      ticket: ticket(3),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });

    for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
      const frontCanvas = snapshot.maps[mapName].source as unknown as RecordingCanvas;
      const backCanvas = snapshot.backMaps![mapName].source as unknown as RecordingCanvas;
      expect(backCanvas).not.toBe(frontCanvas);
      // The back opening reveals the back copper at its CANONICAL x — the
      // canvases stay in canonical front-view coords; the display-side x
      // mirror lives in the sampling contract, never in the paint.
      expect(topMaterialAt(backCanvas.calls, 10, 10)).toBe(surfaceMapColorForPalette(mapName, 1));
      // Outside the opening the back stack's mask sheet still covers.
      expect(topMaterialAt(backCanvas.calls, 4, 4)).toBe(surfaceMapColorForPalette(mapName, 0));
      // The front face has no artwork at all in this doc: fully covered by
      // its own sheet at both sample points.
      expect(topMaterialAt(frontCanvas.calls, 10, 10)).toBe(surfaceMapColorForPalette(mapName, 0));
    }
    // Inside the back opening the mask is punched away: copper height only.
    const backHeight = snapshot.backMaps!.height.source as unknown as RecordingCanvas;
    expect(heightLevelAt(backHeight.calls, 10, 10)).toBeCloseTo(
      grayLevel(PREVIEW_HEIGHT_COPPER_COLOR),
      10,
    );
    // Outside it the back copper raises the field under the draping mask.
    expect(heightLevelAt(backHeight.calls, 4, 4)).toBeCloseTo(
      grayLevel(PREVIEW_HEIGHT_COPPER_COLOR) + grayLevel(PREVIEW_HEIGHT_MASK_COLOR),
      10,
    );
    const frontHeight = snapshot.maps.height.source as unknown as RecordingCanvas;
    expect(heightLevelAt(frontHeight.calls, 10, 10)).toBeCloseTo(
      grayLevel(PREVIEW_HEIGHT_MASK_COLOR),
      10,
    );
    generator.close();
  });

  it('reconciles both faces as one text-geometry snapshot so pivots survive regeneration', () => {
    const rotated = (id: string, y: number): TextLayer => ({
      id,
      name: id,
      type: 'text',
      content: id,
      fontFamily: 'Fixture Sans',
      sizeMm: 5,
      x: 4,
      y,
      rotation: 30,
      color: 2,
    });
    const doc = docPick({
      layers: createPcbLayerStack({ silkscreen: [rotated('front-rotated', 10)] }),
      backLayers: createPcbLayerStack('back', { silkscreen: [rotated('back-rotated', 20)] }),
    });
    const generator = createPreviewSurfaceMapGenerator({
      canvasFactory: recordingCanvasFactory().factory,
    });

    generator.generate({ doc, ticket: ticket(1), maximumTextureSizePx: 128 });
    const front = peekTextGeometry('front-rotated');
    const back = peekTextGeometry('back-rotated');
    expect(front).not.toBeNull();
    expect(back).not.toBeNull();

    // A same-document regeneration (e.g. font readiness) must reuse BOTH
    // faces' captured rotation pivots: reconciling the faces as separate
    // single-document snapshots would evict each other's entries and remint
    // the metrics every pass.
    generator.generate({ doc, ticket: ticket(2), maximumTextureSizePx: 128 });
    expect(peekTextGeometry('front-rotated')?.metricRevision).toBe(front!.metricRevision);
    expect(peekTextGeometry('back-rotated')?.metricRevision).toBe(back!.metricRevision);
    generator.close();
  });

  it('skips the back map set entirely for alumi and bakes its shining substrate into the front', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc: docPick({ material: 'alumi' }),
      ticket: ticket(4),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });

    expect(snapshot.material).toBe('alumi');
    expect(snapshot.backMaps).toBeNull();
    // One four-map face plus the shared mask sheet — no back canvases.
    expect(recording.canvases).toHaveLength(5);

    // Hide the mask to expose bare substrate everywhere: the alumi
    // coefficients (metalness 1, low roughness) reach the maps.
    const hiddenMaskStack = createPcbLayerStack();
    hiddenMaskStack[1] = { ...hiddenMaskStack[1], hidden: true };
    const exposed = generator.generate({
      doc: docPick({ material: 'alumi', layers: hiddenMaskStack }),
      ticket: ticket(5),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });
    for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
      const canvas = exposed.maps[mapName].source as unknown as RecordingCanvas;
      expect(topMaterialAt(canvas.calls, 10, 10)).toBe(surfaceMapSubstrateColor(mapName, 'alumi'));
    }
    generator.close();
  });

  it('punches the screw-hole openings and lays the FR-4 copper ring on both faces', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc: docPick(),
      ticket: ticket(31),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });

    // 3U/4hp catalog: top slot at (6.045, 3), bottom at (13.955, 125.5),
    // opening 4.0 × 11.08 around a 3.2 drill. Ring samples sit inside the
    // opening but outside the drill; the drill interior carries the same
    // copper underlay (the geometry cuts those texels out of sampling).
    const holes = panelHoles('3U', 4);
    expect(holes).toHaveLength(2);
    const samples = holes.map((hole) => ({
      ring: [hole.cx, hole.cy - hole.drillDiameter / 2 - 0.2] as const,
      drill: [hole.cx, hole.cy] as const,
    }));
    const covered = [holes[0].cx, holes[0].cy + 5] as const;

    for (const face of [snapshot.maps, snapshot.backMaps!]) {
      for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
        const canvas = face[mapName].source as unknown as RecordingCanvas;
        for (const sample of samples) {
          expect(topMaterialAt(canvas.calls, ...sample.ring)).toBe(
            surfaceMapColorForPalette(mapName, 1),
          );
          expect(topMaterialAt(canvas.calls, ...sample.drill)).toBe(
            surfaceMapColorForPalette(mapName, 1),
          );
        }
        expect(topMaterialAt(canvas.calls, ...covered)).toBe(surfaceMapColorForPalette(mapName, 0));
      }
      // The ring reads as bare copper in the height field too: real copper
      // thickness with the mask sheet punched away above it.
      const heightCanvas = face.height.source as unknown as RecordingCanvas;
      expect(heightLevelAt(heightCanvas.calls, ...samples[0].ring)).toBeCloseTo(
        grayLevel(PREVIEW_HEIGHT_COPPER_COLOR),
        10,
      );
      expect(heightLevelAt(heightCanvas.calls, ...covered)).toBeCloseTo(
        grayLevel(PREVIEW_HEIGHT_MASK_COLOR),
        10,
      );
    }
    generator.close();
  });

  it('exposes the shining substrate in alumi screw-hole rings with no copper underlay', () => {
    const recording = recordingCanvasFactory();
    const generator = createPreviewSurfaceMapGenerator({ canvasFactory: recording.factory });
    const snapshot = generator.generate({
      doc: docPick({ material: 'alumi' }),
      ticket: ticket(32),
      preferredPixelsPerMm: 1,
      maximumTextureSizePx: 512,
    });

    const [topHole] = panelHoles('3U', 4);
    const ring = [topHole.cx, topHole.cy - topHole.drillDiameter / 2 - 0.2] as const;
    const covered = [topHole.cx, topHole.cy + 5] as const;
    expect(snapshot.backMaps).toBeNull();
    for (const mapName of ['baseColor', 'metalness', 'roughness'] as const) {
      const canvas = snapshot.maps[mapName].source as unknown as RecordingCanvas;
      // NPTH (epic decision 11): the opening exposes bare aluminum, never a
      // copper ring.
      expect(topMaterialAt(canvas.calls, ...ring)).toBe(surfaceMapSubstrateColor(mapName, 'alumi'));
      expect(topMaterialAt(canvas.calls, ...covered)).toBe(surfaceMapColorForPalette(mapName, 0));
    }
    const heightCanvas = snapshot.maps.height.source as unknown as RecordingCanvas;
    expect(heightLevelAt(heightCanvas.calls, ...ring)).toBe(0);
    expect(heightLevelAt(heightCanvas.calls, ...covered)).toBeCloseTo(
      grayLevel(PREVIEW_HEIGHT_MASK_COLOR),
      10,
    );
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
    const height = snapshot.maps.height.source as unknown as RecordingCanvas;
    const maskSheet = recording.canvases.find(
      (canvas) =>
        canvas !== baseColor && canvas !== metalness && canvas !== roughness && canvas !== height,
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
          call.args[3] === panelHeightMm(doc.format),
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

    // The shared sheet is re-filled with each map's soldermask value (the
    // height map fills in its mask thickness value) and punched under
    // destination-out: the fixture's path opening keeps its even-odd holes
    // and its stroke erases alpha too.
    const materialMapNames = ['baseColor', 'metalness', 'roughness'] as const;
    const sheetFillStyles = [
      ...materialMapNames.map((mapName) => surfaceMapColorForPalette(mapName, 0)),
      PREVIEW_HEIGHT_MASK_COLOR,
    ];
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
    // The same shared sheet is re-filled for the back face's four maps too:
    // the fixture's empty-but-visible back mask container still composites a
    // full covering sheet per map (#232).
    expect(sheetBackgroundFills.map((call) => call.fillStyle)).toEqual([
      ...sheetFillStyles,
      ...sheetFillStyles,
    ]);
    expect(
      sheetBackgroundFills.every((call) => call.globalCompositeOperation === 'source-over'),
    ).toBe(true);
    const sheetStrokes = maskSheet.calls.filter((call) => call.method === 'stroke');
    // Punch strokes stay front-only: the back stack has no stroked mask leaf.
    expect(sheetStrokes.map((call) => call.strokeStyle)).toEqual(sheetFillStyles);
    expect(sheetStrokes.every((call) => call.globalCompositeOperation === 'destination-out')).toBe(
      true,
    );
    expect(maskSheet.calls.some((call) => call.method === 'drawImage')).toBe(false);

    // One copper-pattern resolution per generated map, height included.
    expect(patternByName).toHaveBeenCalledTimes(4);
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
      doc: docPick(),
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
    const doc = docPick({
      layers: createPcbLayerStack({
        silkscreen: [text('first', 'First Font'), text('second', 'Second Font')],
      }),
    });
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
      doc: docPick({ layers: createPcbLayerStack({ silkscreen: [layer] }) }),
      ticket: ticket(4),
      maximumTextureSizePx: 128,
    });
    generator.generate({
      doc: docPick(),
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
      doc: docPick({
        layers: createPcbLayerStack({
          silkscreen: [layer('late', 'Late Font', 2), layer('closed', 'Closed Font', 12)],
        }),
      }),
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
        doc: docPick(),
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
      ...createDefaultDoc(),
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
      ...createDefaultDoc(),
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
