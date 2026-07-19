import { MOUSE, PerspectiveCamera, TOUCH, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { calculatePreviewCameraFit, previewResetCameraPosition } from './camera-fit';
import {
  resetPreviewOrbitView,
  setPreviewPrimaryPanMode,
  type PreviewOrbitControlAdapter,
} from './camera-controls';

function adapter(camera: PerspectiveCamera): PreviewOrbitControlAdapter & {
  pendingOffset: number;
} {
  return {
    enableDamping: true,
    target: new Vector3(),
    mouseButtons: {},
    touches: {},
    pendingOffset: 12,
    update() {
      if (this.pendingOffset === 0) return false;
      const applied = this.enableDamping ? this.pendingOffset / 2 : this.pendingOffset;
      camera.position.x += applied;
      this.pendingOffset -= applied;
      return true;
    },
  };
}

describe('preview orbit control behavior', () => {
  it('maps primary mouse and one-finger input between rotate and Pan', () => {
    const camera = new PerspectiveCamera();
    const controls = adapter(camera);

    setPreviewPrimaryPanMode(controls, false);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(controls.touches.ONE).toBe(TOUCH.ROTATE);
    setPreviewPrimaryPanMode(controls, true);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.PAN);
    expect(controls.touches.ONE).toBe(TOUCH.PAN);
  });

  it('flushes damping inertia and stays on the exact reset pose in later frames', () => {
    const camera = new PerspectiveCamera();
    const controls = adapter(camera);
    const fit = calculatePreviewCameraFit(
      { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
      16 / 9,
    );
    const expected = previewResetCameraPosition(fit);

    resetPreviewOrbitView(camera, controls, fit);
    expect(controls.enableDamping).toBe(true);
    expect(controls.pendingOffset).toBe(0);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(camera.position.x).toBeCloseTo(expected.x, 12);
    expect(camera.position.y).toBeCloseTo(expected.y, 12);
    expect(camera.position.z).toBeCloseTo(expected.z, 12);

    controls.update();
    expect(camera.position.x).toBeCloseTo(expected.x, 12);
    expect(camera.position.y).toBeCloseTo(expected.y, 12);
    expect(camera.position.z).toBeCloseTo(expected.z, 12);
  });
});
