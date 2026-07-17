import { createDefaultDoc } from '@zpd/core';
import { downloadPanelConfig } from '../download';
import { replaceDoc } from '../replace-doc';
import type { ToolContext } from '../types';
import type { SaveStatus } from '../use-autosave';
import { ChromeButton } from './chrome';
import { confirmDialog } from './confirm-dialog';
import { SaveStatusChip } from './save-status';

export interface HeaderProps {
  ctx: ToolContext;
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  onFit(): void;
  onZoomStep(factor: number): void;
}

export function Header({ ctx, zoomPercent, canUndo, canRedo, saveStatus, onFit, onZoomStep }: HeaderProps) {
  const handleNewPanel = async () => {
    const confirmed = await confirmDialog({
      title: 'Start a new panel?',
      // createDefaultDoc() ships one starter pattern layer (dot grid), not an
      // empty document — the copy must not claim "blank" (codex review).
      message: 'This replaces the current panel with the default starter panel. This cannot be undone.',
      confirmLabel: 'New panel',
      danger: true,
    });
    if (!confirmed) return;
    replaceDoc(createDefaultDoc(), ctx);
  };

  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
      <h1 className="text-sm font-semibold text-amber-400">zpd</h1>
      <span className="text-xs text-neutral-500">Zudo Panel Designer</span>
      <SaveStatusChip status={saveStatus} />

      <div className="ml-auto flex items-center gap-1.5">
        <ChromeButton title="Zoom out" onClick={() => onZoomStep(1 / 1.25)}>
          −
        </ChromeButton>
        <span className="w-12 text-center text-xs tabular-nums text-neutral-300">{zoomPercent}%</span>
        <ChromeButton title="Zoom in" onClick={() => onZoomStep(1.25)}>
          +
        </ChromeButton>
        <ChromeButton title="Fit panel" onClick={onFit}>
          Fit
        </ChromeButton>

        <span className="mx-1 h-5 w-px bg-neutral-700" />

        <ChromeButton title="Undo (⌘/Ctrl+Z)" disabled={!canUndo} onClick={ctx.undo}>
          ↩
        </ChromeButton>
        <ChromeButton title="Redo (⌘/Ctrl+Shift+Z)" disabled={!canRedo} onClick={ctx.redo}>
          ↪
        </ChromeButton>

        <span className="mx-1 h-5 w-px bg-neutral-700" />

        <ChromeButton title="Keyboard shortcuts" onClick={() => ctx.openDialog('shortcuts')}>
          ?
        </ChromeButton>
        <ChromeButton
          className="border-amber-600 bg-amber-600/20 text-amber-200 hover:bg-amber-600/30"
          title="Download panel config JSON"
          onClick={() => downloadPanelConfig(ctx.doc)}
        >
          ⬇ JSON
        </ChromeButton>

        <span className="mx-1 h-5 w-px bg-neutral-700" />

        <ChromeButton title="Start a new panel" onClick={handleNewPanel}>
          New panel
        </ChromeButton>
      </div>
    </header>
  );
}
