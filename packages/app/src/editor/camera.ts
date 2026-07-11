// Camera = the mm->screen-px mapping. project/unproject are an exact inverse
// pair; pxPerMm doubles as the zoom value. Modeled on pgen lite-composer's
// coordinate model and the working proto camera (see
// _temp-resource/1-panel-designer-proto/src/camera.ts).
import type { Pt } from '@zpd/core';

export interface Camera {
  pxPerMm: number;
  offsetX: number; // screen px of panel origin (mm 0,0)
  offsetY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

// Zoom clamp. 0.5px/mm still shows a whole 20HP panel comfortably; 100px/mm
// is deep enough for 0.1mm node editing without the numbers going silly.
export const MIN_PX_PER_MM = 0.5;
export const MAX_PX_PER_MM = 100;

export function clampZoom(pxPerMm: number): number {
  return Math.max(MIN_PX_PER_MM, Math.min(MAX_PX_PER_MM, pxPerMm));
}

export function project(cam: Camera, mm: Pt): Pt {
  return { x: mm.x * cam.pxPerMm + cam.offsetX, y: mm.y * cam.pxPerMm + cam.offsetY };
}

export function unproject(cam: Camera, screen: Pt): Pt {
  return { x: (screen.x - cam.offsetX) / cam.pxPerMm, y: (screen.y - cam.offsetY) / cam.pxPerMm };
}

// Center the panel in the viewport at the largest zoom that leaves `margin`
// px of breathing room on every side (clamped to the sane zoom range).
export function fit(
  panelWmm: number,
  panelHmm: number,
  viewport: ViewportSize,
  margin = 48,
): Camera {
  const usableW = Math.max(1, viewport.width - margin * 2);
  const usableH = Math.max(1, viewport.height - margin * 2);
  const pxPerMm = clampZoom(Math.min(usableW / panelWmm, usableH / panelHmm));
  return {
    pxPerMm,
    offsetX: (viewport.width - panelWmm * pxPerMm) / 2,
    offsetY: (viewport.height - panelHmm * pxPerMm) / 2,
  };
}

// Zoom by `factor` while keeping the mm point currently under `screen`
// stationary — the anchored-zoom behavior wheel + zoom-tool both rely on.
export function zoomAt(cam: Camera, screen: Pt, factor: number): Camera {
  const next = clampZoom(cam.pxPerMm * factor);
  const applied = next / cam.pxPerMm; // realized factor after clamping
  return {
    pxPerMm: next,
    offsetX: screen.x - (screen.x - cam.offsetX) * applied,
    offsetY: screen.y - (screen.y - cam.offsetY) * applied,
  };
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dxPx, offsetY: cam.offsetY + dyPx };
}
