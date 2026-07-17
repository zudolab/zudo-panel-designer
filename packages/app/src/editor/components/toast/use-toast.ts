// React-facing surface over the toast store (registry/toasts.ts). Add-actions
// and tool handlers that aren't React components can call toastSuccess() /
// toastError() / toastWarning() / dismissToast() directly instead.
import { useSyncExternalStore } from 'react';
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  toastError,
  toastSuccess,
  toastWarning,
  type ToastEntry,
} from '../../registry/toasts';

export interface UseToastResult {
  toasts: ToastEntry[];
  success: typeof toastSuccess;
  error: typeof toastError;
  warning: typeof toastWarning;
  dismiss: typeof dismissToast;
}

export function useToast(): UseToastResult {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return {
    toasts,
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    dismiss: dismissToast,
  };
}
