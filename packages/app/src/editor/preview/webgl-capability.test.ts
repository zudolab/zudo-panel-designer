// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  isPreviewWebGLAvailable,
  probePreviewWebGLCanvas,
  type PreviewWebGLProbeCanvas,
} from './webgl-capability';

function probeCanvas(webgl2: WebGL2RenderingContext | null): PreviewWebGLProbeCanvas {
  return {
    width: 8,
    height: 8,
    getContext: vi.fn(() => webgl2),
  };
}

describe('preview WebGL capability probe', () => {
  it('prefers WebGL2, releases the temporary context, and collapses its canvas', () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn(() => ({ loseContext }));
    const canvas = probeCanvas({ getExtension } as unknown as WebGL2RenderingContext);

    expect(probePreviewWebGLCanvas(canvas)).toBe(true);
    expect(canvas.getContext).toHaveBeenCalledOnce();
    expect(canvas.getContext).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({
        antialias: true,
        depth: true,
        failIfMajorPerformanceCaveat: false,
      }),
    );
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('reports deterministic unavailability without WebGL2', () => {
    const unavailable = probeCanvas(null);

    expect(probePreviewWebGLCanvas(unavailable)).toBe(false);
    expect(unavailable.getContext).toHaveBeenCalledOnce();
    expect(unavailable.getContext).toHaveBeenCalledWith('webgl2', expect.any(Object));
    expect(unavailable.width).toBe(0);
    expect(unavailable.height).toBe(0);
  });

  it('collapses the probe canvas even when context release throws', () => {
    const canvas = probeCanvas({
      getExtension: vi.fn(() => {
        throw new Error('extension failed');
      }),
    } as unknown as WebGL2RenderingContext);

    expect(probePreviewWebGLCanvas(canvas)).toBe(true);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('caches the capability so StrictMode replay does not allocate a second probe', () => {
    const loseContext = vi.fn();
    const canvas = probeCanvas({
      getExtension: vi.fn(() => ({ loseContext })),
    } as unknown as WebGL2RenderingContext);
    const factory = vi.fn(() => canvas);

    expect(isPreviewWebGLAvailable(factory)).toBe(true);
    expect(isPreviewWebGLAvailable(factory)).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
  });
});
