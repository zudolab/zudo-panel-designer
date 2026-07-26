// @vitest-environment jsdom
//
// Mirrors add-rect.test.ts's #191 coverage for add-ellipse — same shared
// insertNewNodeRelativeToSelection wiring, just the other shape kind.
import { describe, expect, it, vi } from 'vitest';
import './add-ellipse'; // registers 'add-ellipse' as a side effect
import {
  createDefaultDoc,
  createPcbLayerStack,
  type DocState,
  type Pt,
  type ShapeLayer,
} from '@zpd/core';
import { allAddActions } from '../registry/add-actions';
import { projectFlatLayers } from '../flat-projection';
import type { ToolContext } from '../types';

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: createPcbLayerStack() },
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: { widthMm: 60, heightMm: 128.5 },
    selectedIds: [],
    selectedId: null,
    selectedLayer: null,
    toMm: (p: Pt) => p,
    toScreen: (p: Pt) => p,
    commit: vi.fn(),
    replace: vi.fn(),
    beginGesture: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    select: vi.fn(),
    selectIds: vi.fn(),
    setCamera: vi.fn(),
    setActiveTool: vi.fn(),
    requestRepaint: vi.fn(),
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
}

function getAddEllipseAction() {
  return allAddActions().find((a) => a.id === 'add-ellipse')!;
}

describe('add-ellipse action — nothing selected (#191 default routing)', () => {
  it('appends a new ellipse at the top of Copper and selects it, matching pre-#191 behavior', () => {
    const existing: ShapeLayer = {
      id: 'existing',
      name: 'existing',
      type: 'shape',
      shape: 'ellipse',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: 1,
    };
    const ctx = stubCtx({
      doc: {
        ...createDefaultDoc(),
        panelHp: 12,
        guides: [],
        layers: createPcbLayerStack({ copper: [existing] }),
      },
    });

    getAddEllipseAction().run(ctx);

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    const layers = projectFlatLayers(committed.layers);
    expect(layers).toHaveLength(2);
    expect(layers[1]).toMatchObject({ type: 'shape', shape: 'ellipse', color: 1 });
    expect(ctx.select).toHaveBeenCalledWith(layers[1].id);
  });
});

describe('add-ellipse action — selection-relative placement (#191)', () => {
  it('lands the new ellipse directly above a selected silkscreen object, inside silkscreen', () => {
    const anchor: ShapeLayer = {
      id: 'sk-anchor',
      name: 'sk-anchor',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: 2,
    };
    const ctx = stubCtx({
      doc: {
        ...createDefaultDoc(),
        panelHp: 12,
        guides: [],
        layers: createPcbLayerStack({ silkscreen: [anchor] }),
      },
      selectedIds: ['sk-anchor'],
    });

    getAddEllipseAction().run(ctx);

    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(committed.layers[2].children.map((n) => n.id)).toEqual([
      'sk-anchor',
      expect.stringMatching(/^shape-/),
    ]);
    const added = projectFlatLayers(committed.layers).find((l) => l.id !== 'sk-anchor')!;
    expect(added).toMatchObject({ shape: 'ellipse', color: 2 });
    expect(ctx.select).toHaveBeenCalledWith(added.id);
  });
});
