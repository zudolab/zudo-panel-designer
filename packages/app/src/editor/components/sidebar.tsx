// Right sidebar: panel-size select (real HP table), the FIXED palette legend
// (the physical PCB finish decides these three colors), the layer list, and the
// inspector host. Scrolls independently; overscroll-contain keeps the canvas
// from scrolling when the list bottoms out.
import { PALETTE, PANEL_HEIGHT_MM, PANEL_SIZES, type Layer } from '@zpd/core';
import type { ToolContext } from '../types';
import { InspectorHost } from './inspector-host';
import { LayerList } from './layer-list';

export interface SidebarProps {
  ctx: ToolContext;
  selectedId: string | null;
  selectedLayer: Layer | null;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </h2>
  );
}

export function Sidebar({ ctx, selectedId, selectedLayer }: SidebarProps) {
  return (
    <aside className="flex w-72 flex-col gap-5 overflow-y-auto overscroll-contain border-l border-neutral-800 bg-neutral-900 p-3">
      <section>
        <SectionTitle>Panel</SectionTitle>
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
      </section>

      <section>
        <SectionTitle>Palette (fixed)</SectionTitle>
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
      </section>

      <section>
        <SectionTitle>Layers</SectionTitle>
        <LayerList ctx={ctx} selectedId={selectedId} />
      </section>

      <section>
        <SectionTitle>{selectedLayer ? `Properties — ${selectedLayer.type}` : 'Properties'}</SectionTitle>
        <InspectorHost ctx={ctx} layer={selectedLayer} />
      </section>
    </aside>
  );
}
