import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const PORTAL_ROOT_ID = 'overlay-portal-root';

interface OverlayPortalProps {
  children: ReactNode;
}

/**
 * Render `children` into the top-level `#overlay-portal-root` DOM node so the
 * subtree escapes any stacking contexts created by `#root`'s descendants.
 *
 * The portal root is declared in `index.html` as a sibling of `#root`, placed
 * BEFORE it, so neither node is inside the other's stacking context. If the
 * root is missing at runtime (e.g. tests), falls back to `document.body`.
 *
 * The target is resolved synchronously in a `useState` initializer so the
 * portaled subtree mounts on the first render, with no extra effect-cycle
 * delay — this matters for focus/keyboard handling inside the portaled tree
 * (see dialog-host.tsx) and avoids a one-frame flash of empty state.
 */
export function OverlayPortal({ children }: OverlayPortalProps) {
  const [target] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    return document.getElementById(PORTAL_ROOT_ID) ?? document.body;
  });

  if (!target) return null;
  return createPortal(children, target);
}
