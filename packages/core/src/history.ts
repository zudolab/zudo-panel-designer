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
  // Present only between a beginGesture and whatever ends the gesture: what
  // beginGesture's internal commit() destroyed before an abort could run —
  // the pre-gesture redo branch (commit clears future) and, at the
  // MAX_HISTORY cap, the evicted oldest past entry (empty array when nothing
  // was evicted). replace() carries it through the gesture's update stream;
  // abortGesture consumes it to restore the stacks verbatim; commit / undo /
  // redo / reset all build fresh three-field states, which drops it — after
  // any of those, the gesture entry is no longer the top of past, so the
  // snapshot no longer applies.
  gestureRestore?: { future: T[]; evicted: T[] };
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
// entry opened by the most recent commit/beginGesture. The spread also
// carries beginGesture's gestureRestore snapshot through the stream, keeping
// an abort after any number of replaces able to restore the pre-gesture
// stacks.
export function replace<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return { ...state, present: next };
}

// Opens a new undo entry without changing present yet. Pair with `replace`
// calls during the gesture so one drag/resize/node-edit gesture = exactly
// one undo entry, regardless of how many intermediate updates it produces.
export function beginGesture<T>(state: HistoryState<T>): HistoryState<T> {
  // Same as committing the current present onto itself: it opens one undo entry
  // without changing present, and inherits the MAX_HISTORY cap from commit().
  // That commit is destructive in two ways an abort must be able to reverse
  // (a cancelled gesture is not a completed edit): it clears any redo branch,
  // and at the MAX_HISTORY cap it evicts the oldest past entry — so both are
  // snapshotted onto the returned state for abortGesture to restore.
  return {
    ...commit(state, state.present),
    gestureRestore: {
      future: state.future,
      evicted: state.past.length >= MAX_HISTORY ? [state.past[0]] : [],
    },
  };
}

// Cancels an open gesture (Escape): pops the past entry beginGesture pushed,
// restores present from it (discarding the whole replace stream), and — via
// the gestureRestore snapshot beginGesture recorded — reinstates the redo
// branch and any MAX_HISTORY-evicted past entry that beginGesture's internal
// commit() destroyed. The exact inverse of beginGesture: the pre-gesture
// stacks come back verbatim, so Escape leaves no undo/redo residue. A
// trailing `replace(state, baseline)` would instead leave that pushed past
// entry standing as a phantom no-op undo step; this removes it outright.
// No-op when no gesture is open (past is empty — nothing to pop). Without a
// snapshot (state built outside beginGesture, or a commit/undo/redo landed
// since and dropped it), only the one popped past entry changes.
export function abortGesture<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state;
  const baseline = state.past[state.past.length - 1];
  const popped = state.past.slice(0, -1);
  const restore = state.gestureRestore;
  if (!restore) {
    return { past: popped, present: baseline, future: state.future };
  }
  return {
    past: [...restore.evicted, ...popped],
    present: baseline,
    future: restore.future,
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

// Replaces present and CLEARS past/future — unlike commit (pushes present
// onto past) and replace (leaves the stacks untouched), neither of which can
// discard history. For New-panel and import-replace, where the previous
// document's undo/redo history is not meaningful for the new one.
export function reset<T>(next: T): HistoryState<T> {
  return { past: [], present: next, future: [] };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
