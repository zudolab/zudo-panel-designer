// React-free undo/redo reducer over full-state snapshots of T (the doc
// state). Modeled on _temp-resource/1-panel-designer-proto/src/history.ts
// (which wraps this same reducer shape in a useReducer) and pgen's
// use-composer-history, but kept as plain functions here so @zpd/core has no
// React dependency — the app wave wires these into whatever state container
// it uses.
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const MAX_HISTORY = 50;

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

// Pushes the current present onto past as a new undo entry, then sets next
// as the present. Any redo branch is discarded.
export function commit<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY),
    present: next,
    future: [],
  };
}

// Updates present in place without creating a new undo entry — for coalescing
// continuous, in-flight updates (e.g. every pointermove of a drag) into the
// entry opened by the most recent commit/beginGesture.
export function replace<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return { ...state, present: next };
}

// Opens a new undo entry without changing present yet. Pair with `replace`
// calls during the gesture so one drag/resize/node-edit gesture = exactly
// one undo entry, regardless of how many intermediate updates it produces.
export function beginGesture<T>(state: HistoryState<T>): HistoryState<T> {
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY),
    present: state.present,
    future: [],
  };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  const prev = state.past[state.past.length - 1];
  if (prev === undefined) return state;
  return {
    past: state.past.slice(0, -1),
    present: prev,
    future: [state.present, ...state.future],
  };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  const next = state.future[0];
  if (next === undefined) return state;
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
