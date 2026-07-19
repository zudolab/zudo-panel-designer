import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PreviewRendererUnavailable } from './preview-status';
import { createPreviewSceneRuntime, type PreviewSceneRuntime } from './scene-runtime';
import {
  createPreviewSurfaceController,
  type PreviewSurfaceController,
  type PreviewSurfaceControllerOptions,
} from './surface-controller';
import { isPreviewWebGLAvailable } from './webgl-capability';
import type { PreviewViewerProps } from './viewer-types';

type PreviewViewerState = 'preparing' | 'ready' | 'fallback' | 'error';

export interface PreviewViewerDependencies {
  readonly isWebGLAvailable: () => boolean;
  readonly createRuntime: typeof createPreviewSceneRuntime;
  readonly createSurfaceController: (
    options: PreviewSurfaceControllerOptions,
  ) => PreviewSurfaceController;
}

const DEFAULT_DEPENDENCIES: PreviewViewerDependencies = Object.freeze({
  isWebGLAvailable: isPreviewWebGLAvailable,
  createRuntime: createPreviewSceneRuntime,
  createSurfaceController: createPreviewSurfaceController,
});

export function PreviewViewerWithDependencies({
  doc,
  dimensions,
  onCameraControlsChange,
  dependencies,
}: PreviewViewerProps & { readonly dependencies: PreviewViewerDependencies }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceControllerRef = useRef<PreviewSurfaceController | null>(null);
  const [initialDimensions] = useState(dimensions);
  const [state, setState] = useState<PreviewViewerState>('preparing');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let runtime: PreviewSceneRuntime | null = null;
    let surfaceController: PreviewSurfaceController | null = null;
    let resourcesDisposed = false;
    const setViewerState = (nextState: PreviewViewerState): void => {
      queueMicrotask(() => {
        if (active) setState(nextState);
      });
    };

    const disposeResources = (): void => {
      if (resourcesDisposed) return;
      resourcesDisposed = true;
      const ownedSurfaceController = surfaceController;
      surfaceController = null;
      surfaceControllerRef.current = null;
      const ownedRuntime = runtime;
      runtime = null;
      // The eager shell must stop calling the camera before controls, canvas,
      // and the renderer are torn down.
      for (const teardown of [
        () => ownedSurfaceController?.close(),
        () => onCameraControlsChange(null),
        () => ownedRuntime?.dispose(),
      ]) {
        try {
          teardown();
        } catch {
          // Continue through renderer teardown if an upstream owner fails.
        }
      }
    };

    setViewerState('preparing');
    onCameraControlsChange(null);
    if (!dependencies.isWebGLAvailable()) {
      setViewerState('fallback');
      return disposeResources;
    }

    try {
      runtime = dependencies.createRuntime({
        container,
        dimensions: initialDimensions,
      });
      surfaceController = dependencies.createSurfaceController({
        runtime,
        onReady() {
          setViewerState('ready');
        },
        onError() {
          if (!active) return;
          disposeResources();
          setViewerState('error');
        },
      });
      surfaceControllerRef.current = surfaceController;
      onCameraControlsChange(runtime.cameraControls);
    } catch {
      disposeResources();
      setViewerState('error');
    }

    return () => {
      active = false;
      disposeResources();
    };
  }, [dependencies, initialDimensions, onCameraControlsChange]);

  useEffect(() => {
    surfaceControllerRef.current?.update(doc);
  }, [doc]);

  return (
    <div
      ref={containerRef}
      data-preview-state={state}
      className="relative flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden"
    >
      {state === 'preparing' && (
        <div role="status" aria-live="polite" className="absolute inset-x-6 z-10 text-center">
          <p className="text-sm font-medium text-neutral-100">Preparing PCB surface…</p>
          <p className="mt-2 text-xs text-neutral-400">
            Building the manufactured finish and lighting.
          </p>
        </div>
      )}
      {state === 'fallback' && (
        <PreviewRendererUnavailable detail="WebGL 2 is unavailable on this browser or device." />
      )}
      {state === 'error' && (
        <PreviewRendererUnavailable detail="The 3D renderer could not prepare this preview." />
      )}
    </div>
  );
}

export default function PreviewViewer(props: PreviewViewerProps) {
  return <PreviewViewerWithDependencies {...props} dependencies={DEFAULT_DEPENDENCIES} />;
}
