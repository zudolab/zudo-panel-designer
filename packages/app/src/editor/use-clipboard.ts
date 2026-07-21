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
import {
  cloneLayersWithFreshIds,
  deleteNodeById,
  flattenLayerNodes,
  maximalSelectedRoots,
  mintId,
  parsePanelConfig,
  type Layer,
} from '@zpd/core';
import { expandSelectionToLeafIds, topmostAncestorIdForLeaf } from './selection-resolve';
import { isEditableTarget } from './is-editable-target';
import { routeImportFile } from './svg-import/route-import-file';
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
  /** Copies the current selection (patterns included, #97) to the internal + OS clipboard. */
  handleCopy(): void;
  /** Copy + delete the current selection as ONE undo entry. */
  handleCut(): void;
  /** Clones the current selection with fresh ids + cascade offset, ONE undo entry. */
  handleDuplicate(): void;
  /** Selects every non-pattern layer (the deliberate #97 exception — see below). */
  handleSelectAll(): void;
}

// The full selected set EXPANDED to leaves (#151) — a selected group id
// contributes its descendant leaves (a raw group id matches no flat layer, so
// the pre-#151 direct filter silently copied nothing for group selections).
// Pattern squares included since #97 (multiple pattern squares are
// legitimately useful, so copy/cut/paste/duplicate treat them like any
// layer); select-all below is the ONE deliberate pattern exception left.
// The v1 envelope stays FLAT — structure-preserving copy/duplicate of groups
// (clipboard envelope v2) is #156's; expansion here is the bridge that keeps
// the leaves round-tripping until then.
function copyableSelection(ctx: ToolContext): Layer[] {
  const ids = new Set(expandSelectionToLeafIds(ctx.doc.layers, ctx.selectedIds));
  return ctx.flatLayers.filter((l) => ids.has(l.id));
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
  // insert NaN geometry into the document. Pattern layers paste like any
  // other since #97 (they're copyable, so envelopes can carry them).
  // The envelope is always written from a flat copyableSelection() snapshot
  // (see captureToClipboard) — flatten defensively anyway since a hand-edited
  // or foreign envelope could carry a group node under the same version tag.
  const layers = flattenLayerNodes(parsePanelConfig({ layers: candidate.layers }).layers);
  return layers.length > 0 ? layers : null;
}

