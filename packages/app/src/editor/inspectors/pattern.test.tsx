// @vitest-environment jsdom
//
// Proves the pattern inspector's slider gesture contract: a scrub is ONE undo
// entry. The gesture opens lazily (ctx.beginGesture once, on the first input),
// every intermediate input streams as a coalesced patch (commit:false), and the
// pointer release closes the gesture so the next scrub opens a fresh entry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PatternLayer, Pt } from '@zpd/core';
import type { ToolContext } from '../types';
import './pattern';
import { getInspector } from '../registry/inspectors';

afterEach(cleanup);

function stubCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    doc: { panelHp: 12, layers: [] },
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
};

const Inspector = getInspector('pattern')!;

describe('pattern inspector — slider scrub == one undo entry', () => {
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
