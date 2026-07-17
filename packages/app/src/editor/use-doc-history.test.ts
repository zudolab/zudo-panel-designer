// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocState } from '@zpd/core';
import { useDocHistory } from './use-doc-history';

const DOC_A: DocState = { panelHp: 12, guides: [], layers: [] };
const DOC_B: DocState = { panelHp: 6, guides: [], layers: [] };
const DOC_C: DocState = { panelHp: 3, guides: [], layers: [] };

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
