// Renders whichever dialog the store says is open. Subscribes to the dialog
// store so openDialog()/closeDialog() from anywhere (including non-React tool
// handlers) drive it. SINGLE owner of modal behavior — backdrop, dialog role,
// Escape-to-close, initial focus, focus restoration to the opener, and the
// focus trap — rendered through OverlayPortal. Registered dialogs (see
// registry/dialogs.ts) supply content only.
import { createElement, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { closeDialog, getDialog, getOpenDialog, subscribeDialog } from '../registry/dialogs';
import { queryFocusables, useFocusTrap } from '../use-focus-trap';
import { Z_INDEX } from '../z-index';
import { OverlayPortal } from './overlay-portal';
// Confirm dialog is core infra, not a Wave-5 extension — self-registers via
// this side-effect import rather than the ../dialogs/* auto-discovery glob.
import './confirm-dialog';
import type { CommandContext } from '../commands';

// ctx is typed CommandContext (not the narrower ToolContext) because Editor
// wires this with its full command-execution context and the command palette
// depends on receiving it — mis-wiring now fails typecheck here.
export function DialogHost({ ctx }: { ctx: CommandContext }) {
  const open = useSyncExternalStore(subscribeDialog, getOpenDialog, getOpenDialog);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOpen = open !== null;
  const returnFocusTarget = open?.returnFocusTarget ?? null;

  useFocusTrap(dialogRef, isOpen);

  // Escape handling and final focus restoration are scoped to the whole
  // open/replace/close modal session. The registry captures the outside
  // target before emitting the first open; replacements retain that target,
  // so this effect does not clean up (or transiently restore focus) while one
  // open dialog replaces another. The store check also makes StrictMode's
  // setup/cleanup replay harmless while the session is still open.
  useLayoutEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (getOpenDialog() !== null) return;
      if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus();
        return;
      }

      // A command-palette opener can disappear while one dialog replaces
      // another. Restore to an explicitly durable editor control instead of
      // leaving focus on detached modal content (or implicitly on <body>).
      const fallback = document.querySelector<HTMLElement>('[data-dialog-focus-fallback="true"]');
      fallback?.focus();
    };
  }, [isOpen, returnFocusTarget]);

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
          aria-labelledby={mod.labelledBy}
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
