// Prevents native browser zoom (ctrl/pinch wheel, Cmd/Ctrl +/-/0, Safari
// gesture events) so the cursor position reported to the app never desyncs
// from the actual screen position — a browser-zoomed viewport breaks drag
// handles, resize handles, and click targets in this drag-heavy editor.
// Pure prevention only: unlike the reference app (pgen), zpd has no
// display-scale setting to step, so there is nothing to dispatch here.
export function installBrowserZoomGuard(): () => void {
  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
      e.preventDefault();
    }
  };

  const preventGesture = (e: Event) => e.preventDefault();

  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('gesturestart', preventGesture);
  document.addEventListener('gesturechange', preventGesture);
  document.addEventListener('gestureend', preventGesture);

  return () => {
    window.removeEventListener('wheel', handleWheel);
    window.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('gesturestart', preventGesture);
    document.removeEventListener('gesturechange', preventGesture);
    document.removeEventListener('gestureend', preventGesture);
  };
}
