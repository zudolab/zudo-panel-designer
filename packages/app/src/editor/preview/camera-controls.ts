import { MOUSE, TOUCH, type PerspectiveCamera, type Vector3 } from 'three';
import { previewResetCameraPosition, type PreviewCameraFit } from './camera-fit';

export interface PreviewOrbitControlAdapter {
  enableDamping: boolean;
  readonly target: Vector3;
  readonly mouseButtons: { LEFT?: MOUSE | null };
  readonly touches: { ONE?: TOUCH | null };
  update(): boolean | void;
}

export function setPreviewPrimaryPanMode(
  controls: PreviewOrbitControlAdapter,
  enabled: boolean,
): void {
  controls.mouseButtons.LEFT = enabled ? MOUSE.PAN : MOUSE.ROTATE;
  controls.touches.ONE = enabled ? TOUCH.PAN : TOUCH.ROTATE;
}

export function resetPreviewOrbitView(
  camera: PerspectiveCamera,
  controls: PreviewOrbitControlAdapter,
  fit: PreviewCameraFit,
): void {
  const dampingEnabled = controls.enableDamping;
  controls.enableDamping = false;
  try {
    // OrbitControls keeps spherical/pan deltas internally. Updating once with
    // damping disabled consumes them completely before the exact reset pose is
    // installed, so subsequent frames cannot drift away from Reset.
    controls.update();
    const position = previewResetCameraPosition(fit);
    controls.target.set(fit.target.x, fit.target.y, fit.target.z);
    camera.position.set(position.x, position.y, position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    controls.update();
  } finally {
    controls.enableDamping = dampingEnabled;
  }
}
