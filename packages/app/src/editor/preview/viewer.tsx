import { PreviewRendererUnavailable } from './preview-status';

/**
 * Dynamic target reserved for the renderer integration. Keeping a usable
 * fallback here lets the shell land before the WebGL implementation without
 * making a missing chunk crash the editor.
 */
export default function PreviewViewerPlaceholder() {
  return <PreviewRendererUnavailable detail="The 3D renderer is not available in this build." />;
}
