// Dialog registry + open/close store. The registry maps a dialog id to its
// component; the store tracks which dialog (if any) is currently open and its
// props. The store is a tiny observable so openDialog() works from anywhere —
// including tool handlers that are not React components — and the DialogHost
// subscribes via useSyncExternalStore.
import type { DialogModule } from '../types';

const dialogs = new Map<string, DialogModule>();

export function registerDialog<P>(dialog: DialogModule<P>): void {
  dialogs.set(dialog.id, dialog as DialogModule);
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
}

let openState: OpenDialogState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openDialog(id: string, props?: unknown): void {
  openState = { id, props: props ?? {} };
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