// Deep-clones the captured selection into the internal ref (so a later doc
// mutation, including this same cut's own delete, can't leak into the
// snapshot) and best-effort mirrors it to the OS clipboard as the versioned
// envelope. navigator.clipboard.writeText can reject (or the property can be
// entirely absent, e.g. an insecure context) — either degrades silently to
// internal-only, per the issue spec.
//
// `outstandingWritesRef` COUNTS in-flight writes rather than tracking a single
// boolean: two overlapping copies (copy A, copy B before A settles) both write,
// and a plain boolean would be cleared by whichever write settles FIRST — so
// A settling would mark "no write pending" while B is still in flight, letting
// the OS clipboard's stale A win over the just-copied snapshot B. A counter is
// only zero once EVERY write has settled — see the paste effect's priority-2
// branch for why that matters.
function captureToClipboard(
  clipboardRef: { current: Layer[] },
  outstandingWritesRef: { current: number },
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
    outstandingWritesRef.current += 1;
    navigator.clipboard
      .writeText(JSON.stringify(envelope))
      .catch(() => {})
      .finally(() => {
        outstandingWritesRef.current -= 1;
      });
  } catch {
    // clipboard API unavailable or writeText threw synchronously — no write is
    // actually in flight, so undo the optimistic increment above.
    outstandingWritesRef.current -= 1;
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
  // Count of this session's own OS-clipboard writes (copy/cut) that haven't
  // settled yet — nonzero means at least one write may not have landed, so the
  // OS clipboard text could be stale relative to clipboardRef. See
  // captureToClipboard and the paste effect's priority-2 branch.
  const outstandingWritesRef = useRef(0);

  const handleCopy = useCallback(() => {
    const layers = copyableSelection(ctx);
    if (layers.length === 0) return;
    captureToClipboard(clipboardRef, outstandingWritesRef, layers);
  }, [ctx]);

  const handleCut = useCallback(() => {
    const layers = copyableSelection(ctx);
    if (layers.length === 0) return;
    captureToClipboard(clipboardRef, outstandingWritesRef, layers);
    // Copy + delete as ONE commit — cut must be a single undo entry.
    // Recursive delete via MAXIMAL roots (#150/#151): a selected group id
    // cascades away with its whole subtree (deleting only the copied leaves
    // would leave an empty group shell behind), and a descendant of a
    // selected ancestor drops out rather than double-deleting.
    ctx.commit({
      ...ctx.doc,
      layers: maximalSelectedRoots(ctx.doc.layers, ctx.selectedIds).reduce(
        (tree, id) => deleteNodeById(tree, id),
        ctx.doc.layers,
      ),
    });
    // Every selected id was either cut or a descendant of a cut root.
    ctx.selectIds([]);
  }, [ctx]);

  const handleDuplicate = useCallback(() => {
    insertClones(ctx, copyableSelection(ctx));
  }, [ctx]);

  const handleSelectAll = useCallback(() => {
    // Select-all still EXCLUDES patterns on purpose (#97): a background-ish
    // cover square joining every Cmd/Ctrl+A would make "select everything and
    // move it" drag the background along. Patterns join a selection only by
    // direct click (two-tier hit) or the layer list. Each remaining leaf
    // PROMOTES to its topmost ancestor group id, deduped (#151 — the same
    // promotion a full-canvas marquee applies); a pattern-only group never
    // enters (no non-pattern leaf nominates it), but a mixed group joins
    // whole — its pattern members ride along, the rigid-group convention.
    const tree = ctx.doc.layers;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const layer of ctx.flatLayers) {
      if (layer.type === 'pattern') continue;
      const id = topmostAncestorIdForLeaf(tree, layer.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    ctx.selectIds(ids);
  }, [ctx]);

  // The window `paste` listener — sole owner of Cmd/Ctrl+V (and right-click
  // Paste). Self-contained: Editor.tsx never needs to wire this up.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Priority 1: an image (or SVG) file on the OS clipboard. A file item's
      // `type` is usually enough (e.g. "image/svg+xml"), but some sources
      // paste an SVG with a generic/empty type — the file's own name is the
      // fallback signal, same as classifyImportFile's own MIME-or-extension
      // check (#138). Routed through routeImportFile (#141) so a real SVG
      // opens the import dialog instead of always importing as a raster
      // layer — the exact same dispatch drop and the picker use.
      const items = e.clipboardData?.items;
      const fileItems = items
        ? Array.from(items)
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((f): f is File => f !== null)
        : [];
      const imageFile = fileItems.find(
        (f) =>
          f.type.startsWith('image/') ||
          f.name.toLowerCase().endsWith('.svg') ||
          // Neither signal present at all -- most likely an anonymous
          // clipboard blob (e.g. an SVG copied without a filename or a
          // recognized MIME type). Let classifyImportFile's content
          // root-sniff decide rather than silently dropping it.
          (f.type === '' && f.name === ''),
      );
      if (imageFile) {
        e.preventDefault();
        routeImportFile(imageFile, ctx).catch((err) => console.error('clipboard-paste:', err));
        return;
      }

      // Priority 2, and the "never intercept normal text paste" guard: ANY
      // OS clipboard text — envelope or not — is handled right here. A zpd
      // envelope pastes those layers; anything else (a URL, a sentence, JSON
      // from another app) is left completely untouched, INCLUDING skipping
      // the internal-clipboard fallback below — the OS clipboard's current
      // content always wins over a stale in-app copy.
      //
      // EXCEPT while any of this session's own writes are still in flight
      // (outstandingWritesRef): the text just read from clipboardData PRE-DATES
      // the latest write (writeText is async, so a fast copy-then-paste can
      // read the clipboard before it lands). That stale text may itself be a
      // PRIOR copy's zpd envelope — e.g. copy A, copy B, immediate paste, where
      // the OS clipboard still holds envelope A. Parsing the envelope BEFORE
      // this guard let stale envelope A win over the just-copied internal
      // snapshot B; so while any write is outstanding we skip the envelope path
      // entirely and fall through to the internal snapshot, which always holds
      // the most recent copy.
      const text = e.clipboardData?.getData('text/plain');
      if (text && outstandingWritesRef.current === 0) {
        const envelopeLayers = parseEnvelope(text);
        if (envelopeLayers) {
          e.preventDefault();
          insertClones(ctx, envelopeLayers);
          return;
        }
        return;
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
