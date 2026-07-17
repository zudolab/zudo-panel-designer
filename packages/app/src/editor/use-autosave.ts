// Local-only autosave (Composer Parity #72). Debounces a doc-store write
// 500ms after every doc change, and flushes synchronously on `pagehide` (the
// modern beforeunload replacement — pagehide also fires on bfcache
// navigation and mobile tab switches, unlike beforeunload) and on
// `visibilitychange` turning 'hidden' (mobile OSes may kill a backgrounded
// tab's process without ever firing pagehide) so a pending debounce isn't
// lost when the tab closes or is backgrounded. Deliberately NO beforeunload
// confirm prompt — continuous local persistence replaces it.
//
// Each effect run owns exactly one debounce timer, scoped to its own
// closure: the previous run's cleanup clears its timer before the next run
// schedules a new one, which is what gives the 500ms debounce its "coalesce
// rapid changes" behavior.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocState } from '@zpd/core';
import { writeDoc, type WriteDocFailureReason } from './doc-store';
import { toastWarning } from './registry/toasts';

const AUTOSAVE_DEBOUNCE_MS = 500;

export type SaveStatus =
  | { kind: 'unsaved' }
  | { kind: 'saved'; savedAt: number }
  | { kind: 'failed'; reason: WriteDocFailureReason };

// Copy constraint: must not overclaim retention — this is localStorage only,
// scoped to this browser.
const FAILURE_WARNING: Record<WriteDocFailureReason, string> = {
  quota: 'This panel is too large to save locally — some changes may be lost if you close the tab.',
  unavailable: 'Local storage is unavailable in this browser — changes are not being saved.',
  error: 'Could not save your changes locally.',
};

// The outcome of the most recent write, tagged with the doc it was written
// for. "Unsaved" is derived (below) rather than stored as its own state: a
// doc change makes `lastWrite.forDoc` stale by reference, which alone means
// unsaved — there is nothing to explicitly set.
type WriteOutcome =
  | { forDoc: DocState; kind: 'saved'; savedAt: number }
  | { forDoc: DocState; kind: 'failed'; reason: WriteDocFailureReason };

export function useAutosave(doc: DocState): SaveStatus {
  const [lastWrite, setLastWrite] = useState<WriteOutcome | null>(null);
  // One warning toast per session, not per debounced write.
  const warnedRef = useRef(false);

  useEffect(() => {
    // Both setLastWrite calls below happen inside `flush`, which only runs
    // from the setTimeout callback or an early-flush listener — never
    // synchronously within this effect body. `flushed` guards against a
    // redundant second write for the same doc if more than one early-flush
    // trigger fires (e.g. the tab is hidden, then actually closed).
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      const result = writeDoc(doc);
      if (result.ok) {
        setLastWrite({ forDoc: doc, kind: 'saved', savedAt: Date.now() });
        return;
      }
      setLastWrite({ forDoc: doc, kind: 'failed', reason: result.reason });
      if (!warnedRef.current) {
        warnedRef.current = true;
        toastWarning(FAILURE_WARNING[result.reason]);
      }
    };

    const timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);

    const handlePagehide = () => flush();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', handlePagehide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', handlePagehide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [doc]);

  return useMemo<SaveStatus>(() => {
    if (!lastWrite || lastWrite.forDoc !== doc) return { kind: 'unsaved' };
    return lastWrite.kind === 'saved'
      ? { kind: 'saved', savedAt: lastWrite.savedAt }
      : { kind: 'failed', reason: lastWrite.reason };
  }, [doc, lastWrite]);
}
