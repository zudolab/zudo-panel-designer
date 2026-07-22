// "Rotate selection" numeric input (#157) — the sidebar-native parity surface
// for the reference's numeric rotate flyout. Drives the SAME session/bake pair
// the canvas multi-rotate knob uses (#152's multi-rotate.ts): capture once per
// selection, then re-bake the WHOLE delta from those frozen starts on every
// keystroke — never cumulatively — so typing "45" twice in a row is idempotent
// (still 45° from start), not 90°.
//
// History composition with #152's model: the core history reducer has no
// "is a gesture open" concept of its own (see @zpd/core's history.ts) — every
// caller tracks that locally, exactly like select.tsx's module-level
// ensureGesture/gestureOpen. This row does the same with its own gestureOpen
// piece of state: beginGesture opens lazily on the first non-zero delta (a
// delta that never leaves 0 writes no history entry), every further keystroke
// streams through ctx.replace (one undo entry total for the whole gesture),
// and Enter/blur finalizes by simply leaving that entry standing — no trailing
// commit, so a finalize never doubles the undo entry beginGesture already
// opened. Escape instead calls ctx.abortGesture(), which pops that one pushed
// past entry and restores present to it — the exact inverse of beginGesture,
// so a cancel (zero-delta OR not) leaves zero undo/redo residue. This is why
// cancel() never re-bakes: abortGesture's restored present is already
// bit-identical to this row's captured session (both come from the same
// pre-gesture doc), so re-deriving it from a live ctx.doc read one line after
// dispatching the abort would only risk reading a stale pre-abort snapshot.
import { useState } from 'react';
import { bakeMultiRotate, captureMultiRotateSession, type MultiRotateSession } from '../multi-rotate';
import { resolveSelectionLeaves, resolveSelectionOverlayMode } from '../selection-resolve';
import type { ToolContext } from '../types';
import { Field } from './inspector-ui';

export interface RotateSelectionPanelProps {
  ctx: ToolContext;
  selectedIds: readonly string[];
}

// Identity for the "reset on selection change" rule (doc-order ids joined on
// a separator that can never appear inside a layer id).
function selectionKey(ids: readonly string[]): string {
  return ids.join(' ');
}

