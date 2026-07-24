// Layer list — recursive TREE rendering (#153). Rows render in TRUE z-order:
// reversed DFS at EVERY level (not just top-level), so a group's header
// interleaves exactly where its z-band sits and nested children keep
// top-of-stack-first order too. Select / show-hide / rename / delete /
// group-cascade-delete / ungroup / local reorder / drag-and-drop (#154, see
// layer-list-dnd.ts) all go through @zpd/core tree ops so ordering +
// immutability semantics live in one place.
import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  deletePcbNodeById,
  findPcbNodeById,
  isGroupNode,
  movePcbNode,
  PALETTE,
  PCB_LAYER_DEFINITIONS,
  projectPcbLayerStack,
  togglePcbLayerHidden,
  ungroupPcbNode,
  updatePcbNodeById,
  walkLayerNodes,
  type ColorIndex,
  type GroupNode,
  type Layer,
  type LayerNode,
  type PcbLayerRole,
  type PcbLayerStack,
} from '@zpd/core';
import { nextListSelection } from '../selection';
import { maximalPcbSelectedRoots, toggleLeafSelection } from '../selection-resolve';
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
  // The committed render-time stack. Production always supplies this from
  // Sidebar; the fallback keeps isolated component harnesses concise.
  stack?: PcbLayerStack;
  selectedIds: readonly string[];
}

// Editor's window keydown handler owns Space as temporary pan whenever the
// event reaches it. Native buttons need an un-cancelled Space keydown to emit
// their click, so activation stays local while retaining the browser's native
// Enter/Space button behavior.
function keepButtonActivationLocal(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
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
  stack: PcbLayerStack,
  id: string,
): { role: PcbLayerRole; parentId: string | null; index: number } | null {
  const found = findPcbNodeById(stack, id);
  if (!found) return null;
  const parentId = found.pathIds[found.pathIds.length - 1] ?? null;
  const siblings =
    parentId === null
      ? found.container.children
      : (findPcbNodeById(stack, parentId)?.node as GroupNode | undefined)?.children;
  if (!siblings) return null;
  const index = siblings.findIndex((n) => n.id === id);
  return index < 0 ? null : { role: found.role, parentId, index };
}

// Every id (leaf or nested group) strictly BENEATH `id` — empty when `id`
// is a leaf or not found. Used to enforce the #151 overlap invariant when a
// GROUP id joins the selection: any already-selected descendant must drop
// out (see handleRowClick's Meta branch).
function collectDescendantIds(stack: PcbLayerStack, id: string): Set<string> {
  const found = findPcbNodeById(stack, id);
  const out = new Set<string>();
  if (found && isGroupNode(found.node)) {
    walkLayerNodes(found.node.children, (node) => out.add(node.id));
  }
  return out;
}

