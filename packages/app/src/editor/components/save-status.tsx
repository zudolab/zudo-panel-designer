// Autosave status chip (Composer Parity #72). Non-interactive, low-visual-
// weight pill in the header — mirrors the reference save-status-indicator's
// intent (reassure without distracting) but derives from the local
// three-state autosave contract instead of tab urlKind/auth. Copy must not
// overclaim retention: this is localStorage in THIS browser, nothing more.
import type { SaveStatus } from '../use-autosave';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const FAILURE_LABEL = 'Save failed (document too large for local storage)';

export function SaveStatusChip({ status }: { status: SaveStatus }) {
  if (status.kind === 'unsaved') {
    return (
      <span
        role="status"
        className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400"
      >
        Unsaved changes…
      </span>
    );
  }
  if (status.kind === 'saved') {
    return (
      <span
        role="status"
        className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400"
      >
        Saved locally {formatTime(status.savedAt)}
      </span>
    );
  }
  return (
    <span
      role="status"
      title={status.reason === 'quota' ? FAILURE_LABEL : 'Save failed — local storage is unavailable'}
      className="rounded-full border border-red-800 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300"
    >
      {status.reason === 'quota' ? FAILURE_LABEL : 'Save failed'}
    </span>
  );
}