export function RotateSelectionPanel({ ctx, selectedIds }: RotateSelectionPanelProps) {
  const tree = ctx.doc.layers;
  // Visibility gate (#157's acceptance criteria): combined overlay mode with
  // at least one rotatable editable leaf. Single-leaf selections keep using
  // the per-type inspector's own rotation field (untouched by this row); an
  // all-pattern / all-unrotatable combined selection has nothing to spin.
  const overlayMode = resolveSelectionOverlayMode(tree, selectedIds);
  const { rotatableLeafIds } = resolveSelectionLeaves(tree, selectedIds, ctx.flatLayers);
  const eligible = overlayMode === 'combined' && rotatableLeafIds.length > 0;

  const [capturedKey, setCapturedKey] = useState<string | null>(null);
  const [capturedTree, setCapturedTree] = useState<typeof tree | null>(null);
  const [session, setSession] = useState<MultiRotateSession | null>(null);
  const [draft, setDraft] = useState('0.0');
  const [gestureOpen, setGestureOpen] = useState(false);

  // Own-bake provenance marker (#157 e2e bug, found by #158's integration
  // pass): in the REAL app `ctx.doc` reads Editor's docRef, which is synced
  // in a passive effect AFTER each commit — so in the render flush that
  // cancel() triggers (its abortGesture dispatch and setGestureOpen(false)
  // batch together), this component sees its OWN state already fresh
  // (gestureOpen=false) while `tree` is still the pre-abort mid-gesture doc:
  // this row's last bake output. The doc-change recapture below would latch
  // capturedTree/session onto that abandoned tree, and — since the later
  // docRef sync is a ref write, not a render — nothing ever self-corrects:
  // the next edit then bakes on top of the aborted delta (type 10, 47,
  // Escape, 45 => 92°). Recapturing from this row's own bake output is
  // wrong under EVERY circumstance (mid-gesture it corrupts the frozen-
  // delta model; post-abort it resurrects the abandoned delta), so instead
  // of trying to out-time React, the guard checks provenance: applyDelta
  // records each baked tree here, and a tree matching it never triggers a
  // recapture — timing-independent, however late the docRef sync lands.
  // Every LEGITIMATE recapture clears the marker again, which keeps redo
  // honest: redo restores the exact finalized bake object (reference-equal
  // to this marker), and the undo that precedes any redo always lands a
  // clearing recapture first.
  const [lastBakedTree, setLastBakedTree] = useState<typeof tree | null>(null);

  const key = selectionKey(selectedIds);

  // Capture (or drop) the session at render time — the same "adjust state
  // during render instead of an effect" pattern NumberField uses to re-sync
  // its draft to an incoming prop change (see inspector-ui.tsx), so a
  // consumer reading this row's state right after a change never observes a
  // stale in-between frame. Two triggers:
  //  - the eligible selection SET changed (the row's own reset rule), or
  //  - the doc changed out from under an unchanged selection while this row
  //    is NOT mid-edit (tree is a fresh reference per commit — #150) — e.g.
  //    finalize a rotate, then nudge/align the same selection elsewhere, then
  //    come back to type again. Without this, bakeMultiRotate would re-bake
  //    from the now-stale pre-nudge snapshots and silently discard the nudge.
  //    Gated on !gestureOpen: `tree` also changes on every OWN replace() tick
  //    mid-gesture, and recapturing THAT would corrupt the frozen-delta model
  //    this row exists to provide. Also gated on tree !== lastBakedTree
  //    (see the marker's comment above): a tree that IS this row's own bake
  //    output is never an external edit — post-Escape it is the abandoned
  //    pre-abort doc still visible through the not-yet-synced docRef, and
  //    no recapture is needed then anyway, since abortGesture restores
  //    present to the exact object `session`/`capturedTree` were captured
  //    from (tree === capturedTree again by reference once the abort lands).
  if (
    eligible &&
    (key !== capturedKey ||
      (!gestureOpen && tree !== capturedTree && tree !== lastBakedTree))
  ) {
    setCapturedKey(key);
    setCapturedTree(tree);
    setSession(captureMultiRotateSession(tree, selectedIds, ctx.flatLayers));
    setDraft('0.0');
    setGestureOpen(false);
    setLastBakedTree(null); // a fresh baseline obsoletes the old provenance marker
  } else if (!eligible && capturedKey !== null) {
    setCapturedKey(null);
    setCapturedTree(null);
    setSession(null);
  }

  if (!eligible || !session) return null;

  // Every tick re-bakes the WHOLE delta from the frozen start snapshots
  // (bakeMultiRotate), never cumulatively — see multi-rotate.ts.
  const applyDelta = (deltaDeg: number) => {
    // Lazy ensureGesture (#152's model): a delta that nets to 0 before the
    // gesture has opened writes no history entry at all.
    if (!gestureOpen && deltaDeg === 0) return;
    if (!gestureOpen) {
      setGestureOpen(true);
      ctx.beginGesture();
    }
    const baked = bakeMultiRotate(tree, session, deltaDeg);
    setLastBakedTree(baked); // provenance marker — see the recapture guard above
    ctx.replace({ ...ctx.doc, layers: baked });
  };

  // Enter/blur: the gesture entry (if one opened) stands as-is — zpd-native,
  // no trailing commit. The just-finalized doc becomes the new baseline: the
  // NEXT edit captures fresh starts and opens its OWN gesture, so an Escape
  // after this finalize can only roll back what comes after it.
  const finalize = () => {
    const finalizedTree = ctx.doc.layers;
    setCapturedTree(finalizedTree);
    setSession(captureMultiRotateSession(finalizedTree, selectedIds, ctx.flatLayers));
    setDraft('0.0');
    setGestureOpen(false);
  };

  // Escape: abort the OPEN gesture via core's abortGesture (no-op if this row
  // never opened one — e.g. every keystroke so far canceled itself out to
  // delta 0). `session` is left exactly as-is: abortGesture restores present
  // to the same pre-gesture doc `session` was captured from, so it is already
  // the correct baseline for the next edit — re-deriving it here would read a
  // pre-abort ctx.doc, since ctx.doc only re-syncs after the dispatch commits
  // and this component re-renders.
  const cancel = () => {
    if (gestureOpen) ctx.abortGesture();
    setDraft('0.0');
    setGestureOpen(false);
  };

  return (
    <Field label="Rotate selection (°)">
      <input
        type="number"
        step={1}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = Number(raw);
          // Invalid/empty draft (cleared field, a lone "-", non-numeric
          // paste): hold the last applied bake rather than snapping the
          // selection to 0 — mirrors NumberField's "never commit a phantom
          // value" instinct. Enter/blur still finalizes whatever is baked.
          if (raw.trim() === '' || Number.isNaN(parsed)) return;
          applyDelta(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finalize();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => finalize()}
        className="w-full select-text rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-right text-neutral-100"
      />
    </Field>
  );
}
