// The editor extension contract. This file is the Wave-5 API surface: a new
// tool / inspector / add-action / dialog is a NEW file under tools|inspectors|
// add-actions|dialogs that calls the matching register*() at module load. No
// existing file is edited to add one (see editor/README.md).
import type { ComponentType } from 'react';
import type { Camera } from './camera';
import type { DocState, Layer, Pt, Rect } from '@zpd/core';

export interface PanelDims {
  widthMm: number;
  heightMm: number;
}

// Everything a tool handler needs. `doc`, `camera`, `selectedIds` are LIVE
// getters (read the latest committed state, never a stale render closure), so
// a handler can read state it just mutated within the same gesture.
export interface ToolContext {
  readonly doc: DocState;
  readonly camera: Camera;
  readonly panel: PanelDims;
  // Multi-select contract (#44). `selectedIds` is the single source of truth:
  // always de-duplicated, filtered to layers present in `doc`, and in DOCUMENT
  // order (layers-array order, not click order) — see selection.ts.
  readonly selectedIds: readonly string[];
  // DERIVED single-selection views, kept so single-selection tools and
  // inspectors compile unchanged: non-null only when exactly ONE layer is
  // selected.
  readonly selectedId: string | null;
  readonly selectedLayer: Layer | null;
  // The flat Layer[] projection of doc.layers (#150): DFS leaf order — the
  // z-order the renderer paints — with ancestor `hidden` folded down. LIVE
  // like `doc`, and identity-STABLE per committed tree (memoized in
  // flat-projection.ts): text geometry treats array identity as
  // document-incarnation state, so read the flat view HERE — never
  // re-flatten doc.layers ad hoc.
  readonly flatLayers: readonly Layer[];

  // coordinate helpers (screen px relative to the canvas <-> document mm)
  toMm(screen: Pt): Pt;
  toScreen(mm: Pt): Pt;

  // document mutation, routed through the undo/redo history:
  //  - beginGesture() opens ONE undo entry, then stream replace() per move,
  //  - commit() is a standalone atomic change (its own undo entry),
  //  - reset() swaps the WHOLE document and clears past/future — for
  //    whole-document replacement (New-panel, import-replace), where the
  //    previous doc's undo history isn't meaningful for the next one. See
  //    replace-doc.ts, the shared entry point that also clears selection and
  //    evicts the stale image cache.
  commit(next: DocState): void;
  replace(next: DocState): void;
  reset(next: DocState): void;
  beginGesture(): void;
  undo(): void;
  redo(): void;

  // select(id) is the derived single-selection setter — sugar for
  // selectIds(id === null ? [] : [id]). Existing tools keep calling it.
  select(id: string | null): void;
  selectIds(ids: readonly string[]): void;
  setCamera(next: Camera | ((cam: Camera) => Camera)): void;
  setActiveTool(id: string): void;

  // ask the renderer to repaint (e.g. after a tool's own draft state changed)
  requestRepaint(): void;

  // Evicts renderer image-cache entries not backed by a same-id, same-src
  // image layer in `layers` — the cache stays Editor-local (Editor.tsx's
  // imagesRef), this is the only way another module can invalidate it. Used
  // by replace-doc.ts after a whole-document swap, where a fresh doc can
  // legitimately reuse an id with a different src.
  evictImageCache(layers: readonly Layer[]): void;

  openDialog(id: string, props?: unknown): void;
  closeDialog(): void;
}

// Normalized pointer event handed to tools — decoupled from React's synthetic
// event so tool handlers stay unit-testable with a plain object.
export interface ToolPointerEvent {
  screen: Pt; // px, relative to the canvas top-left
  mm: Pt; // document mm under the pointer
  button: number;
  buttons: number;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  pointerId: number;
  preventDefault(): void;
}

export interface ToolKeyEvent {
  key: string;
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault(): void;
}

// Passed to renderDraft — the tool draws its in-progress preview (pen path,
// marquee, …) on top of the committed scene. inMmSpace() runs the callback
// with the context pre-transformed so 1 unit == 1mm (like the layer pass).
export interface DraftRenderContext {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  panel: PanelDims;
  toScreen(mm: Pt): Pt;
  inMmSpace(draw: () => void): void;
}

