// Content-only confirm dialog rendered THROUGH dialog-host.tsx — it owns no
// overlay/backdrop/role of its own (that would nest a second "dialog" role
// under the host's). Auto-focuses Cancel via its own layout effect, which
// runs before the host's generic "focus first focusable" fallback (child
// layout effects run before parent ones) — the host sees focus already
// inside and defers to it.
//
// The imperative confirmDialog() API lives in the sibling confirm-dialog-api.ts,
// not here — react-refresh/only-export-components requires a component file to
// export only components (plus allowed constants), and confirmDialog is a
// plain function.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { registerDialog } from '../registry/dialogs';
import type { DialogProps } from '../types';

export const CONFIRM_DIALOG_ID = 'confirm-dialog';

export interface ConfirmDialogProps {
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
}

export function ConfirmDialogContent({ props, close }: DialogProps<ConfirmDialogProps>) {
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
      <h2 id="confirm-dialog-title" className="mb-3 text-sm font-semibold text-neutral-100">
        {title}
      </h2>
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

registerDialog<ConfirmDialogProps>({
  id: CONFIRM_DIALOG_ID,
  component: ConfirmDialogContent,
  labelledBy: 'confirm-dialog-title',
});
