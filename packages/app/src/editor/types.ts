// The editor extension contract. This file is the Wave-5 API surface: a new
// tool / inspector / add-action / dialog is a NEW file under tools|inspectors|
// add-actions|dialogs that calls the matching register*() at module load. No
// existing file is edited to add one (see editor/README.md).
import type { ComponentType } from 'react';
import type { Camera } from './camera';
import type { DocState, Layer, Pt } from '@zpd/core';

export interface PanelDims {
  widthMm: number;
  heightMm: number;
}

// Everything a tool handler needs. `doc`, `camera`, `selectedId` are LIVE
// getters (read the latest committed state, never a stale render closure), so
// a handler can read state it just mutated within the same gesture.
export interface ToolContext {
  readonly doc: DocState;
  readonly camera: Camera;
  readonly panel: PanelDims;
  readonly selectedId: string | null;
  readonly selectedLayer: Layer | null;

  // coordinate helpers (screen px relative to the canvas <-> document mm)
  toMm(screen: Pt): Pt;
  toScreen(mm: Pt): Pt;

  // document mutation, routed through the undo/redo history:
  //  - beginGesture() opens ONE undo entry, then stream replace() per move,
  //  - commit() is a standalone atomic change (its own undo entry).
  commit(next: DocState): void;
  replace(next: DocState): void;
  beginGesture(): void;
  undo(): void;
  redo(): void;

  select(id: string | null): void;
  setCamera(next: Camera | ((cam: Camera) => Camera)): void;
  setActiveTool(id: string): void;

  // ask the renderer to repaint (e.g. after a tool's own draft state changed)
  requestRepaint(): void;

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
  onDoubleClick?(e: ToolPointerEvent, ctx: ToolContext): ToolEventResult;
  onKeyDown?(e: ToolKeyEvent, ctx: ToolContext): ToolEventResult;
  renderDraft?(draft: DraftRenderContext, ctx: ToolContext): void;
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

export interface DialogProps<P = unknown> {
  props: P;
  close(): void;
  ctx: ToolContext;
}

export interface DialogModule<P = unknown> {
  id: string;
  component: ComponentType<DialogProps<P>>;
}
