// Renders whichever dialog the store says is open. Subscribes to the dialog
// store so openDialog()/closeDialog() from anywhere (including non-React tool
// handlers) drive it. Clicking the backdrop or the Close button closes.
import { createElement, useSyncExternalStore } from 'react';
import {
  closeDialog,
  getDialog,
  getOpenDialog,
  subscribeDialog,
} from '../registry/dialogs';
import type { ToolContext } from '../types';

export function DialogHost({ ctx }: { ctx: ToolContext }) {
  const open = useSyncExternalStore(subscribeDialog, getOpenDialog, getOpenDialog);
  if (!open) return null;
  const mod = getDialog(open.id);
  if (!mod) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={closeDialog}
    >
      <div
        className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* dialog component resolved dynamically from the registry */}
        {createElement(mod.component, { props: open.props, close: closeDialog, ctx })}
      </div>
    </div>
  );
}
