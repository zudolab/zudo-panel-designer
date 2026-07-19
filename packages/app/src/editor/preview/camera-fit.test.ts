import { PANEL_SIZES, PANEL_HEIGHT_MM, PANEL_THICKNESS_MM } from '@zpd/core';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CAMERA_FAR_MM,
  PREVIEW_CAMERA_NEAR_MM,
  PREVIEW_CAMERA_RESET_DIRECTION,
  calculatePreviewCameraFit,
  clampPreviewCameraDistance,
  previewResetCameraPosition,
} from './camera-fit';

describe('preview camera fit', () => {
  it.each(PANEL_SIZES)('returns finite, safely clamped values for $hp HP', ({ widthMm }) => {
    for (const aspect of [0.5, 1, 2]) {
      const fit = calculatePreviewCameraFit(
        { widthMm, heightMm: PANEL_HEIGHT_MM, thicknessMm: PANEL_THICKNESS_MM },
        aspect,
      );

      expect(
        Object.values(fit).every((value) => typeof value !== 'number' || Number.isFinite(value)),
      ).toBe(true);
      expect(fit.minimumDistance).toBeGreaterThan(fit.boundingRadius);
      expect(fit.minimumDistance - fit.maximumTargetOffset).toBeGreaterThan(fit.boundingRadius);
      expect(fit.resetDistance).toBeGreaterThanOrEqual(fit.minimumDistance);
      expect(fit.maximumDistance).toBeGreaterThan(fit.resetDistance);
      expect(fit.near).toBe(PREVIEW_CAMERA_NEAR_MM);
      expect(fit.far).toBe(PREVIEW_CAMERA_FAR_MM);
    }
  });

  it('restores the exact target, three-quarter direction, and fitted distance', () => {
    const fit = calculatePreviewCameraFit(
      { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
      16 / 9,
    );
    const position = previewResetCameraPosition(fit);
    const direction = {
      x: (position.x - fit.target.x) / fit.resetDistance,
      y: (position.y - fit.target.y) / fit.resetDistance,
      z: (position.z - fit.target.z) / fit.resetDistance,
    };

    expect(fit.target).toEqual({ x: 0, y: 0, z: 0 });
    expect(direction.x).toBeCloseTo(PREVIEW_CAMERA_RESET_DIRECTION.x, 12);
    expect(direction.y).toBeCloseTo(PREVIEW_CAMERA_RESET_DIRECTION.y, 12);
    expect(direction.z).toBeCloseTo(PREVIEW_CAMERA_RESET_DIRECTION.z, 12);
    expect(Math.hypot(position.x, position.y, position.z)).toBeCloseTo(fit.resetDistance, 10);
  });

  it('clamps repeated dolly operations and recovers from non-finite input', () => {
    const fit = calculatePreviewCameraFit({ widthMm: 101.3, heightMm: 128.5, thicknessMm: 2.5 }, 1);

    expect(clampPreviewCameraDistance(0, fit)).toBe(fit.minimumDistance);
    expect(clampPreviewCameraDistance(Number.MAX_VALUE, fit)).toBe(fit.maximumDistance);
    expect(clampPreviewCameraDistance(Number.NaN, fit)).toBe(fit.resetDistance);
    expect(clampPreviewCameraDistance(Number.POSITIVE_INFINITY, fit)).toBe(fit.resetDistance);
  });

  it('keeps the camera outside the board at the worst allowed pan and dolly bounds', () => {
    const fit = calculatePreviewCameraFit(
      { widthMm: 101.3, heightMm: 128.5, thicknessMm: 2.5 },
      0.5,
    );

    // Reverse triangle inequality: |camera - board center| is at least the
    // camera-target distance minus the target's maximum offset from center.
    const worstCaseCenterDistance = fit.minimumDistance - fit.maximumTargetOffset;
    expect(worstCaseCenterDistance).toBeGreaterThan(fit.boundingRadius);
  });

  it('rejects invalid physical or viewport dimensions', () => {
    expect(() =>
      calculatePreviewCameraFit({ widthMm: 0, heightMm: 128.5, thicknessMm: 2.5 }, 1),
    ).toThrow(RangeError);
    expect(() =>
      calculatePreviewCameraFit({ widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 }, 0),
    ).toThrow(RangeError);
  });
});
