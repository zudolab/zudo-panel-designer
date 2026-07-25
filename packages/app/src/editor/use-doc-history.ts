// React binding over @zpd/core's undo/redo reducer. The core module is the
// single source of the history semantics (full-state snapshots, gesture = one
// entry); this hook only wires those pure functions into a useReducer so the
// app has no duplicate history logic to keep in sync.
import { useCallback, useReducer, useRef } from 'react';
import {
  abortGesture as coreAbortGesture,
  beginGesture as coreBeginGesture,
  canRedo as coreCanRedo,
  canUndo as coreCanUndo,
  commit as coreCommit,
  createHistory,
  redo as coreRedo,
  replace as coreReplace,
  reset as coreReset,
  undo as coreUndo,
  type DocState,
  type HistoryState,
} from '@zpd/core';

type Action =
  | { type: 'commit'; state: DocState }
  | { type: 'replace'; state: DocState }
  | { type: 'reset'; state: DocState }
  | { type: 'beginGesture' }
  | { type: 'abortGesture' }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: HistoryState<DocState>, action: Action): HistoryState<DocState> {
  switch (action.type) {
    case 'commit':
      return coreCommit(state, action.state);
    case 'replace':
      return coreReplace(state, action.state);
    case 'reset':
      return coreReset(action.state);
    case 'beginGesture':
      return coreBeginGesture(state);
    case 'abortGesture':
      return coreAbortGesture(state);
    case 'undo':
      return coreUndo(state);
    case 'redo':
      return coreRedo(state);
  }
}

export interface DocHistory {
  /** Read-only live snapshot used by the test bridge to prove resource events do not mutate history. */
  history: HistoryState<DocState>;
  doc: DocState;
  canUndo: boolean;
  canRedo: boolean;
  commit(next: DocState): void;
  replace(next: DocState): void;
  // Whole-document replacement — clears past/future instead of pushing an
  // undo entry (see replace-doc.ts).
  reset(next: DocState): void;
  beginGesture(): void;
  abortGesture(): void;
  undo(): void;
  redo(): void;
  // Bumped SYNCHRONOUSLY by every mutator above, before its dispatch. `doc`
  // and Editor's docRef cannot serve that role: a dispatch only queues a React
  // update, so both still read the pre-mutation document until React renders
  // and flushes effects. An async action that resumes inside that window (a
  // lazily loaded geometry kernel finishing between a user's edit and the
  // flush) would otherwise see no change and commit a whole-document snapshot
  // built from the superseded doc, silently reverting that edit.
  //
  // Compare successive reads for INEQUALITY only — the number itself means
  // nothing, and undo/redo/abortGesture bump it without knowing their own
  // resulting document, which is exactly why it is a counter and not a hash.
  //
  // A stable reader rather than a value: the point is to read it LIVE from an
  // async continuation, and a value destructured at render time would be
  // exactly the stale snapshot this exists to defeat.
  readMutationEpoch(): number;
}

export function useDocHistory(initial: DocState): DocHistory {
  const [state, dispatch] = useReducer(reducer, initial, createHistory);
  const mutationEpoch = useRef(0);

  const commit = useCallback((next: DocState) => {
    mutationEpoch.current += 1;
    dispatch({ type: 'commit', state: next });
  }, []);
  const replace = useCallback((next: DocState) => {
    mutationEpoch.current += 1;
    dispatch({ type: 'replace', state: next });
  }, []);
  const reset = useCallback((next: DocState) => {
    mutationEpoch.current += 1;
    dispatch({ type: 'reset', state: next });
  }, []);
  const beginGesture = useCallback(() => {
    mutationEpoch.current += 1;
    dispatch({ type: 'beginGesture' });
  }, []);
  const abortGesture = useCallback(() => {
    mutationEpoch.current += 1;
    dispatch({ type: 'abortGesture' });
  }, []);
  const undo = useCallback(() => {
    mutationEpoch.current += 1;
    dispatch({ type: 'undo' });
  }, []);
  const redo = useCallback(() => {
    mutationEpoch.current += 1;
    dispatch({ type: 'redo' });
  }, []);
  const readMutationEpoch = useCallback(() => mutationEpoch.current, []);

  return {
    history: state,
    doc: state.present,
    canUndo: coreCanUndo(state),
    canRedo: coreCanRedo(state),
    commit,
    replace,
    reset,
    beginGesture,
    abortGesture,
    undo,
    redo,
    readMutationEpoch,
  };
}
