// Reducer-owned document state with undo/redo, modeled on pgen's
// use-composer-history (full-state snapshots, gesture = one history entry).
import { useCallback, useReducer } from 'react';
import type { DocState } from './types';

interface HistoryState {
  past: DocState[];
  present: DocState;
  future: DocState[];
}

type HistoryAction =
  | { type: 'commit'; state: DocState }
  | { type: 'replace'; state: DocState }
  | { type: 'beginGesture' }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_HISTORY = 50;

function reducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'commit':
      return {
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: action.state,
        future: [],
      };
    case 'replace':
      return { ...state, present: action.state };
    case 'beginGesture':
      return {
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        present: state.present,
        future: [],
      };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}

export function useDocHistory(initial: DocState) {
  const [state, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
  });

  const commit = useCallback((next: DocState) => dispatch({ type: 'commit', state: next }), []);
  const replace = useCallback((next: DocState) => dispatch({ type: 'replace', state: next }), []);
  const beginGesture = useCallback(() => dispatch({ type: 'beginGesture' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    doc: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    replace,
    beginGesture,
    undo,
    redo,
  };
}
