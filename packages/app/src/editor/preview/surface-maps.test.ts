import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PALETTE,
  PANEL_HEIGHT_MM,
  PANEL_THICKNESS_MM,
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
import {
  PCB_SURFACE_MATERIALS,
  createPreviewSurfaceMapGenerator,
  surfaceMapColorForPalette,
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
}

type CallObserver = (call: CanvasCall) => void;

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
  return canvas.calls.map((call) => ({
    ...call,
    args: call.args.map((arg) =>
      arg instanceof RecordingPath2D ? { pathCommands: arg.commands } : arg,
    ),
  }));
}

function topRectFillAt(calls: readonly CanvasCall[], x: number, y: number): string | null {
  let pendingRect: readonly number[] | null = null;
  let style: string | null = null;
  const contains = (rect: readonly number[]) =>
    x > rect[0] && x < rect[0] + rect[2] && y > rect[1] && y < rect[1] + rect[3];

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
      style = call.fillStyle;
    }
    if (call.method === 'fill' && call.args.length === 0 && pendingRect) {
      if (contains(pendingRect)) style = call.fillStyle;
      pendingRect = null;
    }
  }
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
});

describe('createPreviewSurfaceMapGenerator', () => {
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
    expect(recording.canvases).toHaveLength(3);
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

    for (const [mapName, canvas] of [
      ['baseColor', baseColor],
      ['metalness', metalness],
      ['roughness', roughness],
    ] as const) {
      expect(topRectFillAt(canvas.calls, 4, 4)).toBe(surfaceMapColorForPalette(mapName, 1));
      expect(topRectFillAt(canvas.calls, 10, 10)).toBe(surfaceMapColorForPalette(mapName, 0));
      expect(topRectFillAt(canvas.calls, 14, 14)).toBe(surfaceMapColorForPalette(mapName, 2));

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
      expect(
        canvas.calls.some(
          (call) =>
            call.method === 'fill' &&
            call.args[0] instanceof RecordingPath2D &&
            call.args[1] === 'evenodd',
        ),
      ).toBe(true);
      expect(canvas.calls.find((call) => call.method === 'stroke')?.strokeStyle).toBe(
        surfaceMapColorForPalette(mapName, 2),
      );
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
      expect(canvas.calls.some((call) => call.method === 'drawImage')).toBe(false);
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
      doc: { panelHp: 4, layers: [] },
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
      layers: [text('first', 'First Font'), text('second', 'Second Font')],
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
      doc: { panelHp: 4, layers: [layer] },
      ticket: ticket(4),
      maximumTextureSizePx: 128,
    });
    generator.generate({
      doc: { panelHp: 4, layers: [] },
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
        layers: [layer('late', 'Late Font', 2), layer('closed', 'Closed Font', 12)],
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
        doc: { panelHp: 4, layers: [] },
        ticket: ticket(8),
        maximumTextureSizePx: 128,
      }),
    ).toThrow('incorrectly sized canvas');
    generator.close();
  });
});

describe('fixture sanity', () => {
  it('keeps the simple overlap samples away from antialiased boundaries', () => {
    const layers = representativeSurfaceMapDoc().layers.slice(0, 3) as ShapeLayer[];
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
    const flatDoc: DocState = { panelHp: 12, guides: [], layers: [...leaves] };
    const groupedLayers: LayerNode[] = [
      leaves[0],
      {
        kind: 'group',
        id: 'g1',
        name: 'G1',
        children: [
          leaves[1],
          { kind: 'group', id: 'g2', name: 'G2', children: [leaves[2]] },
        ],
      },
    ];
    const groupedDoc: DocState = { panelHp: 12, guides: [], layers: groupedLayers };

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
