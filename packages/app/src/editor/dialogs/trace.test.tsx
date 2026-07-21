// @vitest-environment jsdom
//
// jsdom has no real <canvas> 2D context and never fires Image onload/onerror
// for a data: URL by default, so this proves the dialog mounts/wires up
// through the registry without ever reaching the canvas/tracer boundary —
// the actual tracing math is covered DOM-free in svg-to-path-layers.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocState, GroupNode, ImageLayer, PathLayer, Pt } from '@zpd/core';
import { bakeImageRotation, insertTracedPaths } from './trace';
import { DialogHost } from '../components/dialog-host';
import { closeDialog, getDialog, openDialog } from '../registry/dialogs';
import type { CommandContext } from '../commands';
import type { ToolContext } from '../types';
import { projectFlatLayers } from '../flat-projection';

afterEach(() => {
  closeDialog();
  cleanup();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const ctx = {
    doc: { panelHp: 12, guides: [], layers: [] },
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
  // Live flat view over whatever doc the stub ended up with (non-enumerable
  // so object spreads never snapshot it).
  Object.defineProperty(ctx, 'flatLayers', {
    get: () => projectFlatLayers(ctx.doc.layers),
  });
  return ctx;
}

const IMAGE_LAYER: ImageLayer = {
  id: 'img-1',
  name: 'Reference',
  type: 'image',
  src: 'data:image/png;base64,AAAA',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
};

// #147: bakeImageRotation is the pure step that makes a rotated image's
// traced vectors match what the user sees on canvas — svgToPathLayers only
// knows the image's UNROTATED bbox, so this rotates the freshly traced points
// (and bezier handles) about the same bbox center paintLayer rotates the
// raster around. Exercised directly (no DOM/canvas) since jsdom never
// decodes the source Image() to drive the dialog's real Apply flow — see the
// header comment above.
describe('bakeImageRotation (#147)', () => {
  // 20x10 image at (10,20) — bbox center (20,25).
  const rotatedLayer: ImageLayer = {
    id: 'img-1',
    name: 'Reference',
    type: 'image',
    src: 'data:,',
    x: 10,
    y: 20,
    width: 20,
    height: 10,
    rotation: 90,
  };

  it('is a no-op when the image has no rotation', () => {
    const traced: PathLayer[] = [
      {
        id: 'trace-1',
        name: 'trace-1',
        type: 'path',
        points: [{ x: 10, y: 20 }],
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0,
      },
    ];
    const unrotated: ImageLayer = { ...rotatedLayer, rotation: undefined };
    expect(bakeImageRotation(traced, unrotated)).toBe(traced); // same reference — true no-op
  });

  it('rotates anchor points 90deg cw about the image bbox center', () => {
    const traced: PathLayer[] = [
      {
        id: 'trace-1',
        name: 'trace-1',
        type: 'path',
        // top-left corner of the bbox (10,20); rotating 90deg cw about (20,25)
        // lands at (25,15) — same convention as core's rotatePoint/
        // rotatedRectAABB (bbox.ts).
        points: [{ x: 10, y: 20 }],
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0,
      },
    ];
    const [rotated] = bakeImageRotation(traced, rotatedLayer);
    expect(rotated.points[0].x).toBeCloseTo(25);
    expect(rotated.points[0].y).toBeCloseTo(15);
  });

  it('rotates bezier handles (hin/hout) along with their anchor', () => {
    const traced: PathLayer[] = [
      {
        id: 'trace-1',
        name: 'trace-1',
        type: 'path',
        points: [{ x: 10, y: 20, hin: { x: 8, y: 20 }, hout: { x: 12, y: 20 } }],
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0,
      },
    ];
    const [rotated] = bakeImageRotation(traced, rotatedLayer);
    // (8,20) about (20,25) -> (25,13); (12,20) about (20,25) -> (25,17)
    expect(rotated.points[0].hin!.x).toBeCloseTo(25);
    expect(rotated.points[0].hin!.y).toBeCloseTo(13);
    expect(rotated.points[0].hout!.x).toBeCloseTo(25);
    expect(rotated.points[0].hout!.y).toBeCloseTo(17);
  });

  it('rotates every point in extraSubpaths too (holes/islands stay aligned)', () => {
    const traced: PathLayer[] = [
      {
        id: 'trace-1',
        name: 'trace-1',
        type: 'path',
        points: [{ x: 10, y: 20 }],
        extraSubpaths: [[{ x: 10, y: 20 }]],
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0,
      },
    ];
    const [rotated] = bakeImageRotation(traced, rotatedLayer);
    expect(rotated.extraSubpaths![0][0].x).toBeCloseTo(25);
    expect(rotated.extraSubpaths![0][0].y).toBeCloseTo(15);
  });

  it('rotates every traced layer (one per color region)', () => {
    const traced: PathLayer[] = [
      {
        id: 'trace-1',
        name: 'trace-1',
        type: 'path',
        points: [{ x: 10, y: 20 }],
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0,
      },
      {
        id: 'trace-2',
        name: 'trace-2',
        type: 'path',
        points: [{ x: 30, y: 20 }],
        closed: true,
        fill: 2,
        stroke: null,
        strokeWidth: 0,
      },
    ];
    const rotated = bakeImageRotation(traced, rotatedLayer);
    expect(rotated).toHaveLength(2);
    expect(rotated[0].points[0].x).toBeCloseTo(25);
    expect(rotated[0].points[0].y).toBeCloseTo(15);
    // (30,20) about (20,25) rotated 90deg cw -> (25,35)
    expect(rotated[1].points[0].x).toBeCloseTo(25);
    expect(rotated[1].points[0].y).toBeCloseTo(35);
  });
});

describe('trace dialog', () => {
  it('registers itself under id "trace"', () => {
    expect(getDialog('trace')).toBeDefined();
  });

  it('mounts against a real image layer without crashing', () => {
    const ctx = stubCtx({ doc: { panelHp: 12, guides: [], layers: [IMAGE_LAYER] } });
    const Dialog = getDialog('trace')!.component;
    render(<Dialog props={{ layerId: 'img-1' }} close={vi.fn()} ctx={ctx} />);

    expect(screen.getByText('Convert image to vectors')).toBeTruthy();
    // no traced preview yet — the source Image() never decodes in jsdom
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('shows a fallback + Close when the layer id no longer exists, without crashing', () => {
    const ctx = stubCtx({ doc: { panelHp: 12, guides: [], layers: [] } });
    const Dialog = getDialog('trace')!.component;
    const close = vi.fn();
    render(<Dialog props={{ layerId: 'missing' }} close={close} ctx={ctx} />);

    expect(screen.getByText(/no longer exists/)).toBeTruthy();
    fireEvent.click(screen.getByText('Close'));
    expect(close).toHaveBeenCalled();
  });

  it.each([
    ['an existing image', [IMAGE_LAYER], 'img-1'],
    ['a missing image', [], 'missing'],
  ])('is named through DialogHost for %s', (_label, layers, layerId) => {
    const ctx = stubCtx({ doc: { panelHp: 12, guides: [], layers } });
    render(<DialogHost ctx={ctx as CommandContext} />);

    act(() => openDialog('trace', { layerId }));

    expect(screen.getByRole('dialog', { name: 'Convert image to vectors' })).toBeTruthy();
  });
});

// #150: the apply step must splice the traced vectors BESIDE the source image
// within its CURRENT parent — nested images included — instead of the old
// root-array findIndex/slice, which mangled the root for a nested source.
describe('insertTracedPaths (#150)', () => {
  const tracedPath = (id: string): PathLayer => ({
    id,
    name: id,
    type: 'path',
    points: [],
    closed: true,
    fill: 1,
    stroke: null,
    strokeWidth: 0,
  });

  it('hides the source and inserts the traced paths directly above it at the root', () => {
    const below = { ...IMAGE_LAYER, id: 'below' };
    const above = { ...IMAGE_LAYER, id: 'above' };
    const doc: DocState = { panelHp: 12, guides: [], layers: [below, IMAGE_LAYER, above] };
    const next = insertTracedPaths(doc, IMAGE_LAYER, [tracedPath('p1'), tracedPath('p2')]);
    expect(next.layers.map((l) => l.id)).toEqual(['below', 'img-1', 'p1', 'p2', 'above']);
    expect((next.layers[1] as ImageLayer).hidden).toBe(true);
    // untouched siblings keep identity
    expect(next.layers[0]).toBe(below);
    expect(next.layers[4]).toBe(above);
  });

  it('inserts beside a group-nested image within its parent, leaving the root intact', () => {
    const sibling = { ...IMAGE_LAYER, id: 'sibling' };
    const rootLayer = { ...IMAGE_LAYER, id: 'root-layer' };
    const doc: DocState = {
      panelHp: 12,
      guides: [],
      layers: [
        rootLayer,
        {
          kind: 'group',
          id: 'outer',
          name: 'outer',
          children: [
            { kind: 'group', id: 'inner', name: 'inner', children: [IMAGE_LAYER, sibling] },
          ],
        },
      ],
    };
    const next = insertTracedPaths(doc, IMAGE_LAYER, [tracedPath('p1')]);
    expect(next.layers[0]).toBe(rootLayer);
    const outer = next.layers[1] as GroupNode;
    expect(outer.kind).toBe('group');
    const inner = outer.children[0] as GroupNode;
    expect(inner.children.map((l) => l.id)).toEqual(['img-1', 'p1', 'sibling']);
    expect((inner.children[0] as ImageLayer).hidden).toBe(true);
    expect(inner.children[2]).toBe(sibling);
  });
});
