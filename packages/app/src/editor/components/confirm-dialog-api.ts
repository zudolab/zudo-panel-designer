// Imperative helper for non-React code paths (add-actions, import flows)
// that need to await a confirmation instead of registering a dialog inline.
// Split from confirm-dialog.tsx (which owns the actual component) so that
// file can stay component-only for react-refresh/only-export-components —
// this module exports a plain function, not a component.
import type { ReactNode } from 'react';
import { getOpenDialog, openDialog, subscribeDialog } from '../registry/dialogs';
import { CONFIRM_DIALOG_ID, type ConfirmDialogProps } from './confirm-dialog';

export interface ConfirmDialogOptions {
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Resolves true only on a Confirm click. Every other dismissal — Cancel,
// Escape (host-owned), backdrop click (host-owned), or the dialog getting
// swapped for a different one — resolves false.
//
// Detected via the dialog store's identity, not a React effect/unmount
// signal: every dismissal path routes through closeDialog()/openDialog(),
// which replaces the store's open-dialog object, so comparing identity is
// timing-safe. An effect-cleanup-as-cancel approach was tried first and
// broke under StrictMode: React's dev-mode mount→cleanup→remount replay
// would fire the cleanup (and thus "cancel") immediately on mount, resolving
// the promise to false before the user ever interacted with the dialog.
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(result);
    };
    openDialog(CONFIRM_DIALOG_ID, {
      ...options,
      onConfirm: () => settle(true),
    } satisfies ConfirmDialogProps);
    const openedState = getOpenDialog();
    unsubscribe = subscribeDialog(() => {
      if (getOpenDialog() !== openedState) settle(false);
    });
  });
}
