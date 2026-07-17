// Pure guide geometry + document mutations. All the math the guide UI needs
// (screen<->mm mapping for a guide line, ruler-drag hit-testing, and the
// DocState edits create/move/delete apply) lives here so the pointer-routing
// controller (use-guide-drag.ts) and the renderer stay side-effect-thin and
// this logic is unit-testable without React or a Canvas.
//
// Guides are VIEW FURNITURE, not layers — they live in DocState.guides, never
// in doc.layers, so they can never appear in the layer list.
import { mintId, type DocState, type Guide, type GuideOrientation } from '@zpd/core';
import type { Camera } from './camera';

// How near (screen px) the pointer must be to a guide line to grab it on the
// canvas. Generous enough to catch a 1px line at any zoom without fighting
// layer selection underneath.
export const GUIDE_GRAB_TOLERANCE_PX = 5;

// The perpendicular-axis SCREEN px a guide's line sits at, for the current
// camera. A horizontal guide (y = position) maps to a screen y; a vertical
// guide (x = position) maps to a screen x. Both use the same mm->px mapping as
// camera.project, applied to the one axis the line is fixed on.
export function guideScreenCoord(guide: Guide, cam: Camera): number {
  return guide.orientation === 'horizontal'
    ? guide.position * cam.pxPerMm + cam.offsetY
    : guide.position * cam.pxPerMm + cam.offsetX;
}

// mm position for a guide of `orientation` under a canvas-local screen point.
// Inverse of guideScreenCoord along the relevant axis. Rounded to 0.01mm so a
// dragged guide lands on a clean value instead of float drift.
export function positionForPoint(
  orientation: GuideOrientation,
  cam: Camera,
  screenPt: { x: number; y: number },
): number {
  const raw =
    orientation === 'horizontal'
      ? (screenPt.y - cam.offsetY) / cam.pxPerMm
      : (screenPt.x - cam.offsetX) / cam.pxPerMm;
  return Math.round(raw * 100) / 100;
}

// The nearest non-hidden guide whose line is within `tolerancePx` of the
// canvas-local point, or null. Hidden guides are never grabbable (they render
// faintly and don't snap — #55), so a drag can't accidentally pick one up.
export function guideAtPoint(
  guides: readonly Guide[],
  cam: Camera,
  screenPt: { x: number; y: number },
  tolerancePx = GUIDE_GRAB_TOLERANCE_PX,
): Guide | null {
  let best: Guide | null = null;
  let bestDist = tolerancePx;
  for (const guide of guides) {
    if (guide.hidden) continue;
    const coord = guideScreenCoord(guide, cam);
    const dist = Math.abs(
      guide.orientation === 'horizontal' ? screenPt.y - coord : screenPt.x - coord,
    );
    if (dist <= bestDist) {
      bestDist = dist;
      best = guide;
    }
  }
  return best;
}

export function createGuide(orientation: GuideOrientation, position: number): Guide {
  return { id: mintId('guide'), orientation, position };
}

export function addGuide(doc: DocState, guide: Guide): DocState {
  return { ...doc, guides: [...doc.guides, guide] };
}

export function updateGuidePosition(doc: DocState, id: string, position: number): DocState {
  return {
    ...doc,
    guides: doc.guides.map((g) => (g.id === id ? { ...g, position } : g)),
  };
}

export function removeGuide(doc: DocState, id: string): DocState {
  return { ...doc, guides: doc.guides.filter((g) => g.id !== id) };
}

// The live drag record the controller hands to the renderer to paint a preview.
// `movingId === null` is a create-from-ruler drag; a non-null id is an existing
// guide being repositioned (or deleted, when it leaves the canvas).
export interface GuideDraft {
  orientation: GuideOrientation;
  position: number; // mm, preview position under the pointer
  movingId: string | null;
  overCanvas: boolean; // pointer is inside the canvas viewport right now
}
