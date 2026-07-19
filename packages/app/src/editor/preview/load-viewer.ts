import type { PreviewViewerModule } from './viewer-types';

// This function is the sole eager-to-renderer boundary. Keep the target in
// editor/preview (outside the eager dialog glob) and never replace this with
// a static import: the eventual Three.js implementation belongs in its own
// Vite chunk and starts loading only after the preview dialog mounts.
export function loadPreviewViewer(): Promise<PreviewViewerModule> {
  return import('./viewer');
}
