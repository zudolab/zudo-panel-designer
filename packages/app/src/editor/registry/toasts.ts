// Toast queue + pub/sub store. Mirrors the registry/dialogs.ts open-state
// pattern: state lives outside React so toastSuccess()/toastError()/etc. work
// from anywhere — including tool handlers and add-actions that are not React
// components — and ToastContainer subscribes via useSyncExternalStore.

export type ToastVariant = 'success' | 'error' | 'warning';

export interface ToastEntry {
  id: string;
  variant: ToastVariant;
  message: string;
  description?: string;
  duration?: number;
}

export interface ToastOptions {
  description?: string;
  duration?: number;
}

// Maximum number of toasts visible at once. When exceeded, addToast() drops
// one per the overflow policy below.
const MAX_TOASTS = 5;

let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (old jsdom).
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addToast(variant: ToastVariant, message: string, options?: ToastOptions): string {
  const id = generateId();
  const next = [...toasts, { id, variant, message, ...options }];
  if (next.length > MAX_TOASTS) {
    // Overflow policy: drop the oldest NON-error toast first so an error
    // burst (e.g. 6 simultaneous failures) is never silenced. Only when every
    // queued toast is an error do we drop the oldest error — at that point
    // losing the very first one is the least bad option.
    const oldestNonErrorIdx = next.findIndex((t) => t.variant !== 'error');
    const dropIdx = oldestNonErrorIdx >= 0 ? oldestNonErrorIdx : 0;
    next.splice(dropIdx, 1);
  }
  toasts = next;
  emit();
  return id;
}

export function toastSuccess(message: string, options?: ToastOptions): string {
  return addToast('success', message, options);
}

export function toastError(message: string, options?: ToastOptions): string {
  return addToast('error', message, options);
}

export function toastWarning(message: string, options?: ToastOptions): string {
  return addToast('warning', message, options);
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function getToasts(): ToastEntry[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
