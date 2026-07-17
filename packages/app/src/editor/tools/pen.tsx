// Built-in pen tool (P) — draws bezier paths anchor by anchor. Click drops a
// corner anchor; click-drag pulls out mirrored bezier handles on that same
// anchor (a smooth anchor). Clicking near the first anchor (needs >=3) closes
// the path as a filled shape; Enter finishes it open (stroked); Esc cancels.
// Mirrors _temp-resource/1-panel-designer-proto/src/app.tsx's pen sections,
// ported onto the real ToolModule contract: the draft never touches ctx.doc
// until the path is finished, so the whole multi-click gesture collapses into
// exactly one ctx.commit() = one undo entry (no beginGesture/replace needed —
// unlike select.tsx's live-dragging gestures, nothing here is mid-flight in
// the document).
import { createRoot, type Root } from 'react-dom/client';
import {
  buildPath2D,
  mintId,
  snapToGrid,
  type PathLayer,
  type PathPoint,
  type Pt,
} from '@zpd/core';
import { registerTool } from '../registry/tools';
import { ChromeButton } from '../components/chrome';
import type { DraftRenderContext, ToolContext, ToolKeyEvent, ToolPointerEvent } from '../types';

const SNAP_MM = 0.1;
const CLOSE_THRESHOLD_PX = 9;
const DRAFT_COLOR = '#4da3ff';
const FIRST_ANCHOR_COLOR = '#ffd75e';

const snap = (v: number) => snapToGrid(v, SNAP_MM);

export interface PenDraft {
  points: PathPoint[];
  cursorMm: Pt | null; // where to rubber-band the preview to; null while dragging a handle
}

// --- pure draft-state transitions (exported for direct unit testing) ------

// click: append a corner anchor (grid-snapped, no handles) at mm.
export function addCornerAnchor(draft: PenDraft | null, mm: Pt): PenDraft {
  const point: PathPoint = { x: snap(mm.x), y: snap(mm.y) };
  return { points: draft ? [...draft.points, point] : [point], cursorMm: null };
}

// click-drag: pull mirrored hout/hin handles out of the anchor just placed,
// turning it into a smooth anchor. Handle coords are left unsnapped, like the
// anchors' own bezier controls in the reference implementation.
export function dragLastAnchorHandle(draft: PenDraft, mm: Pt): PenDraft {
  if (draft.points.length === 0) return draft;
  const points = draft.points.slice();
  const last = points[points.length - 1];
  const hout = { x: mm.x, y: mm.y };
  const hin = { x: last.x * 2 - mm.x, y: last.y * 2 - mm.y };
  points[points.length - 1] = { ...last, hout, hin };
  return { ...draft, points };
}

export function setCursor(draft: PenDraft, mm: Pt | null): PenDraft {
  return { ...draft, cursorMm: mm };
}

// screen-space hit test against the first anchor — needs >=3 anchors so a
// 2-point draft can never "close" into a degenerate zero-area path.
export function isNearFirstAnchor(
  draft: PenDraft,
  screen: Pt,
  toScreen: (mm: Pt) => Pt,
  thresholdPx: number = CLOSE_THRESHOLD_PX,
): boolean {
  if (draft.points.length < 3) return false;
  const first = toScreen(draft.points[0]);
  return Math.hypot(first.x - screen.x, first.y - screen.y) < thresholdPx;
}

export function canClosePath(draft: PenDraft | null): draft is PenDraft {
  return !!draft && draft.points.length >= 3;
}

export function canFinishOpen(draft: PenDraft | null): draft is PenDraft {
  return !!draft && draft.points.length >= 2;
}

// closed path = filled gold shape, no stroke.
export function buildClosedPathLayer(draft: PenDraft): PathLayer {
  return {
    id: mintId('path'),
    name: 'Path',
    type: 'path',
    points: draft.points,
    closed: true,
    fill: 1,
    stroke: null,
    strokeWidth: 0,
  };
}

// open path = gold stroke, no fill.
export function buildOpenPathLayer(draft: PenDraft): PathLayer {
  return {
    id: mintId('path'),
    name: 'Path',
    type: 'path',
    points: draft.points,
    closed: false,
    fill: null,
    stroke: 1,
    strokeWidth: 0.6,
  };
}

// --- module-scope gesture state (one active draft at a time) --------------

let draft: PenDraft | null = null;
let penDragging = false; // between pointerDown and pointerUp for the anchor just placed
let currentCtx: ToolContext | null = null; // for the hint-bar buttons' click handlers
let hintContainer: HTMLDivElement | null = null;
let hintRoot: Root | null = null;

function finishClosed(ctx: ToolContext): void {
  const current = draft;
  if (!canClosePath(current)) return;
  const layer = buildClosedPathLayer(current);
  ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
  ctx.select(layer.id);
  ctx.setActiveTool('select');
  resetDraft(ctx);
}

function finishOpen(ctx: ToolContext): void {
  const current = draft;
  if (!canFinishOpen(current)) return;
  const layer = buildOpenPathLayer(current);
  ctx.commit({ ...ctx.doc, layers: [...ctx.doc.layers, layer] });
  ctx.select(layer.id);
  ctx.setActiveTool('select');
  resetDraft(ctx);
}

function resetDraft(ctx: ToolContext): void {
  draft = null;
  penDragging = false;
  notify(ctx);
}

// repaint the canvas draft preview and the hint bar's enabled/disabled state
function notify(ctx: ToolContext): void {
  ctx.requestRepaint();
  renderHintBar();
}

