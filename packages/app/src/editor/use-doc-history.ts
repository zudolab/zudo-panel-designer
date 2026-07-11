// React binding over @zpd/core's undo/redo reducer. The core module is the
// single source of the history semantics (full-state snapshots, gesture = one
// entry); this hook only wires those pure functions into a useReducer so the
// app has no duplicate history logic to keep in sync.
import { useCallback, useReducer } from 'react';
import {
  beginGesture as coreBeginGesture,
  canRedo as coreCanRedo,
  canUndo as coreCanUndo,
  commit as coreCommit,
  createHistory,
  redo as coreRedo,
  replace as coreReplace,
  undo as coreUndo,
  type DocState,
  type HistoryState,
} from '@zpd/core';

type Action =
  | { type: 'commit'; state: DocState }
  | { type: 'replace'; state: DocState }
  | { type: 'beginGesture' }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: HistoryState<DocState>, action: Action): HistoryState<DocState> {
  switch (action.type) {
    case 'commit':
      return coreCommit(state, action.state);
    case 'replace':
      return coreReplace(state, action.state);
    case 'beginGesture':
      return coreBeginGesture(state);
    case 'undo':
      return coreUndo(state);
    case 'redo':
      return coreRedo(state);
  }
}

export interface DocHistory {
  doc: DocState;
  canUndo: boolean;
  canRedo: boolean;
  commit(next: DocState): void;
  replace(next: DocState): void;
  beginGesture(): void;
  undo(): void;
  redo(): void;
}

export function useDocHistory(initial: DocState): DocHistory {
  const [state, dispatch] = useReducer(reducer, initial, createHistory);

  const commit = useCallback((next: DocState) => dispatch({ type: 'commit', state: next }), []);
  const replace = useCallback((next: DocState) => dispatch({ type: 'replace', state: next }), []);
  const beginGesture = useCallback(() => dispatch({ type: 'beginGesture' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    doc: state.present,
    canUndo: coreCanUndo(state),
    canRedo: coreCanRedo(state),
    commit,
    replace,
    beginGesture,
    undo,
    redo,
  };
}
