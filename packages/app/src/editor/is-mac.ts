// is-mac — detects macOS hosts so the command registry (commands.ts) can pick
// the right modifier glyph for a chord's display string (⌘ on Mac, "Ctrl+"
// elsewhere). Ported from pgen's src/utils/is-mac.ts (issue #76 references it
// directly), with pgen's separate is-ios.ts helper inlined here rather than
// added as its own file — zpd has no other iOS-detection call site yet, and
// the issue's file list names only is-mac.ts for this sub.
//
// Detection reads `navigator.platform` per the sub's spec ("detect via
// `navigator.platform.includes('Mac')`"). iPadOS reports `MacIntel` on modern
// Safari with maxTouchPoints > 1 — those are touch devices (long-press is
// their primary gesture, not Cmd+click), so they're excluded and reported as
// non-Mac. Safe to call where `navigator` is unavailable (SSR / tests without
// jsdom) — returns `false` rather than throwing.
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const { userAgent, platform, maxTouchPoints } = navigator;
  if (/iPad|iPhone|iPod/.test(userAgent)) return false;
  if (platform === 'MacIntel' && maxTouchPoints > 1) return false;
  return platform.includes('Mac');
}
