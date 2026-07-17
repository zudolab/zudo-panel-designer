// Content-only confirm dialog rendered THROUGH dialog-host.tsx — it owns no
// overlay/backdrop/role of its own (that would nest a second "dialog" role
// under the host's). Auto-focuses Cancel via its own layout effect, which
// runs before the host's generic "focus first focusable" fallback (child
// layout effects run before parent ones) — the host sees focus already
// inside and defers to it.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { getOpenDialog, openDialog, registerDialog, subscribeDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

const CONFIRM_DIALOG_ID = 'confirm-dialog';

export interface ConfirmDialogProps {
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
}

function ConfirmDialogContent({ props, close }: DialogProps<ConfirmDialogProps>) {
  const {
    title,
    message,
    children,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger,
    onConfirm,
  } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="w-[min(24rem,90vw)]">
      <h2 className="mb-3 text-sm font-semibold text-neutral-100">{title}</h2>
      {message && <p className="mb-3 text-xs text-neutral-300">{message}</p>}
      {children && <div className="mb-3">{children}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={close}
          className="rounded border border-neutral-600 bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            close();
          }}
          className={
            danger
              ? 'rounded border border-red-500 bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-500'
              : 'rounded border border-sky-500 bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500'
          }
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

registerDialog<ConfirmDialogProps>({ id: CONFIRM_DIALOG_ID, component: ConfirmDialogContent });

export interface ConfirmDialogOptions {
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Imperative helper for non-React code paths (add-actions, import flows)
// that need to await a confirmation instead of registering a dialog inline.
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
