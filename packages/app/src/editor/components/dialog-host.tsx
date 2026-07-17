// Renders whichever dialog the store says is open. Subscribes to the dialog
// store so openDialog()/closeDialog() from anywhere (including non-React tool
// handlers) drive it. SINGLE owner of modal behavior — backdrop, dialog role,
// Escape-to-close, initial focus, focus restoration to the opener, and the
// focus trap — rendered through OverlayPortal. Registered dialogs (see
// registry/dialogs.ts) supply content only.
import { createElement, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  closeDialog,
  getDialog,
  getOpenDialog,
  subscribeDialog,
} from '../registry/dialogs';
import { queryFocusables, useFocusTrap } from '../use-focus-trap';
import { Z_INDEX } from '../z-index';
import { OverlayPortal } from './overlay-portal';
// Confirm dialog is core infra, not a Wave-5 extension — self-registers via
// this side-effect import rather than the ../dialogs/* auto-discovery glob.
import './confirm-dialog';
import type { ToolContext } from '../types';

export function DialogHost({ ctx }: { ctx: ToolContext }) {
  const open = useSyncExternalStore(subscribeDialog, getOpenDialog, getOpenDialog);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useFocusTrap(dialogRef, open !== null);

  // Escape-to-close + capturing the pre-open focus target to restore on
  // close. `open` is a fresh object per openDialog() call (or null on
  // close), so this fires exactly once per open and once per close. A
  // layout effect (not a passive one) so the capture below runs BEFORE the
  // initial-focus layout effect steals focus into the dialog — layout
  // effects across a component's hooks run in declaration order, passive
  // effects only run after every layout effect has already committed.
  useLayoutEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // Initial focus: the first focusable descendant, unless a content
  // component already moved focus into the dialog itself (e.g. ConfirmDialog
  // auto-focusing Cancel) — that wins, since its own layout effect (child)
  // runs before this one (parent). Runs before paint so there's no visible
  // focus jump.
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && dialog.contains(activeElement)) return;
    const [first] = queryFocusables(dialog);
    (first ?? dialog).focus();
  }, [open]);

  if (!open) return null;
  const mod = getDialog(open.id);
  if (!mod) return null;

  return (
    <OverlayPortal>
      <div
        data-testid="dialog-backdrop"
        className="fixed inset-0 grid place-items-center bg-black/60 p-4"
        style={{ zIndex: Z_INDEX.modal }}
        onClick={closeDialog}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {createElement(mod.component, { props: open.props, close: closeDialog, ctx })}
        </div>
      </div>
    </OverlayPortal>
  );
}
