import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from 'react';
import type { DocState } from '@zpd/core';
import {
  createPreviewAccessibilityCopy,
  type PreviewCameraControls,
  type PreviewPhysicalDimensions,
} from './contracts';
import { loadPreviewViewer } from './load-viewer';
export { PreviewRendererUnavailable } from './preview-status';
import type { PreviewViewerLoader, PreviewViewerModule } from './viewer-types';

export const PREVIEW_PANEL_THICKNESS_MM = 2.5;

const CAMERA_BUTTON_CLASS =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-white/25 bg-neutral-900/90 px-3 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors [@media(hover:hover)]:hover:bg-neutral-700/95 active:bg-neutral-600/95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40';

function CameraButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`${CAMERA_BUTTON_CLASS} ${className}`} {...props} />;
}

export function PreviewCameraControlGroup({
  controls,
}: {
  readonly controls: PreviewCameraControls | null;
}) {
  const [panMode, setPanMode] = useState(false);

  // Pan is shell-owned so it survives a renderer/API replacement. Applying
  // through an effect also initializes every newly ready API to the retained
  // state rather than assuming the viewer's internal default.
  useEffect(() => {
    controls?.setPanMode(panMode);
  }, [controls, panMode]);

  const disabled = controls === null;

  return (
    <div
      role="group"
      aria-label="3D preview camera controls"
      className="absolute right-3 bottom-3 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-2 rounded-lg border border-white/20 bg-neutral-950/85 p-2 shadow-xl backdrop-blur-sm"
    >
      <CameraButton
        aria-label="Zoom in 3D preview"
        title="Zoom in 3D preview"
        disabled={disabled}
        onClick={() => controls?.dollyBy(0.8)}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
      </CameraButton>
      <CameraButton
        aria-label="Zoom out 3D preview"
        title="Zoom out 3D preview"
        disabled={disabled}
        onClick={() => controls?.dollyBy(1.25)}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          −
        </span>
      </CameraButton>
      <CameraButton
        aria-label="Pan 3D preview"
        title="Pan 3D preview"
        aria-pressed={panMode}
        disabled={disabled}
        className={panMode ? 'border-amber-300 bg-amber-400/25 text-amber-100' : ''}
        onClick={() => setPanMode((enabled) => !enabled)}
      >
        Pan
      </CameraButton>
      <CameraButton
        aria-label="Reset 3D preview view"
        title="Reset 3D preview view"
        disabled={disabled}
        onClick={() => controls?.resetView()}
      >
        Reset
      </CameraButton>
    </div>
  );
}

type ViewerLoadResult =
  | {
      readonly kind: 'ready';
      readonly attempt: number;
      readonly loader: PreviewViewerLoader;
      readonly module: PreviewViewerModule;
    }
  | {
      readonly kind: 'error';
      readonly attempt: number;
      readonly loader: PreviewViewerLoader;
    };

export function LazyPreviewViewer({
  doc,
  dimensions,
  loadViewer,
  onCameraControlsChange,
}: {
  readonly doc: DocState;
  readonly dimensions: PreviewPhysicalDimensions;
  readonly loadViewer: PreviewViewerLoader;
  readonly onCameraControlsChange: (controls: PreviewCameraControls | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loadResult, setLoadResult] = useState<ViewerLoadResult | null>(null);
  const loadState =
    loadResult?.attempt === attempt && loadResult.loader === loadViewer
      ? loadResult
      : ({ kind: 'loading' } as const);

  useEffect(() => {
    let current = true;
    onCameraControlsChange(null);

    void loadViewer().then(
      (module) => {
        if (!current) return;
        if (typeof module.default !== 'function') {
          setLoadResult({ kind: 'error', attempt, loader: loadViewer });
          return;
        }
        setLoadResult({ kind: 'ready', attempt, loader: loadViewer, module });
      },
      () => {
        if (current) setLoadResult({ kind: 'error', attempt, loader: loadViewer });
      },
    );

    return () => {
      current = false;
    };
  }, [attempt, loadViewer, onCameraControlsChange]);

  if (loadState.kind === 'loading') {
    return (
      <div role="status" aria-live="polite" className="mb-28 px-6 text-center">
        <p className="text-sm font-medium text-neutral-100">Loading 3D preview…</p>
        <p className="mt-2 text-xs text-neutral-400">Preparing the renderer and panel surface.</p>
      </div>
    );
  }

  if (loadState.kind === 'error') {
    return (
      <section
        role="alert"
        className="mb-28 w-[calc(100%-3rem)] max-w-md rounded-lg border border-red-400/40 bg-red-950/35 p-5 text-center"
      >
        <h3 className="text-base font-semibold text-red-100">Could not load the 3D preview</h3>
        <p className="mt-2 text-sm leading-relaxed text-red-100/80">
          The preview chunk failed to load. Your panel is safe, and you can retry without closing
          the editor.
        </p>
        <button
          type="button"
          className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-red-300/50 bg-red-500/20 px-4 text-sm font-semibold text-red-50 motion-safe:transition-colors [@media(hover:hover)]:hover:bg-red-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry preview
        </button>
      </section>
    );
  }

  const Viewer = loadState.module.default;
  return (
    <Viewer doc={doc} dimensions={dimensions} onCameraControlsChange={onCameraControlsChange} />
  );
}

export function PreviewShell({
  doc,
  dimensions,
  close,
  loadViewer = loadPreviewViewer,
}: {
  readonly doc: DocState;
  readonly dimensions: PreviewPhysicalDimensions;
  readonly close: () => void;
  readonly loadViewer?: PreviewViewerLoader;
}) {
  const [cameraControls, setCameraControls] = useState<PreviewCameraControls | null>(null);
  const copy = useMemo(() => createPreviewAccessibilityCopy(dimensions), [dimensions]);

  return (
    <div className="flex h-[calc(100dvh-4rem)] max-h-[56rem] min-h-0 w-[calc(100vw-4rem)] max-w-[80rem] min-w-0 flex-col">
      <div className="flex flex-none items-start gap-3 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="preview-3d-title" className="text-base font-semibold text-neutral-100">
            3D PCB preview
          </h2>
          <p id="preview-3d-summary" className="mt-1 text-xs leading-relaxed text-neutral-300">
            {copy.panelSummary}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close 3D preview"
          title="Close 3D preview"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-neutral-600 bg-neutral-800 text-xl leading-none text-neutral-100 motion-safe:transition-colors [@media(hover:hover)]:hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-inner">
        <div
          data-testid="preview-manipulation-stage"
          role="region"
          aria-label="3D PCB preview stage"
          aria-describedby="preview-3d-summary preview-3d-instructions"
          className="flex min-h-0 min-w-0 flex-1 touch-none items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgb(64_64_64),rgb(10_10_10)_70%)]"
        >
          <LazyPreviewViewer
            doc={doc}
            dimensions={dimensions}
            loadViewer={loadViewer}
            onCameraControlsChange={setCameraControls}
          />
        </div>
        <PreviewCameraControlGroup controls={cameraControls} />
      </div>

      <p
        id="preview-3d-instructions"
        className="flex-none pt-3 text-xs leading-relaxed text-neutral-300"
      >
        {copy.stageInstructions} One-finger touch rotates by default.
      </p>
    </div>
  );
}
