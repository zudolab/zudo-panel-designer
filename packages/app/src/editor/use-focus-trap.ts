import { useEffect, type RefObject } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// jsdom has no layout engine (offsetParent/getBoundingClientRect are always
// zeroed out), so a real-visibility filter can't be exercised by tests here.
// `inert` is the one visibility signal jsdom does model correctly.
export function queryFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('inert'),
  );
}

/**
 * Trap keyboard focus inside `ref`'s subtree while `active` is true. Tab from
 * the last focusable wraps to the first; Shift+Tab from the first wraps to
 * the last. Focusables are re-queried on every keydown so dynamically added
 * content (e.g. a newly expanded section) doesn't break the trap. Pairs with
 * `role="dialog"` / `aria-modal="true"` (see dialog-host.tsx) for a minimal
 * modal experience without pulling in a focus-trap library.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = queryFocusables(root);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !root.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [ref, active]);
}
