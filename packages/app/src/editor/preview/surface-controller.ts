import type { DocState } from '@zpd/core';
import { openPreviewGenerationSession, type PreviewSurfaceSnapshot } from './contracts';
import {
  createPreviewSurfaceMapGenerator,
  type PreviewSurfaceMapGenerator,
  type PreviewSurfaceMapGeneratorOptions,
} from './surface-maps';
import type { PreviewSceneRuntime } from './scene-runtime';

export interface PreviewSurfaceController {
  update(doc: DocState): void;
  close(): void;
}

export interface PreviewSurfaceControllerOptions {
  readonly runtime: PreviewSceneRuntime;
  readonly onReady: (snapshot: PreviewSurfaceSnapshot) => void;
  readonly onError: (error: unknown) => void;
  readonly createGenerator?: (
    options: PreviewSurfaceMapGeneratorOptions,
  ) => PreviewSurfaceMapGenerator;
}

export function createPreviewSurfaceController({
  runtime,
  onReady,
  onError,
  createGenerator = createPreviewSurfaceMapGenerator,
}: PreviewSurfaceControllerOptions): PreviewSurfaceController {
  const session = openPreviewGenerationSession(0);
  let currentDoc: DocState | null = null;
  let currentRevision = 0;
  let closed = false;
  let fontFlushQueued = false;

  const generate = (surfaceRevision: number): void => {
    if (closed || !currentDoc) return;
    const ticket = session.beginGeneration(surfaceRevision);
    try {
      const snapshot = generator.generate({
        doc: currentDoc,
        ticket,
        maximumTextureSizePx: runtime.maximumTextureSizePx,
      });
      if (!session.canPublish(ticket, snapshot)) return;
      runtime.applySnapshot(snapshot);
      onReady(snapshot);
    } catch (error) {
      if (!closed && !ticket.signal.aborted && (error as Error)?.name !== 'AbortError') {
        onError(error);
      }
    } finally {
      session.settle(ticket);
    }
  };

  const generator = createGenerator({
    onFontReadyRevision(surfaceRevision) {
      if (!session.queueFontReadyInvalidation(surfaceRevision) || fontFlushQueued) return;
      fontFlushQueued = true;
      queueMicrotask(() => {
        fontFlushQueued = false;
        const revision = session.takeFontReadyInvalidation();
        if (!closed && revision !== null && revision === currentRevision) generate(revision);
      });
    },
  });

  return Object.freeze({
    update(doc: DocState) {
      if (closed || doc === currentDoc) return;
      currentDoc = doc;
      currentRevision += 1;
      generate(currentRevision);
    },
    close() {
      if (closed) return;
      closed = true;
      currentDoc = null;
      session.close();
      generator.close();
    },
  });
}
