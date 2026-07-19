export interface PreviewWebGLProbeCanvas {
  width: number;
  height: number;
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

export type PreviewWebGLProbeCanvasFactory = () => PreviewWebGLProbeCanvas;

// A successful probe is stable for the page lifetime and avoids allocating a
// second temporary context during StrictMode replay. Negative probes are not
// cached: context pressure or a transient factory failure may recover before
// the user opens the preview again.
let cachedCapability: true | null = null;

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
  if (cachedCapability === true) return true;
  if (typeof document === 'undefined') return false;

  try {
    if (probePreviewWebGLCanvas(canvasFactory())) {
      cachedCapability = true;
      return true;
    }
  } catch {
    // A later call may succeed after a transient allocation/factory failure.
  }
  return false;
}