// Handlers may return true to mark the event handled and stop app-level
// fallbacks (e.g. a tool that owns Enter/Esc). void === not handled.
export type ToolEventResult = boolean | void;

// Live multi/group-rotate gesture chrome (#152). `bounds`/`pivot` are FROZEN
// at gesture start (rotatable editable leaves only); `deltaDeg` is the live
// signed drag delta. The renderer draws the frozen bounds ctx-rotated by the
// delta instead of re-deriving live AABBs — a live union would pulsate and
// stay axis-aligned while the leaves visually rotate.
export interface MultiRotateChrome {
  bounds: Rect;
  pivot: Pt;
  deltaDeg: number;
}

export interface ToolModule {
  id: string;
  label: string;
  shortcut?: string; // single key, matched case-insensitively
  icon?: string;
  cursor?: string; // CSS cursor while this tool is active
  // 2-4 sentences for the sidebar Help panel (#36): what the tool does, key
  // pointer interactions, the shortcut. Optional — keeps the extension
  // contract backward-compatible for tools that don't supply one.
  description?: string;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  // The browser revoked the pointer (capture lost to the OS, touch
  // interruption, …). Contract (#152): treat EXACTLY as onPointerUp — close
  // local gesture state, no trailing commit; the streamed replaces already
  // hold the last applied change. Not routed at all before #152.
  onPointerCancel?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  // Pointer left the canvas element (#47): transient chrome keyed to the
  // cursor position (hover outlines, …) must clear here — no further
  // onPointerMove will arrive to do it.
  onPointerLeave?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  onDoubleClick?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  onKeyDown?(e: ToolKeyEvent, ctx: ToolContext): ToolEventResult;
  renderDraft?(draft: DraftRenderContext, ctx: ToolContext): void;
  // Non-null while this tool is streaming a multi/group-rotate gesture
  // (#152): the Editor forwards it into RenderExtras so the chrome pass can
  // draw the frozen start bounds rotated by the live delta instead of the
  // re-derived (pulsating) combined bbox. renderDraft cannot serve this —
  // it draws AFTER the chrome pass, too late to suppress it.
  multiRotateChrome?(ctx: ToolContext): MultiRotateChrome | null;
}

// --- inspectors -----------------------------------------------------------

export interface InspectorProps<L extends Layer = Layer> {
  layer: L;
  // Patch the layer. commit:false during a drag/scrub (coalesced), commit:true
  // for a discrete edit that should be its own undo entry.
  onChange(patch: Partial<L>, options?: { commit?: boolean }): void;
  ctx: ToolContext;
}

export type InspectorComponent<L extends Layer = Layer> = ComponentType<InspectorProps<L>>;

// --- add-actions (toolbar "add …" buttons) --------------------------------

export interface AddAction {
  id: string;
  label: string;
  icon?: string;
  run(ctx: ToolContext): void;
}

// --- dialogs --------------------------------------------------------------

// `C` is the context type the host hands this dialog. It defaults to
// ToolContext (what every read-only dialog needs), but a dialog that must run
// registry commands — the command palette — declares
// DialogProps<P, CommandContext> so it reads the richer context WITHOUT an
// `as unknown as` cast. The DialogHost's own ctx prop is typed CommandContext
// (see dialog-host.tsx), so Editor mis-wiring it fails typecheck rather than
// leaving a dialog with an undefined field at runtime.
export interface DialogProps<P = unknown, C extends ToolContext = ToolContext> {
  props: P;
  close(): void;
  ctx: C;
}

export interface DialogModule<P = unknown, C extends ToolContext = ToolContext> {
  id: string;
  component: ComponentType<DialogProps<P, C>>;
  // id of an element the dialog's own content renders (usually its heading)
  // that names the dialog. The host wires it to aria-labelledby on the
  // role="dialog" wrapper it owns — content can't set that attribute itself.
  labelledBy?: string;
}
