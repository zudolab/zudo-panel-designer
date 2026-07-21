// @vitest-environment jsdom
//
// jsdom has no real <canvas> 2D context and never fires Image onload/onerror
// for a data: URL by default, so this proves the dialog mounts/wires up
// through the registry without ever reaching the canvas/tracer boundary —
// the actual tracing math is covered DOM-free in svg-to-path-layers.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImageLayer, PathLayer, Pt } from '@zpd/core';
import { bakeImageRotation } from './trace';
import { DialogHost } from '../components/dialog-host';
import { closeDialog, getDialog, openDialog } from '../registry/dialogs';
import type { CommandContext } from '../commands';
import type { ToolContext } from '../types';

afterEach(() => {
  closeDialog();
  cleanup();
});

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
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
