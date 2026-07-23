// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createPcbLayerStack, type DocState } from '@zpd/core';
import { useDocHistory } from './use-doc-history';

const DOC_A: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };
const DOC_B: DocState = { panelHp: 6, guides: [], layers: createPcbLayerStack() };
const DOC_C: DocState = { panelHp: 3, guides: [], layers: createPcbLayerStack() };

describe('useDocHistory — reset (#69)', () => {
  it('swaps present to the next doc without pushing an undo entry', () => {
    const { result } = renderHook(() => useDocHistory(DOC_A));

    act(() => result.current.commit(DOC_B));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.reset(DOC_C));
    expect(result.current.doc).toBe(DOC_C);
    // unlike commit, reset does not open an undo entry for the swap
    expect(result.current.canUndo).toBe(false);
  });

  it('clears BOTH past and future — no undo/redo can reach the pre-reset document', () => {
    const { result } = renderHook(() => useDocHistory(DOC_A));

    act(() => result.current.commit(DOC_B));
    act(() => result.current.undo()); // present=A, future=[B]
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.reset(DOC_C));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    expect(result.current.doc).toBe(DOC_C); // undo is a no-op, nothing to reach
  });
});

describe('useDocHistory — abortGesture (#157)', () => {
  it('cancels an open gesture: pops the pushed entry and restores present, zero residue', () => {
    const { result } = renderHook(() => useDocHistory(DOC_A));

    act(() => result.current.commit(DOC_B));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.beginGesture());
    act(() => result.current.replace(DOC_C));
    expect(result.current.doc).toBe(DOC_C);

    act(() => result.current.abortGesture());
    expect(result.current.doc).toBe(DOC_B); // restored to the pre-gesture baseline
    expect(result.current.canUndo).toBe(true); // the commit(DOC_B) entry is untouched
    act(() => result.current.undo());
    expect(result.current.doc).toBe(DOC_A); // exactly one undo entry remains, not two
  });

  it('is a no-op with no open gesture', () => {
    const { result } = renderHook(() => useDocHistory(DOC_A));
    act(() => result.current.abortGesture());
    expect(result.current.doc).toBe(DOC_A);
    expect(result.current.canUndo).toBe(false);
  });
});
