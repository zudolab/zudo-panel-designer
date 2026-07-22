import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY,
  abortGesture,
  beginGesture,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  replace,
  reset,
  undo,
} from './history';

describe('createHistory', () => {
  it('starts with empty past/future and no undo/redo available', () => {
    const state = createHistory('v0');
    expect(state).toEqual({ past: [], present: 'v0', future: [] });
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });
});

describe('commit', () => {
  it('pushes the current present onto past and sets a new present', () => {
    const s0 = createHistory('v0');
    const s1 = commit(s0, 'v1');
    expect(s1).toEqual({ past: ['v0'], present: 'v1', future: [] });
  });

  it('clears any redo branch', () => {
    const s0 = createHistory('v0');
    const s1 = commit(s0, 'v1');
    const s2 = undo(s1);
    expect(canRedo(s2)).toBe(true);
    const s3 = commit(s2, 'v2'); // branches off after an undo
    expect(s3.future).toEqual([]);
    expect(canRedo(s3)).toBe(false);
  });
});

describe('replace', () => {
  it('updates present without creating a new undo entry', () => {
    const s0 = createHistory('v0');
    const s1 = commit(s0, 'v1');
    const s2 = replace(s1, 'v1-tweaked');
    expect(s2.past).toEqual(['v0']); // unchanged — no new entry
    expect(s2.present).toBe('v1-tweaked');
  });

  it('coalesces multiple replaces into a single undo step', () => {
    let state = commit(createHistory('v0'), 'v1');
    state = replace(state, 'v1a');
    state = replace(state, 'v1b');
    state = replace(state, 'v1c');
    expect(state.past).toEqual(['v0']);
    expect(state.present).toBe('v1c');
    const afterUndo = undo(state);
    expect(afterUndo.present).toBe('v0'); // one undo skips the whole coalesced gesture
  });
});

describe('beginGesture', () => {
  it('opens a new undo entry (present unchanged) so a following gesture of replaces is exactly one entry', () => {
    const s0 = commit(createHistory('v0'), 'v1');
    const s1 = beginGesture(s0);
    expect(s1.past).toEqual(['v0', 'v1']);
    expect(s1.present).toBe('v1'); // present is unchanged by beginGesture itself

    let state = s1;
    state = replace(state, 'v1-drag-1');
    state = replace(state, 'v1-drag-2');
    state = replace(state, 'v1-drag-final');
    expect(state.past).toEqual(['v0', 'v1']); // still just the one entry opened by beginGesture

    const afterUndo = undo(state);
    expect(afterUndo.present).toBe('v1'); // the whole gesture undoes in one step
  });
});

describe('abortGesture', () => {
  it('pops the gesture entry and restores present from it, leaving future untouched', () => {
    const s0 = commit(createHistory('v0'), 'v1');
    let state = beginGesture(s0); // past=['v0','v1'], present='v1'
    state = replace(state, 'v1-drag-1');
    state = replace(state, 'v1-drag-2');

    const aborted = abortGesture(state);
    expect(aborted).toEqual({ past: ['v0'], present: 'v1', future: [] });
  });

  it('pops exactly one past entry', () => {
    const s0 = commit(createHistory('v0'), 'v1');
    const state = beginGesture(s0);
    expect(state.past).toEqual(['v0', 'v1']);
    const aborted = abortGesture(state);
    expect(aborted.past).toEqual(['v0']);
  });

  it('is a no-op when no gesture is open (past is empty)', () => {
    const state = createHistory('v0');
    expect(abortGesture(state)).toEqual(state);
  });

  it('without a gestureRestore snapshot, leaves future untouched — only the popped past entry changes', () => {
    // Constructed directly rather than via beginGesture, so there is no
    // gestureRestore snapshot to consume — the fallback path for a state
    // built outside beginGesture (or after an intervening commit/undo/redo
    // dropped the snapshot): abort must not invent or clear a future then.
    const state = { past: ['v0', 'v1'], present: 'v1-preview', future: ['v2'] };
    const aborted = abortGesture(state);
    expect(aborted).toEqual({ past: ['v0'], present: 'v1', future: ['v2'] });
  });
});

describe('undo/redo', () => {
  it('moves present back into future and pulls the last past entry forward', () => {
    let state = createHistory('v0');
    state = commit(state, 'v1');
    state = commit(state, 'v2');

    const afterUndo = undo(state);
    expect(afterUndo).toEqual({ past: ['v0'], present: 'v1', future: ['v2'] });

    const afterRedo = redo(afterUndo);
    expect(afterRedo).toEqual({ past: ['v0', 'v1'], present: 'v2', future: [] });
  });

  it('undo is a no-op at the start of history', () => {
    const state = createHistory('v0');
    expect(undo(state)).toEqual(state);
  });

  it('redo is a no-op with no redo branch', () => {
    const state = createHistory('v0');
    expect(redo(state)).toEqual(state);
  });

  it('redo replays multiple undos in the original order', () => {
    let state = createHistory('v0');
    state = commit(state, 'v1');
    state = commit(state, 'v2');
    state = commit(state, 'v3');

    state = undo(state);
    state = undo(state);
    expect(state.present).toBe('v1');

    state = redo(state);
    expect(state.present).toBe('v2');
    state = redo(state);
    expect(state.present).toBe('v3');
    expect(canRedo(state)).toBe(false);
  });
});

