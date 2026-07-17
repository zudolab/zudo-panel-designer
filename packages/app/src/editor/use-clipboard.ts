// Clipboard: Cmd/Ctrl+C copy, Cmd/Ctrl+X cut, Cmd/Ctrl+D duplicate, Cmd/Ctrl+A
// select-all, and the window `paste` event (issue #74). The `paste` event is
// the SOLE Cmd/Ctrl+V path — this module deliberately exposes no `handlePaste`
// (only handleCopy/handleCut/handleDuplicate/handleSelectAll), so there is
// nothing a keydown handler could wire a 'v' case to. Pasting instead rides
// the browser's native paste event: Editor.tsx's keydown fallback chain never
// intercepts a bare Cmd/Ctrl+V (its tool-shortcut branch only fires when NO
// modifier is held), so the browser delivers its normal `paste` event, which
// the effect below owns end to end.
//
// The OS clipboard payload is a versioned envelope — {app:'zpd', kind:
// 'layers', version:1, layers:[...]} — written on copy/cut via
// navigator.clipboard.writeText and read back on paste from the
// ClipboardEvent's clipboardData, so copy/paste round-trips across zpd tabs
// (and a payload from an unrelated app, or a future envelope version, is
// simply ignored rather than crashing the paste).
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cloneLayersWithFreshIds, mintId, parsePanelConfig, type Layer } from '@zpd/core';
import { importImageFile } from './import-image';
import type { ToolContext } from './types';

const ENVELOPE_APP = 'zpd';
const ENVELOPE_KIND = 'layers';
const ENVELOPE_VERSION = 1;

// Cascade offset applied to every clone (paste AND duplicate share this one
// clone technique) so a repeated paste/duplicate never lands exactly on top
// of its source.
const CASCADE_OFFSET_MM = 2;

interface ZpdClipboardEnvelope {
  app: typeof ENVELOPE_APP;
  kind: typeof ENVELOPE_KIND;
  version: typeof ENVELOPE_VERSION;
  layers: Layer[];
}

export interface UseClipboardReturn {
  /** Copies the current selection (pattern layers excluded) to the internal + OS clipboard. */
  handleCopy(): void;
  /** Copy + delete the current selection as ONE undo entry. */
  handleCut(): void;
  /** Clones the current selection with fresh ids + cascade offset, ONE undo entry. */
  handleDuplicate(): void;
  /** Selects every non-pattern layer. */
  handleSelectAll(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  );
}

// Pattern layers are the single panel-wide background (#3's eligibility
// matrix) — the issue spec excludes them from copy/cut/duplicate/select-all.
function copyableSelection(ctx: ToolContext): Layer[] {
  const ids = new Set(ctx.selectedIds);
  return ctx.doc.layers.filter((l) => ids.has(l.id) && l.type !== 'pattern');
}

// Parses OS clipboard text as a zpd layers envelope. Returns null for
// anything else — a plain sentence, a URL, JSON from an unrelated app, or a
// future/foreign envelope version — so the caller can leave non-envelope text
// completely untouched rather than guessing at a mismatched shape.
function parseEnvelope(text: string): Layer[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.app !== ENVELOPE_APP ||
    candidate.kind !== ENVELOPE_KIND ||
    candidate.version !== ENVELOPE_VERSION ||
    !Array.isArray(candidate.layers)
  ) {
    return null;
  }
  // Reuse core's defensive panel-config layer parser instead of a hand-rolled
  // shape check: parsePanelConfig never throws and validates/defaults every
  // type-specific field individually, so a same-version envelope from an
  // older/hand-edited source can't slip in a structurally incomplete layer
  // (e.g. a 'path' with no `points`) that would later throw in cloneLayer or
  // insert NaN geometry into the document.
  const layers = parsePanelConfig({ layers: candidate.layers }).layers.filter(
    (l) => l.type !== 'pattern',
  );
  return layers.length > 0 ? layers : null;
}

// Deep-clones the captured selection into the internal ref (so a later doc
// mutation, including this same cut's own delete, can't leak into the
// snapshot) and best-effort mirrors it to the OS clipboard as the versioned
// envelope. navigator.clipboard.writeText can reject (or the property can be
// entirely absent, e.g. an insecure context) — either degrades silently to
// internal-only, per the issue spec. `pendingWriteRef` stays true while the
// write is in flight — see the paste effect's priority-2 branch for why that
// matters (a fast copy-then-paste can race the OS clipboard write).
function captureToClipboard(
  clipboardRef: { current: Layer[] },
  pendingWriteRef: { current: boolean },
  layers: Layer[],
): void {
  const snapshot: Layer[] = JSON.parse(JSON.stringify(layers));
  clipboardRef.current = snapshot;
  try {
    const envelope: ZpdClipboardEnvelope = {
      app: ENVELOPE_APP,
      kind: ENVELOPE_KIND,
      version: ENVELOPE_VERSION,
      layers: snapshot,
    };
    pendingWriteRef.current = true;
    navigator.clipboard
      .writeText(JSON.stringify(envelope))
      .catch(() => {})
      .finally(() => {
        pendingWriteRef.current = false;
      });
  } catch {
    // clipboard API unavailable or permission denied — no write in flight
    pendingWriteRef.current = false;
  }
}

