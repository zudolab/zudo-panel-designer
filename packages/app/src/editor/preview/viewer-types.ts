import type { ComponentType } from 'react';
import type { DocState } from '@zpd/core';
import type { PreviewCameraControls, PreviewPhysicalDimensions } from './contracts';

/**
 * Narrow hand-off from the eager editor shell to the dynamically loaded
 * renderer. The viewer implementation may import Three.js; callers of this
 * type and the loading shell must not. The rendered root should fill the
 * available stage; the shell overlays camera controls without reducing it.
 */
export interface PreviewViewerProps {
  readonly doc: DocState;
  readonly dimensions: PreviewPhysicalDimensions;
  readonly onCameraControlsChange: (controls: PreviewCameraControls | null) => void;
}

export interface PreviewViewerModule {
  readonly default: ComponentType<PreviewViewerProps>;
}

export type PreviewViewerLoader = () => Promise<PreviewViewerModule>;
