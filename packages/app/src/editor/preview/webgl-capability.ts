export interface PreviewWebGLProbeCanvas {
  width: number;
  height: number;
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

export type PreviewWebGLProbeCanvasFactory = () => PreviewWebGLProbeCanvas;

let cachedCapability: boolean | null = null;

export function probePreviewWebGLCanvas(canvas: PreviewWebGLProbeCanvas): boolean {
  const options: WebGLContextAttributes = {
    alpha: false,
    antialias: true,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false,
  };
  // Three r185's WebGLRenderer is WebGL2-only, so a WebGL1 context must not
  // pass this probe and then fail during real renderer construction.
  try {
    const context = canvas.getContext('webgl2', options);
    if (!context) return false;
    try {
      context.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Context availability is already known; release best-effort must not
      // turn a supported browser into a false negative.
    }
    return true;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function isPreviewWebGLAvailable(
  canvasFactory: PreviewWebGLProbeCanvasFactory = () => document.createElement('canvas'),
): boolean {
  if (cachedCapability !== null) return cachedCapability;
  if (typeof document === 'undefined') return (cachedCapability = false);

  try {
    cachedCapability = probePreviewWebGLCanvas(canvasFactory());
  } catch {
    cachedCapability = false;
  }
  return cachedCapability;
}
