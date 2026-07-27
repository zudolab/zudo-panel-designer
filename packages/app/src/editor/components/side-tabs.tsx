// Front/Back face tabs (#233), mounted in Editor.tsx directly above the
// canvas viewport. View-state only: switching tabs calls ctx.setActiveSide
// (which clears the selection and any in-progress tool draft — see #230's
// lifecycle contract); it never touches the document or undo history.
//
// The Back tab RENDERS only for fr4 — alumi is front-only (bare-metal back).
// Hiding the tab is the whole UI gate: the back stack's contents are
// preserved untouched, and Editor's material-gating effect handles the
// jump-to-Front when the material changes out from under an active Back view.
import type { PanelSide, PcbMaterial } from '@zpd/core';
import { ChromeButton } from './chrome';

export interface SideTabsProps {
  activeSide: PanelSide;
  material: PcbMaterial;
  onSideChange(side: PanelSide): void;
}

const SIDE_LABELS: Record<PanelSide, string> = { front: 'Front', back: 'Back' };

export function SideTabs({ activeSide, material, onSideChange }: SideTabsProps) {
  const sides: PanelSide[] = material === 'fr4' ? ['front', 'back'] : ['front'];
  return (
    <div
      role="tablist"
      aria-label="Panel face"
      className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-2 py-1"
    >
      {sides.map((side) => (
        <ChromeButton
          key={side}
          role="tab"
          aria-selected={activeSide === side}
          active={activeSide === side}
          // Re-clicking the active tab is a strict no-op inside setActiveSide
          // (same-side guard) — it must never clear the selection.
          onClick={() => onSideChange(side)}
        >
          {SIDE_LABELS[side]}
        </ChromeButton>
      ))}
    </div>
  );
}
