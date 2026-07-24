// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createPcbLayerStack, type DocState, type HistoryState, type ShapeLayer } from '@zpd/core';
import { createPreviewDebugPublisher } from './preview/debug-state';
import type { PreviewDebugSummary } from './preview/contracts';
import { installTestBridge } from './test-bridge';

afterEach(() => {
  delete window.__zpdTest;
});

describe('preview test bridge', () => {
  it('exposes only frozen read-only preview observations and returns zero after close', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
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
      materialParameters: {
        metalness: 1,
        roughness: 0.24,
        environmentIntensity: 1.35,
        bumpScale: 0.3,
      },
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
    expect(window.__zpdTest?.fingerprintPreviewSurface('baseColor')).toBeNull();

    publisher.clear();
    expect(window.__zpdTest?.getPreview()).toMatchObject({
      surfaceRevision: null,
      sceneInstanceCount: 0,
      activeCanvasCount: 0,
    });
  });
});

describe('layer tree bridge (#150)', () => {
  const shape = (id: string, hidden?: boolean): ShapeLayer => ({
    id,
    name: id,
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    color: 1,
    ...(hidden ? { hidden } : {}),
  });

  it('getLayers folds ancestor-hidden, getLayerTree keeps raw structure, getLayerCount counts leaves', () => {
    const doc: DocState = {
      panelHp: 12,
      guides: [],
      layers: createPcbLayerStack({
        copper: [
          shape('a'),
          {
            kind: 'group',
            id: 'g',
            name: 'G',
            hidden: true,
            children: [shape('b'), { kind: 'group', id: 'g2', name: 'G2', children: [shape('c')] }],
          },
        ],
      }),
    };
    const history = { past: [], present: doc, future: [] } as HistoryState<DocState>;
    installTestBridge({
      getDoc: () => doc,
      getHistory: () => history,
      getSelectedId: () => null,
      getSelectedIds: () => [],
      getCamera: () => null,
    });

    // flat leaf view: DFS order, ancestor-hidden folded down
    expect(window.__zpdTest?.getLayers()).toEqual([
      { id: 'a', type: 'shape', name: 'a', hidden: false },
      { id: 'b', type: 'shape', name: 'b', hidden: true },
      { id: 'c', type: 'shape', name: 'c', hidden: true },
    ]);
    expect(window.__zpdTest?.getLayerCount()).toBe(3);
    expect(window.__zpdTest?.getMaterialLayer('a')).toMatchObject({ material: 'copper', color: 1 });
    expect(Object.isFrozen(window.__zpdTest?.getMaterialLayer('a'))).toBe(true);

    // structural view: each node's OWN hidden flag, groups preserved
    expect(window.__zpdTest?.getLayerTree()).toEqual([
      { kind: 'layer', id: 'a', type: 'shape', name: 'a', hidden: false },
      {
        kind: 'group',
        id: 'g',
        name: 'G',
        hidden: true,
        children: [
          { kind: 'layer', id: 'b', type: 'shape', name: 'b', hidden: false },
          {
            kind: 'group',
            id: 'g2',
            name: 'G2',
            hidden: false,
            children: [{ kind: 'layer', id: 'c', type: 'shape', name: 'c', hidden: false }],
          },
        ],
      },
    ]);
  });
});
