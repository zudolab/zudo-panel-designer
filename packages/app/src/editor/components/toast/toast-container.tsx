// Renders every active toast from the toast store into a fixed top-center
// portal anchored to document.body. Subscribes via useSyncExternalStore so
// toastSuccess()/toastError()/toastWarning() from anywhere — including
// non-React tool handlers — drive it, mirroring DialogHost.
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { Toast } from './toast';
import { dismissToast, getToasts, subscribeToasts } from '../../registry/toasts';
import { Z_INDEX } from '../../z-index';

export function ToastContainer() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ zIndex: Z_INDEX.toast }}
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          variant={toast.variant}
          message={toast.message}
          description={toast.description}
          duration={toast.duration}
          onDismiss={dismissToast}
        />
      ))}
    </div>,
    document.body,
  );
}
