// Camera = the mm->screen-px mapping. Modeled on pgen lite-composer's
// project/unproject inverse pair; here pxPerMm doubles as the zoom value.

export interface Camera {
  pxPerMm: number;
  offsetX: number; // screen px of panel origin
  offsetY: number;
}

export const MIN_PX_PER_MM = 0.5;
export const MAX_PX_PER_MM = 100;

export function project(cam: Camera, mmX: number, mmY: number): { x: number; y: number } {
  return { x: mmX * cam.pxPerMm + cam.offsetX, y: mmY * cam.pxPerMm + cam.offsetY };
}

export function unproject(cam: Camera, pxX: number, pxY: number): { x: number; y: number } {
  return { x: (pxX - cam.offsetX) / cam.pxPerMm, y: (pxY - cam.offsetY) / cam.pxPerMm };
}

export function fitCamera(
  canvasW: number,
  canvasH: number,
  panelWmm: number,
  panelHmm: number,
  marginPx = 48,
): Camera {
  const pxPerMm = Math.min(
    (canvasW - marginPx * 2) / panelWmm,
    (canvasH - marginPx * 2) / panelHmm,
  );
  const clamped = Math.max(MIN_PX_PER_MM, Math.min(MAX_PX_PER_MM, pxPerMm));
  return {
    pxPerMm: clamped,
    offsetX: (canvasW - panelWmm * clamped) / 2,
    offsetY: (canvasH - panelHmm * clamped) / 2,
  };
}

export function zoomAt(cam: Camera, screenX: number, screenY: number, factor: number): Camera {
  const next = Math.max(MIN_PX_PER_MM, Math.min(MAX_PX_PER_MM, cam.pxPerMm * factor));
  const realFactor = next / cam.pxPerMm;
  // keep the mm point under the cursor stationary on screen
  return {
    pxPerMm: next,
    offsetX: screenX - (screenX - cam.offsetX) * realFactor,
    offsetY: screenY - (screenY - cam.offsetY) * realFactor,
  };
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dxPx, offsetY: cam.offsetY + dyPx };
}
