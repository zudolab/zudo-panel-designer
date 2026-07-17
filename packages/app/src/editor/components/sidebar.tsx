// Right sidebar: panel-size select (real HP table), the FIXED palette legend
// (the physical PCB finish decides these three colors), the layer list, and the
// inspector host — all in a scrolling inner stack. The Help panel (#36) is a
// non-scrolling footer BELOW that stack: always visible, never scrolled below
// the fold, even when the panel stack above overflows.
import { PALETTE, PANEL_HEIGHT_MM, PANEL_SIZES, type Layer } from '@zpd/core';
import type { ToolContext } from '../types';
import { CollapsibleSection } from './collapsible-section';
import { HelpPanel } from './help-panel';
import { InspectorHost } from './inspector-host';
import { LayerList } from './layer-list';

export interface SidebarProps {
  ctx: ToolContext;
  selectedIds: readonly string[];
  selectedLayer: Layer | null;
  activeToolId: string;
  showOutsidePanel: boolean;
  onShowOutsidePanelChange: (value: boolean) => void;
}

export function Sidebar({
  ctx,
  selectedIds,
  selectedLayer,
  activeToolId,
  showOutsidePanel,
  onShowOutsidePanelChange,
}: SidebarProps) {
  return (
    <aside className="flex w-72 flex-col border-l border-neutral-800 bg-neutral-900">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
        <CollapsibleSection title="View">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-neutral-400">Show content outside the panel</span>
            <input
              type="checkbox"
              checked={showOutsidePanel}
              onChange={(e) => onShowOutsidePanelChange(e.target.checked)}
              className="accent-sky-400"
            />
          </label>
        </CollapsibleSection>

        <CollapsibleSection title="Panel">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-neutral-400">Size</span>
            <select
              value={ctx.doc.panelHp}
              onChange={(e) => ctx.commit({ ...ctx.doc, panelHp: Number(e.target.value) })}
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
            >
              {PANEL_SIZES.map((s) => (
                <option key={s.hp} value={s.hp}>
                  {s.hp}HP — {s.widthMm}×{PANEL_HEIGHT_MM}mm
                </option>
              ))}
            </select>
          </label>
        </CollapsibleSection>

        <CollapsibleSection title="Palette (fixed)">
          <ul className="flex flex-col gap-1.5">
            {PALETTE.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-4 w-4 rounded border border-neutral-600"
                  style={{ background: entry.hex }}
                />
                <span className="capitalize text-neutral-200">{entry.name}</span>
                <span className="text-neutral-500">— {entry.note}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>

        <CollapsibleSection title="Layers">
          <LayerList ctx={ctx} selectedIds={selectedIds} />
        </CollapsibleSection>

        <CollapsibleSection title={selectedLayer ? `Properties — ${selectedLayer.type}` : 'Properties'}>
          <InspectorHost ctx={ctx} layer={selectedLayer} />
        </CollapsibleSection>
      </div>

      <div className="shrink-0 border-t border-neutral-800 p-3">
        <CollapsibleSection title="Help" defaultOpen={false}>
          <HelpPanel activeToolId={activeToolId} />
        </CollapsibleSection>
      </div>
    </aside>
  );
}
