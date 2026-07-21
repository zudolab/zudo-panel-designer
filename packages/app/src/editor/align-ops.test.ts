// @vitest-environment jsdom
//
// minCount's selection-reference thresholds are the SAME constants core's
// align.ts uses (finding #8) — this locks them together so the app side can't
// silently re-hardcode 2/3 and drift from core's alignLayers/distributeLayers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flattenLayerNodes,
  MIN_ALIGN_SELECTION,
  MIN_DISTRIBUTE_SELECTION,
  type DocState,
  type TextLayer,
} from '@zpd/core';
import { applyAlign, layerAlignRect, minCount } from './align-ops';
import {
  reconcileTextGeometry,
  resetTextGeometryForTests,
  setTextMeasureForTests,
} from './text-geometry';
import type { ToolContext } from './types';
import { projectFlatLayers } from './flat-projection';

afterEach(() => resetTextGeometryForTests());

describe('minCount thresholds come from core', () => {
  it('selection reference uses core MIN_ALIGN_SELECTION / MIN_DISTRIBUTE_SELECTION', () => {
    expect(minCount('align', 'selection')).toBe(MIN_ALIGN_SELECTION);
    expect(minCount('distribute', 'selection')).toBe(MIN_DISTRIBUTE_SELECTION);
  });

  it('the shared values are unchanged (align 2+, distribute 3+)', () => {
    expect(MIN_ALIGN_SELECTION).toBe(2);
    expect(MIN_DISTRIBUTE_SELECTION).toBe(3);
  });

  it('panel reference still works from a single layer', () => {
    expect(minCount('align', 'panel')).toBe(1);
    expect(minCount('distribute', 'panel')).toBe(1);
  });
});

describe('rotated text uses canonical loaded bounds for alignment (#111)', () => {
  it('matches the numeric oracle: center-h dx=20, then middle-v dy=20', () => {
    resetTextGeometryForTests();
    setTextMeasureForTests((layer) => ({
      x: layer.x,
      y: layer.y,
      width: 60,
      height: 20,
    }));
    const text: TextLayer = {
      id: 'text-align',
      name: 'Text',
      type: 'text',
      content: 'AAAAA\nBB',
      fontFamily: 'sans-serif',
      sizeMm: 8,
      // This is the oracle's recentered B1 raw origin.
      x: 0,
      y: 20,
      rotation: 90,
      color: 1,
    };
    let doc: DocState = { panelHp: 20, guides: [], layers: [text] };
    const commit = vi.fn((next: DocState) => {
      doc = next;
    });
    const ctx = {
      get doc() {
        return doc;
      },
      get flatLayers() {
        return projectFlatLayers(doc.layers);
      },
      panel: { widthMm: 100, heightMm: 100 },
      commit,
      requestRepaint: vi.fn(),
    } as unknown as ToolContext;

    reconcileTextGeometry(flattenLayerNodes(doc.layers));
    const aligned = layerAlignRect(text);
    expect(aligned.id).toBe(text.id);
    expect(aligned.x).toBeCloseTo(20);
    expect(aligned.y).toBeCloseTo(0);
    expect(aligned.w).toBeCloseTo(20);
    expect(aligned.h).toBeCloseTo(60);

    applyAlign(ctx, [text.id], 'center-h', 'panel');
    expect((doc.layers[0] as TextLayer).x).toBe(20);
    expect((doc.layers[0] as TextLayer).y).toBe(20);

    applyAlign(ctx, [text.id], 'middle-v', 'panel');
    expect((doc.layers[0] as TextLayer).x).toBe(20);
    expect((doc.layers[0] as TextLayer).y).toBe(40);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
