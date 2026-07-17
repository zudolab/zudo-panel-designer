// === Guide pointer routing (cross-component drag) — DELIBERATE DESIGN ===
//
// A guide drag begins in ONE component and continues across others: a create
// drag starts on a ruler STRIP and moves onto the CANVAS; a delete drag starts
// on the canvas (grabbing an existing guide) and moves back over a RULER. These
// are three sibling elements in a CSS grid, so per-element React pointer
// handlers alone cannot follow a drag that crosses element boundaries.
//
// APPROACH: window-level pointer tracking driven by an ephemeral drag record,
// started by a pointerdown on either source and resolved by GEOMETRY against
// the live canvas rect.
//
//   1. Two entry points feed one controller:
//        - RulerStrip pointerdown -> startCreate(orientation): orientation is
//          fixed by which strip fired (top = horizontal, left = vertical).
//        - Canvas pointerdown, checked BEFORE tool routing -> tryGrabOnCanvas:
//          if the pointer is within GUIDE_GRAB_TOLERANCE_PX of an existing
//          non-hidden guide, start a MOVE drag and swallow the event so the
//          active tool never sees it.
//   2. On drag start we install pointermove/pointerup listeners on WINDOW (not
//      on any one element). Window listeners receive every move/up regardless
//      of which element the pointer is over — that is what makes the
//      cross-element drag work without juggling setPointerCapture across three
//      elements.
//   3. Each move: clientX/Y - canvasRect -> mm via the live camera, updating the
//      draft position; overCanvas = pointer inside the canvas rect. The draft is
//      handed to the renderer to paint a live preview line.
//   4. pointerup resolves as a SINGLE commit (one undo entry):
//        - create + drop over canvas  -> append a new Guide
//        - create + drop off canvas   -> discard (no commit)
//        - move   + drop over canvas  -> commit the guide at its new position
//        - move   + drop off canvas   -> commit with the guide removed (delete)
//
// WHY window listeners over setPointerCapture: capture binds all events to ONE
// element, but this drag legitimately needs to know when the pointer is over a
// DIFFERENT element (a ruler, to delete) — capture would mask that. Reading
// geometry from window events against the canvas rect gives BOTH continuity and
// cross-element awareness. (Canvas TOOL drags still use setPointerCapture in
// Editor.tsx — those never leave the canvas, so capture is correct there;
// guides are the boundary-crossing exception.)
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DocState, GuideOrientation } from '@zpd/core';
import type { Camera } from './camera';
import {
  addGuide,
  createGuide,
  guideAtPoint,
  positionForPoint,
  removeGuide,
  updateGuidePosition,
  type GuideDraft,
} from './guides';

// Stable getters into the Editor's live refs, so the window listeners always
// read current state without re-subscribing on every render.
export interface GuideDragDeps {
  getCamera: () => Camera | null;
  getDoc: () => DocState;
  getCanvasRect: () => DOMRect | null;
  commit: (next: DocState) => void;
  isEnabled: () => boolean; // the "Show guides" master toggle
}

export interface GuideDragController {
  draft: GuideDraft | null;
  startCreate: (orientation: GuideOrientation, e: ReactPointerEvent) => void;
  /** Returns true if it grabbed an existing guide (caller must NOT route to the tool). */
  tryGrabOnCanvas: (e: ReactPointerEvent) => boolean;
}

interface ActiveDrag {
  orientation: GuideOrientation;
  movingId: string | null; // null = create-from-ruler; id = move existing
}

function resolvePoint(
  orientation: GuideOrientation,
  cam: Camera,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): { position: number; overCanvas: boolean } {
  const local = { x: clientX - rect.left, y: clientY - rect.top };
  const overCanvas =
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  return { position: positionForPoint(orientation, cam, local), overCanvas };
}

export function useGuideDrag(deps: GuideDragDeps): GuideDragController {
  const [draft, setDraft] = useState<GuideDraft | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const cam = deps.getCamera();
      const rect = deps.getCanvasRect();
      if (!cam || !rect) return;
      const { position, overCanvas } = resolvePoint(
        drag.orientation,
        cam,
        rect,
        e.clientX,
        e.clientY,
      );
      setDraft({ orientation: drag.orientation, position, movingId: drag.movingId, overCanvas });
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDraft(null);
      const cam = deps.getCamera();
      const rect = deps.getCanvasRect();
      if (!cam || !rect) return;
      const { position, overCanvas } = resolvePoint(
        drag.orientation,
        cam,
        rect,
        e.clientX,
        e.clientY,
      );
      const doc = deps.getDoc();
      if (drag.movingId === null) {
        // create: only if released over the canvas; off-canvas cancels
        if (overCanvas) deps.commit(addGuide(doc, createGuide(drag.orientation, position)));
      } else if (overCanvas) {
        deps.commit(updateGuidePosition(doc, drag.movingId, position));
      } else {
        // dragged back off the canvas (onto a ruler) -> delete
        deps.commit(removeGuide(doc, drag.movingId));
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [deps]);

  const begin = (drag: ActiveDrag, e: ReactPointerEvent) => {
    dragRef.current = drag;
    const cam = deps.getCamera();
    const rect = deps.getCanvasRect();
    if (!cam || !rect) return;
    const { position, overCanvas } = resolvePoint(drag.orientation, cam, rect, e.clientX, e.clientY);
    setDraft({ orientation: drag.orientation, position, movingId: drag.movingId, overCanvas });
  };

  const startCreate = (orientation: GuideOrientation, e: ReactPointerEvent) => {
    if (!deps.isEnabled()) return;
    e.preventDefault();
    begin({ orientation, movingId: null }, e);
  };

  const tryGrabOnCanvas = (e: ReactPointerEvent): boolean => {
    if (!deps.isEnabled()) return false;
    const cam = deps.getCamera();
    const rect = deps.getCanvasRect();
    if (!cam || !rect) return false;
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = guideAtPoint(deps.getDoc().guides, cam, local);
    if (!hit) return false;
    e.preventDefault();
    begin({ orientation: hit.orientation, movingId: hit.id }, e);
    return true;
  };

  return { draft, startCreate, tryGrabOnCanvas };
}
