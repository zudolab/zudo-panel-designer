import type { PreviewPhysicalDimensions, PreviewVector3Summary } from './contracts';

export const PREVIEW_CAMERA_NEAR_MM = 0.1;
export const PREVIEW_CAMERA_FAR_MM = 4096;
export const PREVIEW_CAMERA_VERTICAL_FOV_DEGREES = 35;

const RAW_RESET_DIRECTION = Object.freeze({ x: 0.62, y: 0.3, z: 1 });
const RAW_RESET_DIRECTION_LENGTH = Math.hypot(
  RAW_RESET_DIRECTION.x,
  RAW_RESET_DIRECTION.y,
  RAW_RESET_DIRECTION.z,
);

export const PREVIEW_CAMERA_RESET_DIRECTION: PreviewVector3Summary = Object.freeze({
  x: RAW_RESET_DIRECTION.x / RAW_RESET_DIRECTION_LENGTH,
  y: RAW_RESET_DIRECTION.y / RAW_RESET_DIRECTION_LENGTH,
  z: RAW_RESET_DIRECTION.z / RAW_RESET_DIRECTION_LENGTH,
});

export interface PreviewCameraFit {
  readonly target: PreviewVector3Summary;
  readonly resetDirection: PreviewVector3Summary;
  readonly resetDistance: number;
  readonly minimumDistance: number;
  readonly maximumDistance: number;
  readonly maximumTargetOffset: number;
  readonly near: number;
  readonly far: number;
  readonly boundingRadius: number;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function calculatePreviewCameraFit(
  dimensions: PreviewPhysicalDimensions,
  viewportAspect: number,
): PreviewCameraFit {
  requirePositiveFinite(dimensions.widthMm, 'widthMm');
  requirePositiveFinite(dimensions.heightMm, 'heightMm');
  requirePositiveFinite(dimensions.thicknessMm, 'thicknessMm');
  requirePositiveFinite(viewportAspect, 'viewportAspect');

  const boundingRadius =
    Math.hypot(dimensions.widthMm, dimensions.heightMm, dimensions.thicknessMm) / 2;
  const verticalHalfFov = (PREVIEW_CAMERA_VERTICAL_FOV_DEGREES * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * viewportAspect);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);

  // A sphere fit remains valid at every orbit angle. The small margin keeps
  // highlights and the contact shadow from touching the viewport edge.
  const fittedDistance = (boundingRadius / Math.sin(limitingHalfFov)) * 1.12;
  // The reverse-triangle lower bound remains outside the board even at maximum
  // Pan: minimumDistance - maximumTargetOffset > boundingRadius. That prevents
  // a side-on orbit from entering an unusually wide, 2.5 mm-thin board.
  const maximumTargetOffset = boundingRadius * 0.3;
  const minimumDistance = boundingRadius * 1.4;
  const maximumDistance = Math.min(
    PREVIEW_CAMERA_FAR_MM * 0.72,
    Math.max(fittedDistance * 3.5, minimumDistance * 2),
  );
  const resetDistance = Math.min(maximumDistance, Math.max(minimumDistance, fittedDistance));

  return Object.freeze({
    target: Object.freeze({ x: 0, y: 0, z: 0 }),
    resetDirection: PREVIEW_CAMERA_RESET_DIRECTION,
    resetDistance,
    minimumDistance,
    maximumDistance,
    maximumTargetOffset,
    near: PREVIEW_CAMERA_NEAR_MM,
    far: PREVIEW_CAMERA_FAR_MM,
    boundingRadius,
  });
}

export function clampPreviewCameraDistance(distance: number, fit: PreviewCameraFit): number {
  if (!Number.isFinite(distance)) return fit.resetDistance;
  return Math.min(fit.maximumDistance, Math.max(fit.minimumDistance, distance));
}

export function previewResetCameraPosition(fit: PreviewCameraFit): PreviewVector3Summary {
  return Object.freeze({
    x: fit.target.x + fit.resetDirection.x * fit.resetDistance,
    y: fit.target.y + fit.resetDirection.y * fit.resetDistance,
    z: fit.target.z + fit.resetDirection.z * fit.resetDistance,
  });
}
