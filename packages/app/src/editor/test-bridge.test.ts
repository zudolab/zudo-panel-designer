// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { DocState, HistoryState } from '@zpd/core';
import { createPreviewDebugPublisher } from './preview/debug-state';
import type { PreviewDebugSummary } from './preview/contracts';
import { installTestBridge } from './test-bridge';

afterEach(() => {
  delete window.__zpdTest;
});

describe('preview test bridge', () => {
  it('exposes only frozen read-only preview observations and returns zero after close', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: [] };
    const history = { past: [], present: doc, future: [] } as HistoryState<DocState>;
    const publisher = createPreviewDebugPublisher();
    const summary: PreviewDebugSummary = {
      sceneInstanceCount: 1,
      activeCanvasCount: 1,
      surfaceRevision: 3,
      physicalDimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
      camera: {
        position: { x: 1, y: 2, z: 3 },
        target: { x: 0, y: 0, z: 0 },
        distance: 4,
        panModeEnabled: true,
      },
      materialParameters: { metalness: 1, roughness: 0.24, environmentIntensity: 1.35 },
    };
    publisher.publish(summary);

    installTestBridge({
      getDoc: () => doc,
      getHistory: () => history,
      getSelectedId: () => null,
      getSelectedIds: () => [],
      getCamera: () => null,
    });

    expect(window.__zpdTest?.getPreview()).toMatchObject({
      surfaceRevision: 3,
      sceneInstanceCount: 1,
      activeCanvasCount: 1,
    });
    expect(Object.isFrozen(window.__zpdTest?.getPreview())).toBe(true);
    expect(window.__zpdTest).not.toHaveProperty('setPreview');

    publisher.clear();
    expect(window.__zpdTest?.getPreview()).toMatchObject({
      surfaceRevision: null,
      sceneInstanceCount: 0,
      activeCanvasCount: 0,
    });
  });
});