export function LayerList({ ctx, stack: committedStack, selectedIds }: LayerListProps) {
  const stack = committedStack ?? ctx.doc.layers;
  const flatById = useMemo(
    () => new Map(projectPcbLayerStack(stack).map((layer) => [layer.id, layer])),
    [stack],
  );

  // Expand/collapse (#153): session-only, keyed by STABLE node id (never
  // array index — index keys remount and drop state when order changes).
  // Not persisted, not document state, not in undo history. Default is
  // expanded (empty set = nothing collapsed).
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [collapsedMaterialRoles, setCollapsedMaterialRoles] = useState<Set<PcbLayerRole>>(
    () => new Set(),
  );
  const toggleCollapsed = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleMaterialCollapsed = (role: PcbLayerRole) => {
    setCollapsedMaterialRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    const rows: VisibleRow[] = [];
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const container = stack[i];
      if (!collapsedMaterialRoles.has(container.role)) {
        collectVisibleRows(container.children, collapsedGroupIds, flatById, rows);
      }
    }
    return rows;
  }, [stack, collapsedGroupIds, collapsedMaterialRoles, flatById]);
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
    const ids = selectedIds.includes(rowId) ? maximalPcbSelectedRoots(stack, selectedIds) : [rowId];
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
    const slot = resolveDropSlot(stack, rowId, zone, dragging, collapsedGroupIds);
    const reason: DropRejection | null =
      slot === null ? 'cycle' : invalidDropReason(stack, slot, dragging);
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
    if (invalidDropReason(stack, slot, dragging) !== null) return;
    const nextStack = executeDrop(stack, dragging, slot);
    // Same-reference = the batch was a no-op (dropped onto its own slot) —
    // no phantom history entry.
    if (nextStack === stack) return;
    // One commit for the whole multi-root batch = ONE history entry.
    ctx.commit({ ...ctx.doc, layers: nextStack });
  };

  const handleRowDrop = (e: DragEvent<HTMLElement>, rowId: string, zone: DropZone) => {
    const dragging = draggingIdsRef.current; // ref, not state — see twin note above
    clearDragState();
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    commitDrop(resolveDropSlot(stack, rowId, zone, dragging, collapsedGroupIds), dragging);
  };

  // Tail area of a rows <ul> (the space that is the list itself, not any
  // row): drops land at that container's visual BOTTOM (array index 0). The
  // guard on target === currentTarget keeps bubbled row events out — row
  // handlers stopPropagation for internal drags, so only a hover over the
  // list's own empty runway arrives here as a direct target. This is the
  // outdent path below an expanded group's subtree (see resolveTailDropSlot).
  const handleTailDragOver = (
    e: DragEvent<HTMLElement>,
    role: PcbLayerRole,
    parentId: string | null,
  ) => {
    if (e.target !== e.currentTarget) return;
    const dragging = draggingIdsRef.current;
    if (!dragging) return;
    const slot = resolveTailDropSlot(stack, role, parentId, dragging);
    if (slot !== null && invalidDropReason(stack, slot, dragging) === null) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    } else if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'none';
    }
  };

  const handleTailDrop = (
    e: DragEvent<HTMLElement>,
    role: PcbLayerRole,
    parentId: string | null,
  ) => {
    if (e.target !== e.currentTarget) return;
    const dragging = draggingIdsRef.current;
    clearDragState();
    if (!dragging) return;
    e.preventDefault();
    commitDrop(resolveTailDropSlot(stack, role, parentId, dragging), dragging);
  };

  // Affordance attributes/classes for the row currently hovered by a drag.
  // data-drop / data-drop-invalid are the test-visible contract; aria-disabled
  // is the accessible "this target is rejected" signal the issue asks for.
  const dropAffordance = (rowId: string) => {
    const indicator =
      dropIndicator !== null && dropIndicator.rowId === rowId ? dropIndicator : null;
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
      const stripped = toggleLeafSelection(stack, selectedIds, id);
      const next2 = stripped.includes(id)
        ? stripped.filter((sid) => sid === id || !collectDescendantIds(stack, id).has(sid))
        : stripped;
      ctx.selectIds(next2);
    } else if (e.shiftKey) {
      // A visible-row range can sweep in a group header AND its expanded
      // descendant rows — maximalSelectedRoots collapses that to just the
      // group (dropping the covered descendants), so the #151
      // [group, descendant] overlap invariant holds for every range. Rows
      // not covered by any ranged group survive as-is, in tree DFS order.
      ctx.selectIds(maximalPcbSelectedRoots(stack, next.selectedIds));
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
    const slot = locateLocalSlot(stack, id);
    if (!slot) return;
    const next = movePcbNode(stack, id, slot.role, slot.parentId, slot.index + dir);
    // moveNodeToParent returns the SAME reference when the move clamps back
    // to the node's own slot (already at the top/bottom of its local stack)
    // — don't write a phantom undo entry for that.
    if (next === stack) return;
    ctx.commit({ ...ctx.doc, layers: next });
  };

  const remove = (id: string) => {
    const found = findPcbNodeById(stack, id);
    // Cascade (#148): deleting a group removes every descendant with it —
    // collect the whole removed-subtree id set so selection drops all of
    // them, not just the group's own id.
    const removedIds = new Set<string>([id]);
    if (found && isGroupNode(found.node)) {
      walkLayerNodes([found.node], (node) => removedIds.add(node.id));
    }
    const renderedIndex = visibleRowIds.indexOf(id);
    const nextStack = deletePcbNodeById(stack, id);
    const nextFlatById = new Map(projectPcbLayerStack(nextStack).map((l) => [l.id, l]));
    const nextRows: VisibleRow[] = [];
    for (let i = nextStack.length - 1; i >= 0; i -= 1) {
      const container = nextStack[i];
      if (!collapsedMaterialRoles.has(container.role)) {
        collectVisibleRows(container.children, collapsedGroupIds, nextFlatById, nextRows);
      }
    }
    const nextVisibleRowIds = nextRows.map((row) => row.id);
    const nextFocusId =
      renderedIndex < 0
        ? currentFocusId
        : (nextVisibleRowIds[Math.min(renderedIndex, nextVisibleRowIds.length - 1)] ?? null);

    ctx.commit({ ...ctx.doc, layers: nextStack });
    setFocusedRowId(nextFocusId);
    if (nextFocusId) selectionButtonRefs.current.get(nextFocusId)?.focus();
    // Multi-capable drop-from-selection (#44): drop every removed id (the
    // whole cascaded subtree for a group) out of the selection in one call.
    if (selectedIds.some((sid) => removedIds.has(sid))) {
      ctx.selectIds(selectedIds.filter((sid) => !removedIds.has(sid)));
    }
  };

  const ungroup = (groupId: string) => {
    const found = findPcbNodeById(stack, groupId);
    if (!found || !isGroupNode(found.node)) return;
    const childIds = found.node.children.map((child) => child.id);
    const nextStack = ungroupPcbNode(stack, groupId);
    if (nextStack === stack) return;
    ctx.commit({ ...ctx.doc, layers: nextStack });
    // Releasing a selected group's children in its place (#153): the group
    // id no longer exists, so swap it for the children it just released —
    // maximalSelectedRoots re-collapses the result in case any of those
    // children were ALSO independently selected already (overlap guard,
    // #151's invariant).
    if (selectedIds.includes(groupId)) {
      const expanded = selectedIds.flatMap((sid) => (sid === groupId ? childIds : [sid]));
      ctx.selectIds(maximalPcbSelectedRoots(nextStack, expanded));
    }
  };

  const toggle = (id: string) => {
    // Recursive toggle (#148/#150): flips the node's OWN hidden flag at any
    // depth — a group's toggle folds to every descendant at flatten time.
    const next = updatePcbNodeById(stack, id, (node) => ({ ...node, hidden: !node.hidden }));
    if (next !== stack) ctx.commit({ ...ctx.doc, layers: next });
  };

  const toggleMaterialVisibility = (role: PcbLayerRole) => {
    const next = togglePcbLayerHidden(stack, role);
    if (next !== stack) ctx.commit({ ...ctx.doc, layers: next });
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
    const next = updatePcbNodeById(stack, id, (node) => ({ ...node, name: draftName.trim() }));
    if (next !== stack) ctx.commit({ ...ctx.doc, layers: next });
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
        const next = updatePcbNodeById(stack, group.id, (node) => ({ ...node, name: trimmed }));
        if (next !== stack) ctx.commit({ ...ctx.doc, layers: next });
      }
    }
    setRenamingId(null);
  };

  const moveSelectionFocus = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      // Keep the editor's window-level shortcut handler from turning Space
      // into temporary pan mode. Do not preventDefault: the button's native
      // Enter/Space click must remain the selection activation path.
      keepButtonActivationLocal(event);
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
        className={`flex min-h-7 items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
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
          className="flex min-h-6 min-w-6 shrink-0 items-center gap-1.5 rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
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
            aria-label={`Bring ${layer.name || layer.type} forward`}
            className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
            onClick={(e) => {
              e.stopPropagation();
              move(layer.id, 1);
            }}
          >
            ▲
          </button>
          <button
            title="Send backward"
            aria-label={`Send ${layer.name || layer.type} backward`}
            className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
            onClick={(e) => {
              e.stopPropagation();
              move(layer.id, -1);
            }}
          >
            ▼
          </button>
          <button
            title="Show / hide"
            aria-label={
              layer.hidden ? `Show ${layer.name || layer.type}` : `Hide ${layer.name || layer.type}`
            }
            className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
            onClick={(e) => {
              e.stopPropagation();
              toggle(layer.id);
            }}
          >
            {layer.hidden ? '🚫' : '👁'}
          </button>
          <button
            title="Delete"
            aria-label={`Delete ${layer.name || layer.type}`}
            className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
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

  const renderGroupRow = (
    group: GroupNode,
    depth: number,
    parentGroupId: string | null,
    role: PcbLayerRole,
  ): ReactNode => {
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
          className={`flex min-h-7 items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
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
            className="flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-sm p-0.5 text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
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
            className="flex min-h-6 min-w-6 shrink-0 items-center gap-1.5 rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
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
              className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
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
              className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
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
              className="min-h-6 min-w-6 rounded-sm focus-visible:outline-2 focus-visible:outline-sky-400"
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
            onDragOver={(e) => handleTailDragOver(e, role, group.id)}
            onDrop={(e) => handleTailDrop(e, role, group.id)}
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
              renderNodes(group.children, depth + 1, group.id, role)
            )}
          </ul>
        )}
      </li>
    );
  };

  const renderNodes = (
    nodes: readonly LayerNode[],
    depth: number,
    parentGroupId: string | null,
    role: PcbLayerRole,
  ): ReactNode[] => {
    const out: ReactNode[] = [];
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      out.push(
        isGroupNode(node)
          ? renderGroupRow(node, depth, parentGroupId, role)
          : renderLeafRow(node, depth, parentGroupId),
      );
    }
    return out;
  };

  return (
    <div className="flex flex-col gap-2" aria-label="PCB material layers">
      {[...stack].reverse().map((container) => {
        const definition = PCB_LAYER_DEFINITIONS.find(({ role }) => role === container.role)!;
        const collapsed = collapsedMaterialRoles.has(container.role);
        const headingId = `pcb-material-${container.role}`;
        // Solder mask is negative: a shape placed here doesn't paint mask —
        // it OPENS one, revealing copper (or bare substrate) beneath. Nothing
        // else in this row's visuals hints at that, so spell it out via a
        // hover tooltip plus screen-reader-only text folded into the
        // section's accessible name (aria-labelledby={headingId}).
        const openingsHint =
          container.role === 'solder-mask'
            ? 'Objects on this layer open the mask, revealing copper beneath'
            : null;
        return (
          <section
            key={container.role}
            aria-labelledby={headingId}
            data-material-role={container.role}
            className="overflow-hidden rounded-md border border-neutral-700 bg-neutral-950/40"
          >
            <div
              title={openingsHint ?? undefined}
              className="flex min-h-8 items-center gap-1 border-b border-neutral-700 bg-neutral-800/80 px-1.5 text-xs font-medium text-neutral-100"
            >
              <button
                type="button"
                aria-label={collapsed ? `Expand ${definition.name}` : `Collapse ${definition.name}`}
                aria-expanded={!collapsed}
                onClick={() => toggleMaterialCollapsed(container.role)}
                onKeyDown={keepButtonActivationLocal}
                className="flex min-h-6 min-w-6 items-center justify-center rounded-sm text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
              >
                <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
              </button>
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 rounded-sm border border-neutral-500"
                style={{ background: PALETTE[definition.color].hex }}
              />
              <span id={headingId} className="min-w-0 flex-1 truncate">
                {definition.name}
                {openingsHint && <span className="sr-only"> — {openingsHint}</span>}
              </span>
              <span className="text-[10px] font-normal text-neutral-400">
                {PALETTE[definition.color].name}
              </span>
              <button
                type="button"
                title="Show / hide"
                aria-label={
                  container.hidden ? `Show ${definition.name}` : `Hide ${definition.name}`
                }
                onClick={() => toggleMaterialVisibility(container.role)}
                onKeyDown={keepButtonActivationLocal}
                className="min-h-6 min-w-6 rounded-sm text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-400"
              >
                {container.hidden ? '🚫' : '👁'}
              </button>
            </div>
            {!collapsed && (
              <ul
                aria-label={`${definition.name} layers`}
                onDragOver={(e) => handleTailDragOver(e, container.role, null)}
                onDrop={(e) => handleTailDrop(e, container.role, null)}
                className={`flex min-h-7 flex-col gap-0.5 p-1${draggingIds !== null ? ' pb-6' : ''}`}
              >
                {container.children.length > 0 &&
                  renderNodes(container.children, 0, null, container.role)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