// Shared clone technique for BOTH paste and duplicate: fresh ids + cascade
// offset via core's cloneLayersWithFreshIds, appended (top of z-order, same
// as every other append-new-layer path), selected, as ONE commit.
function insertClones(ctx: ToolContext, sourceLayers: readonly Layer[]): void {
  if (sourceLayers.length === 0) return;
  const clones = cloneLayersWithFreshIds(sourceLayers, {
    makeId: (source) => mintId(source.type),
    offsetMm: CASCADE_OFFSET_MM,
  });
  ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, ...clones] });
  ctx.selectIds(clones.map((l) => l.id));
}

export function useClipboard(ctx: ToolContext): UseClipboardReturn {
  // Same-session fallback clipboard — populated by handleCopy/handleCut, read
  // by the paste effect's priority-3 branch below.
  const clipboardRef = useRef<Layer[]>([]);
  // True while this session's own OS-clipboard write from the most recent
  // copy/cut hasn't resolved yet — see captureToClipboard and the paste
  // effect's priority-2 branch.
  const pendingWriteRef = useRef(false);

  const handleCopy = useCallback(() => {
    const layers = copyableSelection(ctx);
    if (layers.length === 0) return;
    captureToClipboard(clipboardRef, pendingWriteRef, layers);
  }, [ctx]);

  const handleCut = useCallback(() => {
    const layers = copyableSelection(ctx);
    if (layers.length === 0) return;
    captureToClipboard(clipboardRef, pendingWriteRef, layers);
    // Copy + delete as ONE commit — cut must be a single undo entry.
    const cutIds = new Set(layers.map((l) => l.id));
    ctx.commit({ ...ctx.doc, layers: ctx.doc.layers.filter((l) => !cutIds.has(l.id)) });
    ctx.selectIds(ctx.selectedIds.filter((id) => !cutIds.has(id)));
  }, [ctx]);

  const handleDuplicate = useCallback(() => {
    insertClones(ctx, copyableSelection(ctx));
  }, [ctx]);

  const handleSelectAll = useCallback(() => {
    ctx.selectIds(ctx.doc.layers.filter((l) => l.type !== 'pattern').map((l) => l.id));
  }, [ctx]);

  // The window `paste` listener — sole owner of Cmd/Ctrl+V (and right-click
  // Paste). Self-contained: Editor.tsx never needs to wire this up.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Priority 1: an image file on the OS clipboard.
      const items = e.clipboardData?.items;
      const imageItem = items
        ? Array.from(items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        : undefined;
      const imageFile = imageItem?.getAsFile();
      if (imageFile) {
        e.preventDefault();
        importImageFile(imageFile, ctx).catch((err) => console.error('clipboard-paste:', err));
        return;
      }

      // Priority 2, and the "never intercept normal text paste" guard: ANY
      // OS clipboard text — envelope or not — is handled right here. A zpd
      // envelope pastes those layers; anything else (a URL, a sentence, JSON
      // from another app) is left completely untouched, INCLUDING skipping
      // the internal-clipboard fallback below — the OS clipboard's current
      // content always wins over a stale in-app copy.
      //
      // EXCEPT while this session's own write is still in flight
      // (pendingWriteRef): the text just read from clipboardData may PRE-DATE
      // that write (writeText is async, so a fast copy-then-paste can read
      // the clipboard before it lands), in which case it's stale, not a
      // deliberate foreign paste — fall through to the internal snapshot
      // instead of silently doing nothing.
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        const envelopeLayers = parseEnvelope(text);
        if (envelopeLayers) {
          e.preventDefault();
          insertClones(ctx, envelopeLayers);
          return;
        }
        if (!pendingWriteRef.current) return;
      }

      // Priority 3: internal same-session clipboard — the last resort when
      // the OS clipboard has neither an image nor any text at all (e.g.
      // navigator.clipboard.writeText was denied on copy).
      if (clipboardRef.current.length > 0) {
        e.preventDefault();
        insertClones(ctx, clipboardRef.current);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [ctx]);

  return useMemo(
    () => ({ handleCopy, handleCut, handleDuplicate, handleSelectAll }),
    [handleCopy, handleCut, handleDuplicate, handleSelectAll],
  );
}
