// Layer list — recursive TREE rendering (#153). Rows render in TRUE z-order:
// reversed DFS at EVERY level (not just top-level), so a group's header
// interleaves exactly where its z-band sits and nested children keep
// top-of-stack-first order too. Select / show-hide / rename / delete /
// group-cascade-delete / ungroup / local reorder / drag-and-drop (#154, see
// layer-list-dnd.ts) all go through @zpd/core tree ops so ordering +
// immutability semantics live in one place.
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  deleteNodeById,
  findNodeById,
  isGroupNode,
  maximalSelectedRoots,
  moveNodeToParent,
  PALETTE,
  renameById,
  toggleHiddenById,
  ungroupGroupById,
  walkLayerNodes,
  type ColorIndex,
  type GroupNode,
  type Layer,
  type LayerNode,
} from '@zpd/core';
import { projectFlatLayers } from '../flat-projection';
import { nextListSelection } from '../selection';
import { toggleLeafSelection } from '../selection-resolve';
import {
  executeDrop,
  invalidDropReason,
  resolveDropSlot,
  resolveTailDropSlot,
  type DropRejection,
  type DropSlot,
  type DropZone,
} from './layer-list-dnd';
import type { ToolContext } from '../types';

const TYPE_ICON: Record<Layer['type'], string> = {
  shape: '▭',
  pattern: '▦',
  path: '✒',
  text: 'T',
  image: '🖼',
};

function layerColorIndex(layer: Layer): ColorIndex {
  if (layer.type === 'path') return layer.fill ?? layer.stroke ?? 1;
  if (layer.type === 'image') return 0;
  return layer.color;
}

export interface LayerListProps {
  ctx: ToolContext;
  selectedIds: readonly string[];
}

// ─── Visible-row traversal (#153) ───────────────────────────────────────
// One linear top-of-stack-first walk of the tree, reused by everything that
// needs a flat row ORDER: roving keyboard focus, the shift-range anchor
// (../selection.ts's nextListSelection), and delete's "nearest remaining
// row" focus fallback. The recursive JSX renderer below walks the SAME
// reversed-per-level order independently (it needs nested wrapper elements
// for free-compounding indentation, not a flat list) — keep both in sync if
// this traversal order ever changes.
interface LeafRow {
  kind: 'leaf';
  id: string;
  layer: Layer;
}
interface GroupRow {
  kind: 'group';
  id: string;
  group: GroupNode;
}
type VisibleRow = LeafRow | GroupRow;

function collectVisibleRows(
  nodes: readonly LayerNode[],
  collapsedGroupIds: ReadonlySet<string>,
  flatById: ReadonlyMap<string, Layer>,
  out: VisibleRow[],
): void {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (isGroupNode(node)) {
      out.push({ kind: 'group', id: node.id, group: node });
      // Collapsed groups unmount their descendant rows entirely — they never
      // enter the visible-row order (keyboard nav, shift-range, and the
      // rendered DOM all skip them).
      if (!collapsedGroupIds.has(node.id)) {
        collectVisibleRows(node.children, collapsedGroupIds, flatById, out);
      }
    } else {
      out.push({ kind: 'leaf', id: node.id, layer: flatById.get(node.id) ?? node });
    }
  }
}

// The node's CURRENT parent (null = top level) and its 0-based index among
// that parent's own children — the coordinate space moveNodeToParent expects
// for a same-parent single-step reorder. Returns null when `id` is not found
// or its parent lookup is inconsistent (defensive; unreachable for a row id
// that came from the tree we just walked).
function locateLocalSlot(
  tree: LayerNode[],
  id: string,
): { parentId: string | null; index: number } | null {
  const found = findNodeById(tree, id);
  if (!found) return null;
  const parentId = found.pathIds[found.pathIds.length - 1] ?? null;
  const siblings =
    parentId === null ? tree : (findNodeById(tree, parentId)?.node as GroupNode | undefined)?.children;
  if (!siblings) return null;
  const index = siblings.findIndex((n) => n.id === id);
  return index < 0 ? null : { parentId, index };
}

