// Recording Canvas 2D stubs for the Vitest suite. Plain Node has no real Canvas,
// so `draw` and `renderPatternThumb` are exercised against these no-op mocks that
// record every call, letting tests assert "drew without throwing" + call counts.

export interface CtxCall {
  method: string;
  args: unknown[];
}

export type MockCtx = CanvasRenderingContext2D & { calls: CtxCall[] };

export function createMockCtx(): MockCtx {
  const calls: CtxCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  const ctx = {
    calls,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    arcTo: record('arcTo'),
    ellipse: record('ellipse'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    rotate: record('rotate'),
    setLineDash: record('setLineDash'),
    setTransform: record('setTransform'),
    bezierCurveTo: record('bezierCurveTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
  };
  return ctx as unknown as MockCtx;
}

export type MockCanvas = HTMLCanvasElement & { ctx: MockCtx | null };

// A canvas stub whose getContext returns a recording ctx (or null when
// `nullCtx` is set, to exercise the renderer's missing-context guard).
export function createMockCanvas(opts: { nullCtx?: boolean } = {}): MockCanvas {
  const ctx = opts.nullCtx ? null : createMockCtx();
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext() {
      return ctx;
    },
    ctx,
  };
  return canvas as unknown as MockCanvas;
}
