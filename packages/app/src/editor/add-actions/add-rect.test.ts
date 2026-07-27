// @vitest-environment jsdom
//
// Proves add-rect's #191 wiring: with nothing selected it keeps the exact
// pre-#191 behavior (append at the top of Copper); with a selection it lands
// directly above the selected object, following that object's own container.
import { describe, expect, it, vi } from 'vitest';
import './add-rect'; // registers 'add-rect' as a side effect
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
    activeSide: 'front',
    get activeStack() {
      return (this as unknown as ToolContext).doc.layers;
    },
  } as unknown as ToolContext;
}

function getAddRectAction() {
  return allAddActions().find((a) => a.id === 'add-rect')!;
}

describe('add-rect action — nothing selected (#191 default routing)', () => {
  it('appends a new rect at the top of Copper and selects it, matching pre-#191 behavior', () => {
    const existing: ShapeLayer = {
      id: 'existing',
      name: 'existing',
      type: 'shape',
      shape: 'rect',
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

    getAddRectAction().run(ctx);

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    const layers = projectFlatLayers(committed.layers);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toBe(existing);
    expect(layers[1]).toMatchObject({ type: 'shape', shape: 'rect', color: 1 });
    expect(ctx.select).toHaveBeenCalledWith(layers[1].id);
  });
});

describe('add-rect action — selection-relative placement (#191)', () => {
  it('lands the new rect directly above a selected solder-mask object, inside solder-mask', () => {
    const anchor: ShapeLayer = {
      id: 'sm-anchor',
      name: 'sm-anchor',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: 0,
    };
    const ctx = stubCtx({
      doc: {
        ...createDefaultDoc(),
        panelHp: 12,
        guides: [],
        layers: createPcbLayerStack({ 'solder-mask': [anchor] }),
      },
      selectedIds: ['sm-anchor'],
    });

    getAddRectAction().run(ctx);

    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(committed.layers[1].children.map((n) => n.id)).toEqual([
      'sm-anchor',
      expect.stringMatching(/^shape-/),
    ]);
    // Material follows the destination container, not the tool's own default.
    const added = projectFlatLayers(committed.layers).find((l) => l.id !== 'sm-anchor')!;
    expect(added).toMatchObject({ color: 0 });
    expect(ctx.select).toHaveBeenCalledWith(added.id);
  });

  it('anchors to the visually topmost maximal root across a multi-container selection', () => {
    const copperAnchor: ShapeLayer = {
      id: 'cu-anchor',
      name: 'cu-anchor',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: 1,
    };
    const silkscreenAnchor: ShapeLayer = {
      id: 'sk-anchor',
      name: 'sk-anchor',
      type: 'shape',
      shape: 'rect',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: 2,
    };
    const ctx = stubCtx({
      doc: {
        ...createDefaultDoc(),
        panelHp: 12,
        guides: [],
        layers: createPcbLayerStack({ copper: [copperAnchor], silkscreen: [silkscreenAnchor] }),
      },
      // Silkscreen sits above copper in stack/paint order — the topmost
      // maximal root of this selection is 'sk-anchor', not 'cu-anchor'.
      selectedIds: ['cu-anchor', 'sk-anchor'],
    });

    getAddRectAction().run(ctx);

    const committed = (ctx.commit as ReturnType<typeof vi.fn>).mock.calls[0][0] as DocState;
    expect(committed.layers[0].children.map((n) => n.id)).toEqual(['cu-anchor']); // copper untouched
    expect(committed.layers[2].children.map((n) => n.id)).toEqual([
      'sk-anchor',
      expect.stringMatching(/^shape-/),
    ]);
  });
});

// The refusal contract itself (both the anchored insert and the defaultRole
// fallback returning the SAME reference -> commit/select nothing) is proven
// exhaustively against the shared helper directly in insert-relative.test.ts
// -- not re-derived here through mintId collisions, which would need a
// module-mock too fragile to keep in sync with every call site.
