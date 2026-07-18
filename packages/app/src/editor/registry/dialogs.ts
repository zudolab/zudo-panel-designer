// Dialog registry + open/close store. The registry maps a dialog id to its
// component; the store tracks which dialog (if any) is currently open and its
// props. The store is a tiny observable so openDialog() works from anywhere —
// including tool handlers that are not React components — and the DialogHost
// subscribes via useSyncExternalStore.
import type { ToolContext, DialogModule } from '../types';

const dialogs = new Map<string, DialogModule>();

export function registerDialog<P, C extends ToolContext = ToolContext>(
  dialog: DialogModule<P, C>,
): void {
  // The store is heterogeneous (each dialog has its own P and ctx type); the
  // host re-widens per call. The registration-site generics still typecheck
  // the component's own props/ctx expectations.
  dialogs.set(dialog.id, dialog as unknown as DialogModule);
}

export function unregisterDialog(id: string): void {
  dialogs.delete(id);
}

export function getDialog(id: string): DialogModule | undefined {
  return dialogs.get(id);
}

export interface OpenDialogState {
  id: string;
  props: unknown;
  // Captured synchronously by openDialog(), before listeners can mount a
  // self-focusing dialog child. Replacements carry the same target for the
  // lifetime of the modal session; only a later close may restore it.
  returnFocusTarget: HTMLElement | null;
}

let openState: OpenDialogState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function captureReturnFocusTarget(): HTMLElement | null {
  // Dialog calls are also usable from non-DOM environments (SSR, node tests),
  // where neither global is guaranteed to exist.
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement ? activeElement : null;
}

export function openDialog(id: string, props?: unknown): void {
  // Opening while another dialog is present is a replacement inside the same
  // modal session. Preserve the original outside opener instead of capturing
  // whichever control the outgoing dialog currently owns.
  const returnFocusTarget =
    openState === null ? captureReturnFocusTarget() : openState.returnFocusTarget;
  openState = { id, props: props ?? {}, returnFocusTarget };
  emit();
}

export function closeDialog(): void {
  if (openState === null) return;
  openState = null;
  emit();
}

export function getOpenDialog(): OpenDialogState | null {
  return openState;
}

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
