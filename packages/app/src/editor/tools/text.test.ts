// Proves the text tool's click-to-place contract: a single pointerDown
// inserts one TextLayer (default content/size/color, a curated default
// font) as ONE commit, then hands off to select — both the tool switch and
// the selection of the freshly placed layer. Driven directly against the
// tool's onPointerDown handler with a mocked ToolContext, same shape as the
// affordance-hooks stubCtx pattern used elsewhere in this folder.
import { describe, expect, it, vi } from 'vitest';
import './text'; // registers 'text' as a side effect
import { getTool } from '../registry/tools';
import { DEFAULT_FONT_FAMILY } from '../fonts';
import type { DocState, Pt, TextLayer } from '@zpd/core';
import type { PanelDims, ToolContext, ToolPointerEvent } from '../types';

const PANEL: PanelDims = { widthMm: 100, heightMm: 128.5 };

function stubCtx(doc: DocState): ToolContext {
  return {
    doc,
    camera: { pxPerMm: 1, offsetX: 0, offsetY: 0 },
    panel: PANEL,
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
  } as unknown as ToolContext;
}

function ptr(mm: Pt): ToolPointerEvent {
  return {
    screen: mm,
    mm,
    button: 0,
    buttons: 1,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    pointerId: 1,
    preventDefault: () => {},
  };
}

const text = getTool('text')!;

describe('text tool — click to place', () => {
  it('inserts a TextLayer at the click point, commits once, then selects it and switches to select', () => {
    const doc: DocState = { panelHp: 12, guides: [], layers: [] };
    const ctx = stubCtx(doc);

    text.onPointerDown?.(ptr({ x: 12, y: 34 }), ctx);

    expect(ctx.commit).toHaveBeenCalledTimes(1);
    const committed = vi.mocked(ctx.commit).mock.calls[0][0];
    expect(committed.layers).toHaveLength(1);

    const layer = committed.layers[0] as TextLayer;
    expect(layer.type).toBe('text');
    expect(layer.content).toBe('TEXT');
    expect(layer.sizeMm).toBe(6);
    expect(layer.color).toBe(2);
    expect(layer.fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(layer.x).toBe(12);
    expect(layer.y).toBe(34);

    expect(ctx.setActiveTool).toHaveBeenCalledWith('select');
    expect(ctx.select).toHaveBeenCalledWith(layer.id);
  });

  it('leaves any existing layers untouched, appending the new text layer on top', () => {
    const existing: TextLayer = {
      id: 'existing',
      name: 'Existing',
      type: 'text',
      content: 'ZPD',
      fontFamily: DEFAULT_FONT_FAMILY,
      sizeMm: 9,
      x: 0,
      y: 0,
      color: 2,
    };
    const doc: DocState = { panelHp: 12, guides: [], layers: [existing] };
    const ctx = stubCtx(doc);

    text.onPointerDown?.(ptr({ x: 5, y: 5 }), ctx);

    const committed = vi.mocked(ctx.commit).mock.calls[0][0];
    expect(committed.layers).toHaveLength(2);
    expect(committed.layers[0]).toBe(existing);
  });
});
