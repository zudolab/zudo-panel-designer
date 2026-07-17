// Content-only confirm dialog rendered THROUGH dialog-host.tsx — it owns no
// overlay/backdrop/role of its own (that would nest a second "dialog" role
// under the host's). Auto-focuses Cancel via its own layout effect, which
// runs before the host's generic "focus first focusable" fallback (child
// layout effects run before parent ones) — the host sees focus already
// inside and defers to it.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { openDialog, registerDialog } from '../registry/dialogs';
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
  onCancel(): void;
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
    onCancel,
  } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Fires on every dismissal path — Cancel click, Escape (host-owned), or a
  // backdrop click (host-owned) — since all of them unmount this component.
  // Safe to call after onConfirm too: confirmDialog()'s settle() is
  // idempotent, so this is a no-op once the promise already resolved true.
  useEffect(() => {
    return () => onCancel();
  }, [onCancel]);

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
// Resolves true only when Confirm is clicked; every other dismissal path —
// Cancel, Escape, backdrop click, or the dialog getting swapped out — resolves
// false via ConfirmDialogContent's unmount cleanup below, which is safe to
// call after onConfirm too since settle() is idempotent.
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    openDialog(CONFIRM_DIALOG_ID, {
      ...options,
      onConfirm: () => settle(true),
      onCancel: () => settle(false),
    } satisfies ConfirmDialogProps);
  });
}