// Pure presentational piece, exported so it's unit-testable via
// @testing-library/react in isolation (render + fireEvent) without going
// through the manual createRoot mount below. The three callbacks are always
// the SAME finishClosed/finishOpen/resetDraft functions the gestures call —
// no parallel button-only logic.
export interface PenHintBarProps {
  draft: PenDraft | null;
  onClosePath(): void;
  onFinishOpen(): void;
  onCancel(): void;
}

export function PenHintBar({ draft, onClosePath, onFinishOpen, onCancel }: PenHintBarProps) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs whitespace-nowrap text-neutral-300 shadow-lg backdrop-blur select-none">
      <span>
        click: add anchor · drag: curve · click first anchor: close · Enter: finish open · Esc:
        cancel
      </span>
      <span className="pointer-events-auto flex gap-1.5">
        <ChromeButton disabled={!canClosePath(draft)} onClick={onClosePath}>
          ⬠ Close path
        </ChromeButton>
        <ChromeButton disabled={!canFinishOpen(draft)} onClick={onFinishOpen}>
          Finish open
        </ChromeButton>
        <ChromeButton disabled={!draft} onClick={onCancel}>
          Cancel
        </ChromeButton>
      </span>
    </div>
  );
}

function renderHintBar(): void {
  if (!hintRoot || !currentCtx) return;
  const ctx = currentCtx;
  hintRoot.render(
    <PenHintBar
      draft={draft}
      onClosePath={() => finishClosed(ctx)}
      onFinishOpen={() => finishOpen(ctx)}
      onCancel={() => resetDraft(ctx)}
    />,
  );
}

registerTool({
  id: 'pen',
  label: 'Pen',
  shortcut: 'p',
  icon: '✒',
  cursor: 'crosshair',
  description:
    'Click to drop a corner anchor; click-drag pulls out bezier handles for a curved anchor. Click ' +
    'back on the first anchor (3+ points) to close the path into a filled shape, or press Enter to ' +
    'finish it open as a stroked line. Esc cancels the in-progress path. Shortcut: P.',
  onActivate(ctx: ToolContext) {
    draft = null;
    penDragging = false;
    currentCtx = ctx;
    // self-contained hint bar: ToolModule has no chrome slot, so the pen owns
    // its own mounted React tree (unmounted in onDeactivate). Guarded for the
    // node test environment, which has no document.
    if (typeof document === 'undefined') return;
    hintContainer = document.createElement('div');
    document.body.appendChild(hintContainer);
    hintRoot = createRoot(hintContainer);
    renderHintBar();
  },
  onDeactivate() {
    draft = null;
    penDragging = false;
    currentCtx = null;
    hintRoot?.unmount();
    hintRoot = null;
    hintContainer?.remove();
    hintContainer = null;
  },
  onPointerDown(e: ToolPointerEvent, ctx: ToolContext) {
    currentCtx = ctx;
    if (draft && isNearFirstAnchor(draft, e.screen, ctx.toScreen)) {
      finishClosed(ctx);
      return;
    }
    draft = addCornerAnchor(draft, e.mm);
    penDragging = true;
    notify(ctx);
  },
  onPointerMove(e: ToolPointerEvent, ctx: ToolContext) {
    if (!draft) return;
    draft = penDragging ? dragLastAnchorHandle(draft, e.mm) : setCursor(draft, e.mm);
    notify(ctx);
  },
  onPointerUp() {
    penDragging = false;
  },
  onKeyDown(e: ToolKeyEvent, ctx: ToolContext) {
    if (e.key === 'Enter') {
      finishOpen(ctx);
      return true;
    }
    if (e.key === 'Escape') {
      resetDraft(ctx);
      return true;
    }
    return false;
  },
  renderDraft(d: DraftRenderContext) {
    if (!draft || draft.points.length === 0) return;
    const points = draft.points;
    const cursorMm = draft.cursorMm;
    d.inMmSpace(() => {
      const path = buildPath2D(points, false);
      if (path) {
        d.ctx.strokeStyle = DRAFT_COLOR;
        d.ctx.lineWidth = 1.5 / d.camera.pxPerMm;
        d.ctx.stroke(path);
      }
      if (cursorMm) {
        const last = points[points.length - 1];
        const c1 = last.hout ?? { x: last.x, y: last.y };
        d.ctx.save();
        d.ctx.setLineDash([4 / d.camera.pxPerMm, 3 / d.camera.pxPerMm]);
        d.ctx.strokeStyle = DRAFT_COLOR;
        d.ctx.lineWidth = 1 / d.camera.pxPerMm;
        d.ctx.beginPath();
        d.ctx.moveTo(last.x, last.y);
        d.ctx.bezierCurveTo(c1.x, c1.y, cursorMm.x, cursorMm.y, cursorMm.x, cursorMm.y);
        d.ctx.stroke();
        d.ctx.restore();
      }
    });

    // anchor markers in screen space — first anchor highlighted (it's also
    // the close target)
    points.forEach((p, i) => {
      const ap = d.toScreen(p);
      d.ctx.fillStyle = i === 0 ? FIRST_ANCHOR_COLOR : '#ffffff';
      d.ctx.strokeStyle = DRAFT_COLOR;
      d.ctx.lineWidth = 1.5;
      d.ctx.fillRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
      d.ctx.strokeRect(ap.x - 3.5, ap.y - 3.5, 7, 7);
    });
  },
});