// Every id (leaf or nested group) strictly BENEATH `id` — empty when `id`
// is a leaf or not found. Used to enforce the #151 overlap invariant when a
// GROUP id joins the selection: any already-selected descendant must drop
// out (see handleRowClick's Meta branch).
function collectDescendantIds(tree: LayerNode[], id: string): Set<string> {
  const found = findNodeById(tree, id);
  const out = new Set<string>();
  if (found && isGroupNode(found.node)) {
    walkLayerNodes(found.node.children, (node) => out.add(node.id));
  }
  return out;
}

export function LayerList({ ctx, selectedIds }: LayerListProps) {
  const tree = ctx.doc.layers;
  const flatById = useMemo(() => new Map(ctx.flatLayers.map((l) => [l.id, l])), [ctx.flatLayers]);

  // Expand/collapse (#153): session-only, keyed by STABLE node id (never
  // array index — index keys remount and drop state when order changes).
  // Not persisted, not document state, not in undo history. Default is
  // expanded (empty set = nothing collapsed).
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    const rows: VisibleRow[] = [];
    collectVisibleRows(tree, collapsedGroupIds, flatById, rows);
    return rows;
  }, [tree, collapsedGroupIds, flatById]);
  const visibleRowIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  // De-dupes a GROUP rename's commit-on-Enter-OR-blur contract (see
  // resolveGroupRename below) against a blur that races an Enter/Escape-
  // driven unmount — the same race the pre-existing leaf-rename comment
  // documents, but leaf rename only ever commits on Enter so it never needed
  // a guard; group rename commits on blur too, so a stale second call must
  // be a no-op.
  const groupRenameResolvedRef = useRef(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const selectionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  // Shift-range anchor (#45, tree-aware since #153). A ref, not state: it
  // only steers the NEXT click and must never trigger a re-render of its own.
  const anchorRef = useRef<string | null>(null);

  // ─── Drag & drop (#154) ────────────────────────────────────────────────
  // The dragging root ids live in BOTH a ref (drop/dragover handlers read it
  // SYNCHRONOUSLY — React 18 batches state updates, so under fast event
  // sequencing like Playwright's dragTo a state-only mirror is still null
  // when the drop fires) AND a state twin (only for the row-dimming visual).
  // The setter below writes both.
  const draggingIdsRef = useRef<readonly string[] | null>(null);
  const [draggingIds, setDraggingIdsState] = useState<readonly string[] | null>(null);
  const setDraggingIds = (ids: readonly string[] | null) => {
    draggingIdsRef.current = ids;
    setDraggingIdsState(ids);
  };
  // Hover feedback: which row shows a drop affordance, at which zone, and
  // whether the guards reject it (=> disabled affordance instead).
  const [dropIndicator, setDropIndicator] = useState<{
    rowId: string;
    zone: DropZone;
    reason: DropRejection | null;
  } | null>(null);

  const clearDragState = () => {
    setDraggingIds(null);
    setDropIndicator(null);
  };

  // Pointer → zone. Leaves split in half (above/below); group headers keep a
  // middle 'into' band with slim before/after edges. jsdom reports a 0-height
  // rect: the 0.5 fallback then lands on 'after' for leaves and 'into' for
  // headers — geometry-specific zones are exercised via mocked rects.
  const dropZoneFromEvent = (e: DragEvent<HTMLElement>, kind: 'leaf' | 'group'): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientY - rect.top) / rect.height;
    const ratio = Number.isFinite(raw) ? raw : 0.5; // 0-height rect (jsdom) / synthetic event without coords
    if (kind === 'leaf') return ratio < 0.5 ? 'before' : 'after';
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'into';
  };

  const handleRowDragStart = (e: DragEvent<HTMLElement>, rowId: string) => {
    e.stopPropagation();
    // Dragging a selected row carries the WHOLE selection, collapsed to its
    // maximal roots (a selected group travels as one subtree, never alongside
    // a selected descendant); dragging an unselected row carries just itself.
    const ids = selectedIds.includes(rowId) ? maximalSelectedRoots(tree, selectedIds) : [rowId];
    setDraggingIds(ids.length > 0 ? ids : [rowId]);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // A non-empty payload keeps Firefox starting the drag; drop-import's
      // overlay filters on 'Files', so this internal drag never triggers it.
      e.dataTransfer.setData('text/plain', rowId);
    }
  };

  const handleRowDragOver = (e: DragEvent<HTMLElement>, rowId: string, zone: DropZone) => {
    const dragging = draggingIdsRef.current;
    if (!dragging) return; // external drag (e.g. a file) — not ours
    e.stopPropagation();
    const slot = resolveDropSlot(tree, rowId, zone, dragging, collapsedGroupIds);
    const reason: DropRejection | null =
      slot === null ? 'cycle' : invalidDropReason(tree, slot, dragging);
    if (reason === null) {
      e.preventDefault(); // required to make this element a legal drop target
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    } else if (e.dataTransfer) {
      // No preventDefault: the browser refuses the drop and shows the
      // platform no-drop cursor; the indicator adds the visual/aria half.
      e.dataTransfer.dropEffect = 'none';
    }
    setDropIndicator((prev) =>
      prev !== null && prev.rowId === rowId && prev.zone === zone && prev.reason === reason
        ? prev
        : { rowId, zone, reason },
    );
  };

  const handleRowDragLeave = (rowId: string) => {
    setDropIndicator((prev) => (prev !== null && prev.rowId === rowId ? null : prev));
  };

  const commitDrop = (slot: DropSlot | null, dragging: readonly string[]) => {
    if (slot === null) return;
    // Silent-reject-before-history: BOTH guards re-run here, before any
    // ctx.commit — a rejected drop must never create an undo entry.
    if (invalidDropReason(tree, slot, dragging) !== null) return;
    const nextTree = executeDrop(tree, dragging, slot);
    // Same-reference = the batch was a no-op (dropped onto its own slot) —
    // no phantom history entry.
    if (nextTree === tree) return;
    // One commit for the whole multi-root batch = ONE history entry.
    ctx.commit({ ...ctx.doc, layers: nextTree });
  };

  const handleRowDrop = (e: DragEvent<HTMLElement>, rowId: string, zone: DropZone) => {
    const dragging = draggingIdsRef.current; // ref, not state — see twin note above
    clearDragState();
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    commitDrop(resolveDropSlot(tree, rowId, zone, dragging, collapsedGroupIds), dragging);
  };

  // Tail area of a rows <ul> (the space that is the list itself, not any
  // row): drops land at that container's visual BOTTOM (array index 0). The
  // guard on target === currentTarget keeps bubbled row events out — row
  // handlers stopPropagation for internal drags, so only a hover over the
  // list's own empty runway arrives here as a direct target. This is the
  // outdent path below an expanded group's subtree (see resolveTailDropSlot).
  const handleTailDragOver = (e: DragEvent<HTMLElement>, parentId: string | null) => {
    if (e.target !== e.currentTarget) return;
    const dragging = draggingIdsRef.current;
    if (!dragging) return;
    const slot = resolveTailDropSlot(tree, parentId, dragging);
    if (slot !== null && invalidDropReason(tree, slot, dragging) === null) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    } else if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'none';
    }
  };

  const handleTailDrop = (e: DragEvent<HTMLElement>, parentId: string | null) => {
    if (e.target !== e.currentTarget) return;
    const dragging = draggingIdsRef.current;
    clearDragState();
    if (!dragging) return;
    e.preventDefault();
    commitDrop(resolveTailDropSlot(tree, parentId, dragging), dragging);
  };

  // Affordance attributes/classes for the row currently hovered by a drag.
  // data-drop / data-drop-invalid are the test-visible contract; aria-disabled
  // is the accessible "this target is rejected" signal the issue asks for.
  const dropAffordance = (rowId: string) => {
    const indicator = dropIndicator !== null && dropIndicator.rowId === rowId ? dropIndicator : null;
    if (indicator === null) return { attrs: {}, className: '' };
    const invalid = indicator.reason !== null;
    return {
      attrs: {
        'data-drop': indicator.zone,
        ...(invalid ? { 'data-drop-invalid': 'true', 'aria-disabled': true } : {}),
      },
      className: invalid
        ? ' cursor-no-drop opacity-50'
        : indicator.zone === 'into'
          ? ' outline outline-2 -outline-offset-1 outline-sky-400'
          : indicator.zone === 'before'
            ? ' shadow-[0_-2px_0_0_#38bdf8]'
            : ' shadow-[0_2px_0_0_#38bdf8]',
    };
  };

  const currentFocusId =
    focusedRowId !== null && visibleRowIds.includes(focusedRowId)
      ? focusedRowId
      : (visibleRowIds.find((id) => selectedIds.includes(id)) ?? visibleRowIds[0] ?? null);

  const handleRowClick = (
    id: string,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    // Tree-aware range selection (#154): shift-range anchor/membership walks
    // the VISIBLE rows (reversed DFS with collapsed subtrees unmounted) —
    // group rows are real range members now, and a collapsed group
    // contributes only its own header row (its descendants never enter a
    // range). An anchor hidden inside a collapsed group is simply absent
    // from this order, so nextListSelection degrades that shift-click to a
    // plain single select.
    const next = nextListSelection(
      { selectedIds, anchorId: anchorRef.current },
      visibleRowIds,
      id,
      { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey },
    );
    anchorRef.current = next.anchorId;
    // Meta list-toggle is the same raw-node escape hatch as a canvas
    // Meta-click (#151): toggling `id` STRIPS any selected ancestor group so
    // the [group, descendant] overlap never exists in selectedIds.
    // toggleLeafSelection only strips ANCESTORS of `id` — sufficient for a
    // leaf (which has no descendants to worry about), but adding a GROUP id
    // also needs its selected DESCENDANTS stripped (codex review finding):
    // e.g. Meta-click leaf B, then Meta-click its parent group G, must not
    // leave ['b', 'G'] both selected. toggleLeafSelection only appends `id`
    // on the ADD path (the remove path filters it out), so checking
    // `stripped.includes(id)` distinguishes add from remove without a
    // separate branch.
    if (!e.shiftKey && (e.metaKey || e.ctrlKey)) {
      const stripped = toggleLeafSelection(tree, selectedIds, id);
      const next2 = stripped.includes(id)
        ? stripped.filter((sid) => sid === id || !collectDescendantIds(tree, id).has(sid))
        : stripped;
      ctx.selectIds(next2);
    } else if (e.shiftKey) {
      // A visible-row range can sweep in a group header AND its expanded
      // descendant rows — maximalSelectedRoots collapses that to just the
      // group (dropping the covered descendants), so the #151
      // [group, descendant] overlap invariant holds for every range. Rows
      // not covered by any ranged group survive as-is, in tree DFS order.
      ctx.selectIds(maximalSelectedRoots(tree, next.selectedIds));
    } else {
      ctx.selectIds(next.selectedIds);
    }
  };

  // z-reorder (#150 deferred write, resolved here for the button path): a
  // same-parent, single-step move via moveNodeToParent — works for a leaf OR
  // a group, at any depth, because it targets the node's OWN current parent
  // + local index. Free-form drag (including reparenting into/out of a
  // group) is #154's DnD job; this button stays independent of that and
  // needs no change when DnD lands. Per the issue spec, group ROWS don't get
  // this affordance (no move buttons in the group header) — only leaves.
  const move = (id: string, dir: 1 | -1) => {
    const slot = locateLocalSlot(tree, id);
    if (!slot) return;
    const next = moveNodeToParent(tree, id, slot.parentId, slot.index + dir);
    // moveNodeToParent returns the SAME reference when the move clamps back
    // to the node's own slot (already at the top/bottom of its local stack)
    // — don't write a phantom undo entry for that.
    if (next === tree) return;
    ctx.commit({ ...ctx.doc, layers: next });
  };

  const remove = (id: string) => {
    const found = findNodeById(tree, id);
    // Cascade (#148): deleting a group removes every descendant with it —
    // collect the whole removed-subtree id set so selection drops all of
    // them, not just the group's own id.
    const removedIds = new Set<string>([id]);
    if (found && isGroupNode(found.node)) {
      walkLayerNodes([found.node], (node) => removedIds.add(node.id));
    }
    const renderedIndex = visibleRowIds.indexOf(id);
    const nextTree = deleteNodeById(tree, id);
    const nextFlatById = new Map(projectFlatLayers(nextTree).map((l) => [l.id, l]));
    const nextRows: VisibleRow[] = [];
    collectVisibleRows(nextTree, collapsedGroupIds, nextFlatById, nextRows);
    const nextVisibleRowIds = nextRows.map((row) => row.id);
    const nextFocusId =
      renderedIndex < 0
        ? currentFocusId
        : (nextVisibleRowIds[Math.min(renderedIndex, nextVisibleRowIds.length - 1)] ?? null);

    ctx.commit({ ...ctx.doc, layers: nextTree });
    setFocusedRowId(nextFocusId);
    if (nextFocusId) selectionButtonRefs.current.get(nextFocusId)?.focus();
    // Multi-capable drop-from-selection (#44): drop every removed id (the
    // whole cascaded subtree for a group) out of the selection in one call.
    if (selectedIds.some((sid) => removedIds.has(sid))) {
      ctx.selectIds(selectedIds.filter((sid) => !removedIds.has(sid)));
    }
  };

  const ungroup = (groupId: string) => {
    const found = findNodeById(tree, groupId);
    if (!found || !isGroupNode(found.node)) return;
    const childIds = found.node.children.map((child) => child.id);
    const nextTree = ungroupGroupById(tree, groupId);
    if (nextTree === tree) return;
    ctx.commit({ ...ctx.doc, layers: nextTree });
    // Releasing a selected group's children in its place (#153): the group
    // id no longer exists, so swap it for the children it just released —
    // maximalSelectedRoots re-collapses the result in case any of those
    // children were ALSO independently selected already (overlap guard,
    // #151's invariant).
    if (selectedIds.includes(groupId)) {
      const expanded = selectedIds.flatMap((sid) => (sid === groupId ? childIds : [sid]));
      ctx.selectIds(maximalSelectedRoots(nextTree, expanded));
    }
  };

  const toggle = (id: string) => {
    // Recursive toggle (#148/#150): flips the node's OWN hidden flag at any
    // depth — a group's toggle folds to every descendant at flatten time.
    ctx.commit({ ...ctx.doc, layers: toggleHiddenById(tree, id) });
  };

  const startLeafRename = (layer: Layer) => {
    setRenamingId(layer.id);
    setDraftName(layer.name);
  };
  // Enter is the only path that calls ctx.commit for a LEAF — Escape/blur
  // both just close the editor, so a blur racing an Escape-driven unmount
  // can never fire a second (stale) commit. (Group rename below has a
  // different contract — commits on blur too — see resolveGroupRename.)
  const commitLeafRename = (id: string) => {
    // An empty name is a valid stored value — the row display already falls
    // back to layer.type (see the span below), same as the initial data.
    ctx.commit({ ...ctx.doc, layers: renameById(tree, id, draftName.trim()) });
    setRenamingId(null);
  };

  const startGroupRename = (group: GroupNode) => {
    groupRenameResolvedRef.current = false;
    setRenamingId(group.id);
    setDraftName(group.name);
  };
  // Group rename commits on Enter OR blur when the trimmed name changed;
  // Escape cancels without committing either way. `groupRenameResolvedRef`
  // guards against a double-fire when Enter (or Escape) closes the editor
  // and the resulting unmount also triggers a blur for the same input —
  // whichever event resolves first wins, the other is a no-op.
  const resolveGroupRename = (group: GroupNode, commit: boolean) => {
    if (groupRenameResolvedRef.current) return;
    groupRenameResolvedRef.current = true;
    if (commit) {
      // An empty name is a valid stored value, same as leaf rename (the row
      // display already falls back to "Group") — only gate on CHANGED, not
      // truthy (codex review finding: the truthy check silently discarded a
      // deliberate clear-to-empty edit that renameById/GroupNode support).
      const trimmed = draftName.trim();
      if (trimmed !== group.name) {
        ctx.commit({ ...ctx.doc, layers: renameById(tree, group.id, trimmed) });
      }
    }
    setRenamingId(null);
  };

  const moveSelectionFocus = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Keep the editor's window-level shortcut handler from turning Space
      // into temporary pan mode. Do not preventDefault: the button's native
      // Enter/Space click must remain the selection activation path.
      event.stopPropagation();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();

    const index = visibleRowIds.indexOf(id);
    if (index < 0) return;
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = Math.min(Math.max(index + offset, 0), visibleRowIds.length - 1);
    const nextId = visibleRowIds[nextIndex];
    if (!nextId) return;

    setFocusedRowId(nextId);
    selectionButtonRefs.current.get(nextId)?.focus();
  };

  // ─── Recursive JSX renderer ────────────────────────────────────────────
  // Reversed DFS at EVERY level — a group's children reverse independently
  // of its siblings, so nested content keeps top-of-stack-first order too
  // (the flat pre-#153 panel rendered groups above a separately-flattened
  // leaf list and "lied about z-order"; this walks the actual tree).
  // Indentation is free: each nesting level wraps its children in another
  // margin/border-left container, so depth compounds without computing a
  // per-row indent width.
  //
  // `data-depth` is on every row. `data-group-id` names the row's DIRECT
  // PARENT group (absent at top level) — NOT the row's own id — so a test
  // (or #154's DnD) can ask "which group does this row currently live
  // inside" for both a leaf row and a nested group's own header row alike.

  const renderLeafRow = (layer: Layer, depth: number, parentGroupId: string | null): ReactNode => {
    const selected = selectedIds.includes(layer.id);
    const affordance = dropAffordance(layer.id);
    return (
      <li
        key={layer.id}
        data-depth={depth}
        {...(parentGroupId !== null ? { 'data-group-id': parentGroupId } : {})}
        {...affordance.attrs}
        draggable={renamingId !== layer.id}
        onDragStart={(e) => handleRowDragStart(e, layer.id)}
        onDragOver={(e) => handleRowDragOver(e, layer.id, dropZoneFromEvent(e, 'leaf'))}
        onDragLeave={() => handleRowDragLeave(layer.id)}
        onDrop={(e) => handleRowDrop(e, layer.id, dropZoneFromEvent(e, 'leaf'))}
        onDragEnd={clearDragState}
        className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
          selected ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800'
        }${draggingIds !== null && draggingIds.includes(layer.id) ? ' opacity-40' : ''}${affordance.className}`}
      >
        <button
          ref={(node) => {
            if (node) selectionButtonRefs.current.set(layer.id, node);
            else selectionButtonRefs.current.delete(layer.id);
          }}
          type="button"
          aria-label={`Select layer ${layer.name || layer.type}`}
          aria-pressed={selected}
          tabIndex={currentFocusId === layer.id ? 0 : -1}
          onFocus={() => setFocusedRowId(layer.id)}
          onKeyDown={(event) => moveSelectionFocus(layer.id, event)}
          onClick={(event) => handleRowClick(layer.id, event)}
          className="flex shrink-0 items-center gap-1.5 rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
        >
          <span className="w-4 text-center" aria-hidden="true">
            {TYPE_ICON[layer.type]}
          </span>
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-sm border border-neutral-600"
            style={{ background: PALETTE[layerColorIndex(layer)].hex }}
          />
        </button>
        {renamingId === layer.id ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => setRenamingId(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitLeafRename(layer.id);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRenamingId(null);
              }
            }}
            className="min-w-0 flex-1 select-text rounded border border-sky-500 bg-neutral-950 px-1 text-neutral-100"
          />
        ) : (
          <span
            onDoubleClick={() => {
              startLeafRename(layer);
            }}
            title="Double-click to rename"
            className={`flex-1 truncate ${layer.hidden ? 'italic opacity-50' : ''}`}
          >
            {layer.name || layer.type}
          </span>
        )}
        <span className="flex items-center gap-0.5 text-neutral-400">
          <button
            title="Bring forward"
            onClick={(e) => {
              e.stopPropagation();
              move(layer.id, 1);
            }}
          >
            ▲
          </button>
          <button
            title="Send backward"
            onClick={(e) => {
              e.stopPropagation();
              move(layer.id, -1);
            }}
          >
            ▼
          </button>
          <button
            title="Show / hide"
            onClick={(e) => {
              e.stopPropagation();
              toggle(layer.id);
            }}
          >
            {layer.hidden ? '🚫' : '👁'}
          </button>
          <button
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              remove(layer.id);
            }}
          >
            ✕
          </button>
        </span>
      </li>
    );
  };

  const renderGroupRow = (group: GroupNode, depth: number, parentGroupId: string | null): ReactNode => {
    const selected = selectedIds.includes(group.id);
    const collapsed = collapsedGroupIds.has(group.id);
    const isRenaming = renamingId === group.id;
    const name = group.name || 'Group';
    const affordance = dropAffordance(group.id);
    // The GROUP's own <li> wraps BOTH its header row (a <div>, not another
    // <li>) and — when expanded — a nested <ul> for its children. A <ul> may
    // only contain <li> elements; putting the children list as a SIBLING of
    // this <li> (rather than nested inside it) produced invalid list markup
    // and broke the group/subgroup DOM relationship for assistive tech
    // (codex review finding) — nesting it here is what makes the wrapper
    // margin/border in the children <ul> compound depth for free too.
    return (
      <li
        key={group.id}
        data-depth={depth}
        {...(parentGroupId !== null ? { 'data-group-id': parentGroupId } : {})}
      >
        <div
          // Drag handlers live on the HEADER <div>, not the group's <li> —
          // the <li> also wraps the nested children <ul>, so li-level
          // handlers/rects would swallow the children's own drop zones.
          // `draggable` is gated on !isRenaming (a row mid-rename must not
          // start a drag — #153's seam note).
          {...affordance.attrs}
          draggable={!isRenaming}
          onDragStart={(e) => handleRowDragStart(e, group.id)}
          onDragOver={(e) => handleRowDragOver(e, group.id, dropZoneFromEvent(e, 'group'))}
          onDragLeave={() => handleRowDragLeave(group.id)}
          onDrop={(e) => handleRowDrop(e, group.id, dropZoneFromEvent(e, 'group'))}
          onDragEnd={clearDragState}
          className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
            selected ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800'
          }${draggingIds !== null && draggingIds.includes(group.id) ? ' opacity-40' : ''}${affordance.className}`}
        >
        <button
          type="button"
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          aria-expanded={!collapsed}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed(group.id);
          }}
          className="flex shrink-0 items-center justify-center rounded-sm p-0.5 text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
        >
          <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
        </button>
        <button
          ref={(node) => {
            if (node) selectionButtonRefs.current.set(group.id, node);
            else selectionButtonRefs.current.delete(group.id);
          }}
          type="button"
          aria-label={`Select group ${name}`}
          aria-pressed={selected}
          tabIndex={currentFocusId === group.id ? 0 : -1}
          onFocus={() => setFocusedRowId(group.id)}
          onKeyDown={(event) => moveSelectionFocus(group.id, event)}
          onClick={(event) => handleRowClick(group.id, event)}
          className="flex shrink-0 items-center gap-1.5 rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
        >
          <span className="w-4 text-center" aria-hidden="true">
            📁
          </span>
        </button>
        {isRenaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => resolveGroupRename(group, true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                resolveGroupRename(group, true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                resolveGroupRename(group, false);
              }
            }}
            className="min-w-0 flex-1 select-text rounded border border-sky-500 bg-neutral-950 px-1 text-neutral-100"
          />
        ) : (
          <span
            onDoubleClick={() => {
              startGroupRename(group);
            }}
            title="Double-click to rename"
            className={`flex-1 truncate ${group.hidden ? 'italic opacity-50' : ''}`}
          >
            {name}
          </span>
        )}
        <span aria-hidden="true" className="text-neutral-500">
          ({group.children.length})
        </span>
        <span className="flex items-center gap-0.5 text-neutral-400">
          <button
            title="Show / hide"
            aria-label={group.hidden ? `Show ${name}` : `Hide ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(group.id);
            }}
          >
            {group.hidden ? '🚫' : '👁'}
          </button>
          <button
            title="Ungroup"
            aria-label={`Ungroup ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              ungroup(group.id);
            }}
          >
            ⇲
          </button>
          <button
            title="Delete group and children"
            aria-label={`Delete ${name} (and all children)`}
            onClick={(e) => {
              e.stopPropagation();
              remove(group.id);
            }}
          >
            ✕
          </button>
        </span>
        </div>
        {!collapsed && (
          <ul
            data-group-id={group.id}
            onDragOver={(e) => handleTailDragOver(e, group.id)}
            onDrop={(e) => handleTailDrop(e, group.id)}
            className="ml-3 flex flex-col gap-0.5 border-l border-neutral-800 pl-2"
          >
            {group.children.length === 0 ? (
              <li
                data-depth={depth + 1}
                data-group-id={group.id}
                // The placeholder is a drop target too — hovering the empty
                // body is always an 'into' drop on the enclosing group, so a
                // user needn't aim at the header to fill an empty group.
                onDragOver={(e) => handleRowDragOver(e, group.id, 'into')}
                onDragLeave={() => handleRowDragLeave(group.id)}
                onDrop={(e) => handleRowDrop(e, group.id, 'into')}
                className="px-1.5 py-1 text-xs italic text-neutral-500"
              >
                Empty group
              </li>
            ) : (
              renderNodes(group.children, depth + 1, group.id)
            )}
          </ul>
        )}
      </li>
    );
  };

  const renderNodes = (nodes: readonly LayerNode[], depth: number, parentGroupId: string | null): ReactNode[] => {
    const out: ReactNode[] = [];
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      out.push(
        isGroupNode(node)
          ? renderGroupRow(node, depth, parentGroupId)
          : renderLeafRow(node, depth, parentGroupId),
      );
    }
    return out;
  };

  return (
    <ul
      onDragOver={(e) => handleTailDragOver(e, null)}
      onDrop={(e) => handleTailDrop(e, null)}
      // The pb runway only exists WHILE a drag is live: it gives the root
      // list a hoverable tail strip below the last row (the drop target for
      // the whole document's visual bottom) without padding the panel when
      // idle.
      className={`flex flex-col gap-0.5${draggingIds !== null ? ' pb-6' : ''}`}
    >
      {renderNodes(tree, 0, null)}
    </ul>
  );
}
