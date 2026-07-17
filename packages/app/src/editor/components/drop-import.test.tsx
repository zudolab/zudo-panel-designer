// @vitest-environment jsdom
//
// jsdom (as pinned in this repo) does not implement DragEvent/DataTransfer at
// all, so drag events are hand-built plain Events with a `dataTransfer`
// property attached via defineProperty (see makeDragEvent below) — the
// handlers under test only ever read e.dataTransfer/e.relatedTarget and call
// e.preventDefault(), all of which a plain Event supports.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { importDroppedFile } from '../import';
import type { ToolContext } from '../types';
import { DropImport } from './drop-import';

vi.mock('../import', () => ({ importDroppedFile: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function stubCtx(): ToolContext {
  return {} as ToolContext;
}

function makeDragEvent(
  type: string,
  opts: { files?: File[]; relatedTarget?: EventTarget | null; noFiles?: boolean } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const files = opts.files ?? [];
  const dataTransfer = {
    types: opts.noFiles ? ['text/plain'] : ['Files'],
    files,
    dropEffect: 'none',
  };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true });
  Object.defineProperty(event, 'relatedTarget', {
    value: opts.relatedTarget ?? null,
    configurable: true,
  });
  return event;
}

function overlay() {
  return screen.queryByText('Drop image or panel JSON');
}

// document.dispatchEvent() bypasses RTL's fireEvent (which auto-wraps in
// act()), so the resulting setState calls need an explicit act() to flush
// synchronously before the assertion that follows.
function dispatch(event: Event) {
  act(() => {
    document.dispatchEvent(event);
  });
}

describe('DropImport', () => {
  it('shows the overlay on a file dragenter', () => {
    render(<DropImport ctx={stubCtx()} />);
    expect(overlay()).toBeNull();

    dispatch(makeDragEvent('dragenter', { files: [] }));

    expect(overlay()).not.toBeNull();
  });

  it('ignores a non-file drag (no "Files" in dataTransfer.types)', () => {
    render(<DropImport ctx={stubCtx()} />);

    dispatch(makeDragEvent('dragenter', { noFiles: true }));

    expect(overlay()).toBeNull();
  });

  it('balances nested dragenter/dragleave so a child-element leave does not flicker the overlay off', () => {
    render(<DropImport ctx={stubCtx()} />);

    // Cursor enters the page (1), then a nested child element (2).
    dispatch(makeDragEvent('dragenter'));
    dispatch(makeDragEvent('dragenter'));
    expect(overlay()).not.toBeNull();

    // Leaving the nested child (relatedTarget = some element, not null) only
    // balances the counter to 1 — the overlay must stay visible.
    dispatch(makeDragEvent('dragleave', { relatedTarget: document.body }));
    expect(overlay()).not.toBeNull();

    // Leaving the outer element back to the page (still relatedTarget !=
    // null) balances the counter to 0 — now it hides.
    dispatch(makeDragEvent('dragleave', { relatedTarget: document.body }));
    expect(overlay()).toBeNull();
  });

  it('resets immediately when the cursor exits the browser window (relatedTarget === null)', () => {
    render(<DropImport ctx={stubCtx()} />);

    dispatch(makeDragEvent('dragenter'));
    dispatch(makeDragEvent('dragenter'));
    expect(overlay()).not.toBeNull();

    dispatch(makeDragEvent('dragleave', { relatedTarget: null }));
    expect(overlay()).toBeNull();

    // A subsequent unbalanced dragleave must not go negative and get stuck —
    // the next dragenter should still show the overlay from a clean count.
    dispatch(makeDragEvent('dragenter'));
    expect(overlay()).not.toBeNull();
  });

  it('dispatches only the first dropped file and hides the overlay', async () => {
    const ctx = stubCtx();
    render(<DropImport ctx={ctx} />);
    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });

    dispatch(makeDragEvent('dragenter', { files: [fileA, fileB] }));
    expect(overlay()).not.toBeNull();

    dispatch(makeDragEvent('drop', { files: [fileA, fileB] }));

    expect(overlay()).toBeNull();
    await waitFor(() => expect(importDroppedFile).toHaveBeenCalledTimes(1));
    expect(importDroppedFile).toHaveBeenCalledWith(fileA, ctx);
  });

  it('does not dispatch when a drop carries no files', () => {
    render(<DropImport ctx={stubCtx()} />);

    dispatch(makeDragEvent('drop', { files: [] }));

    expect(importDroppedFile).not.toHaveBeenCalled();
  });

  it('resets the enter counter on drop so a later drag starts clean', () => {
    render(<DropImport ctx={stubCtx()} />);

    dispatch(makeDragEvent('dragenter'));
    dispatch(makeDragEvent('dragenter'));
    dispatch(makeDragEvent('drop', { files: [] }));
    expect(overlay()).toBeNull();

    // A single dragenter after a drop should show the overlay (count was
    // reset to 0, not left at 1 from the unbalanced double-enter above).
    dispatch(makeDragEvent('dragenter'));
    expect(overlay()).not.toBeNull();
  });
});
