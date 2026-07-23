// @vitest-environment jsdom
//
// Proves the pattern inspector's slider gesture contract: a scrub is ONE undo
// entry. The gesture opens lazily (ctx.beginGesture once, on the first input),
// every intermediate input streams as a coalesced patch (commit:false), and the
// pointer release closes the gesture so the next scrub opens a fresh entry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createPcbLayerStack,
  MAX_PATTERN_SIZE_MM,
  patternCoverGeometry,
  type PatternLayer,
  type Pt,
} from '@zpd/core';
import type { ToolContext } from '../types';
import './pattern';
import { getInspector } from '../registry/inspectors';

afterEach(cleanup);

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, guides: [], layers: createPcbLayerStack({ copper: [layer] }) },
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

const layer: PatternLayer = {
  id: 'pat-1',
  name: 'Pattern',
  type: 'pattern',
  patternType: 'dot-grid',
  color: 1,
  params: {},
  x: 0,
  y: 0,
  size: 128.5,
};

const Inspector = getInspector('pattern')!;

describe('pattern inspector — slider scrub == one undo entry', () => {
  it('shows Copper as read-only material context without a color picker', () => {
    const onChange = vi.fn();
    render(<Inspector layer={layer} onChange={onChange} ctx={stubCtx()} />);

    expect(screen.getByText('Copper')).toBeTruthy();
    expect(screen.queryByText('Color')).toBeNull();
    expect(screen.queryByTitle(/gold/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the gesture once per scrub and streams every input as commit:false', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(<Inspector layer={layer} onChange={onChange} ctx={ctx} />);

    const pitch = screen.getAllByRole('slider')[0];

    // one scrub: several input events, then release
    fireEvent.change(pitch, { target: { value: '6' } });
    fireEvent.change(pitch, { target: { value: '7' } });
    fireEvent.change(pitch, { target: { value: '8' } });
    fireEvent.pointerUp(pitch);

    expect(ctx.beginGesture).toHaveBeenCalledTimes(1); // one undo entry, not per-input
    expect(onChange).toHaveBeenCalledTimes(3);
    for (const call of (onChange as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual({ commit: false }); // coalesced preview, never a commit
    }
    // a trailing commit would DOUBLE the entry on top of beginGesture's — assert
    // the inspector never commits during/after a scrub
    expect(ctx.commit).not.toHaveBeenCalled();
  });

  it('opens a fresh gesture for the next scrub after release', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(<Inspector layer={layer} onChange={onChange} ctx={ctx} />);

    const pitch = screen.getAllByRole('slider')[0];

    fireEvent.change(pitch, { target: { value: '6' } });
    fireEvent.pointerUp(pitch);
    fireEvent.change(pitch, { target: { value: '9' } });
    fireEvent.pointerUp(pitch);

    expect(ctx.beginGesture).toHaveBeenCalledTimes(2); // two distinct scrubs, two entries
  });
});

// Square geometry fields + "Cover panel" reset (#97, movable pattern square).
// NumberField commits once per discrete edit (blur/Enter) with the default
// commit:true — one undo entry each, same contract as the shape inspector.
describe('pattern inspector — x/y/size + Cover panel (#97)', () => {
  it('commits x, y, and size as discrete edits', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(<Inspector layer={layer} onChange={onChange} ctx={ctx} />);

    const xField = screen.getByLabelText('x (mm)');
    fireEvent.change(xField, { target: { value: '12' } });
    fireEvent.blur(xField);
    expect(onChange).toHaveBeenLastCalledWith({ x: 12 });

    const yField = screen.getByLabelText('y (mm)');
    fireEvent.change(yField, { target: { value: '-4.5' } });
    fireEvent.blur(yField);
    expect(onChange).toHaveBeenLastCalledWith({ y: -4.5 });

    const sizeField = screen.getByLabelText('size (mm)');
    fireEvent.change(sizeField, { target: { value: '40' } });
    fireEvent.blur(sizeField);
    expect(onChange).toHaveBeenLastCalledWith({ size: 40 });

    expect(ctx.beginGesture).not.toHaveBeenCalled(); // discrete edits, no gesture
  });

  it('clamps size into the renderer draw-guard range (0 < size <= MAX_PATTERN_SIZE_MM)', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(<Inspector layer={layer} onChange={onChange} ctx={ctx} />);

    const sizeField = screen.getByLabelText('size (mm)');
    fireEvent.change(sizeField, { target: { value: '5000' } });
    fireEvent.blur(sizeField);
    expect(onChange).toHaveBeenLastCalledWith({ size: MAX_PATTERN_SIZE_MM });

    fireEvent.change(sizeField, { target: { value: '-3' } });
    fireEvent.blur(sizeField);
    expect(onChange).toHaveBeenLastCalledWith({ size: 0.1 });
  });

  it('"Cover panel" applies patternCoverGeometry(panel) via the shared core helper, one commit', () => {
    const onChange = vi.fn();
    const ctx = stubCtx(); // panel 60 × 128.5
    render(
      <Inspector layer={{ ...layer, x: 20, y: 30, size: 12 }} onChange={onChange} ctx={ctx} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cover panel' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(patternCoverGeometry({ widthMm: 60, heightMm: 128.5 }));
  });

  // No-op guards (#97 self-review): an unchanged commit would write a phantom
  // undo entry AND wipe any redo branch (ctx.commit discards redo).
  it('"Cover panel" on a square already at cover geometry commits nothing', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    const cover = patternCoverGeometry({ widthMm: 60, heightMm: 128.5 });
    render(<Inspector layer={{ ...layer, ...cover }} onChange={onChange} ctx={ctx} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cover panel' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a size entry that clamps back to the current size commits nothing', () => {
    const onChange = vi.fn();
    const ctx = stubCtx();
    render(
      <Inspector layer={{ ...layer, size: MAX_PATTERN_SIZE_MM }} onChange={onChange} ctx={ctx} />,
    );

    const sizeField = screen.getByLabelText('size (mm)');
    fireEvent.change(sizeField, { target: { value: '5000' } }); // clamps to the max — already there
    fireEvent.blur(sizeField);
    expect(onChange).not.toHaveBeenCalled();
  });
});