describe('MAX_HISTORY cap', () => {
  it('caps past at 50 entries, dropping the oldest', () => {
    let state = createHistory('v0');
    for (let i = 1; i <= 60; i += 1) {
      state = commit(state, `v${i}`);
    }
    expect(state.past.length).toBe(MAX_HISTORY);
    expect(state.past[0]).toBe('v10'); // v0..v9 dropped, oldest surviving is v10
    expect(state.past[state.past.length - 1]).toBe('v59');
    expect(state.present).toBe('v60');
  });

  it('caps past at 50 entries via beginGesture too', () => {
    let state = createHistory('v0');
    for (let i = 1; i <= 60; i += 1) {
      state = beginGesture(state);
      state = replace(state, `v${i}`);
    }
    expect(state.past.length).toBe(MAX_HISTORY);
  });
});

describe('reset', () => {
  it('replaces present and clears both past and future', () => {
    let state = createHistory('v0');
    state = commit(state, 'v1');
    state = commit(state, 'v2');
    state = undo(state); // present=v1, future=[v2], past=[v0]
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(true);

    const afterReset = reset('fresh');
    expect(afterReset).toEqual({ past: [], present: 'fresh', future: [] });
    expect(canUndo(afterReset)).toBe(false);
    expect(canRedo(afterReset)).toBe(false);
  });

  it('unlike commit/replace, discards past entries rather than preserving them', () => {
    const state = commit(createHistory('v0'), 'v1');
    expect(state.past).toEqual(['v0']); // commit keeps past
    const afterReset = reset('v2');
    expect(afterReset.past).toEqual([]); // reset clears it
  });
});

// abortGesture must be the exact inverse of beginGesture — including what
// beginGesture's internal commit() destroys BEFORE the abort ever runs: the
// redo branch (cleared on every commit) and, at the MAX_HISTORY cap, the
// evicted oldest past entry. A cancelled gesture is not a completed edit, so
// neither loss may stick.
describe('abortGesture restores what beginGesture destroyed', () => {
  it('restores the redo branch that beginGesture-after-undo cleared', () => {
    let state = createHistory('v0');
    state = commit(state, 'v1');
    state = commit(state, 'v2');
    state = undo(state); // present='v1', future=['v2']
    expect(canRedo(state)).toBe(true);

    let gesture = beginGesture(state); // commit() under the hood — future cleared here
    gesture = replace(gesture, 'v1-preview');

    const aborted = abortGesture(gesture);
    expect(aborted).toEqual({ past: ['v0'], present: 'v1', future: ['v2'] });
    expect(canRedo(aborted)).toBe(true);
    expect(redo(aborted).present).toBe('v2'); // Escape did not disable Redo
  });

  it('restores the oldest past entry evicted at the MAX_HISTORY cap', () => {
    let state = createHistory('v0');
    for (let i = 1; i <= MAX_HISTORY; i += 1) {
      state = commit(state, `v${i}`); // past is now exactly at the cap
    }
    expect(state.past.length).toBe(MAX_HISTORY);
    const oldestBefore = state.past[0];

    let gesture = beginGesture(state); // pushes present, evicting the oldest entry
    gesture = replace(gesture, 'preview');

    const aborted = abortGesture(gesture);
    expect(aborted.past.length).toBe(MAX_HISTORY);
    expect(aborted.past[0]).toBe(oldestBefore); // the evicted entry is back
    expect(aborted.present).toBe(`v${MAX_HISTORY}`);
    expect(aborted).toEqual(state); // verbatim pre-gesture stacks
  });
});

describe('branch truncation after undo', () => {
  it('discards the redo branch as soon as a new commit happens', () => {
    let state = createHistory('v0');
    state = commit(state, 'v1');
    state = commit(state, 'v2');
    state = undo(state); // present=v1, future=[v2]
    expect(canRedo(state)).toBe(true);

    state = commit(state, 'v1-alt'); // new branch from v1
    expect(state).toEqual({ past: ['v0', 'v1'], present: 'v1-alt', future: [] });
    expect(canRedo(state)).toBe(false);
    expect(redo(state).present).toBe('v1-alt'); // v2 is gone for good
  });
});
