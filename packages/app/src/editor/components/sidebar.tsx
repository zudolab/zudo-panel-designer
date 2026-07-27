// Right sidebar: panel-size select, material-aware layer list, and inspector
// host — all in a scrolling inner stack. The Help panel (#36) is a
// non-scrolling footer BELOW that stack: always visible, never scrolled below
// the fold, even when the panel stack above overflows.
import {
  panelHeightMm,
  PANEL_SIZES,
  stackForSide,
  supportedHps,
  type DocState,
  type Layer,
  type PanelFormat,
  type PanelSide,
  type PcbMaterial,
} from '@zpd/core';
import type { ToolContext } from '../types';
import { AlignPanel } from './align-panel';
import { CollapsibleSection } from './collapsible-section';
import { HelpPanel } from './help-panel';
import { InspectorHost } from './inspector-host';
import { LayerList } from './layer-list';
import { PathfinderPanel } from './pathfinder-panel';
import { RotateSelectionPanel } from './rotate-selection-panel';

// Fixed 2-member union (types.ts) — same hardcode-the-union convention as
// side-tabs.tsx's SIDE_LABELS, in catalog order (3U is the original/default
// format, listed first).
const FORMAT_OPTIONS: readonly { value: PanelFormat; label: string }[] = [
  { value: '3U', label: '3U' },
  { value: '1U', label: '1U' },
];

const MATERIAL_OPTIONS: readonly { value: PcbMaterial; label: string }[] = [
  { value: 'fr4', label: 'FR-4' },
  { value: 'alumi', label: 'Aluminum' },
];

// A format switch clamps an unsupported hp to the closest size the NEW
// format's catalog actually has (#237) — supportedHps is ascending, so the
// minimum absolute distance is well-defined even with ties resolved toward
// the first (smaller) candidate.
function nearestSupportedHp(hps: readonly number[], hp: number): number {
  return hps.reduce((closest, candidate) =>
    Math.abs(candidate - hp) < Math.abs(closest - hp) ? candidate : closest,
  );
}

export interface SidebarProps {
  ctx: ToolContext;
  // The committed doc from Editor's render — NOT the docRef-lagged ctx.doc.
  // Needed by RotateSelectionPanel's render-time session capture (see its
  // doc-prop comment); also drives the panel-size select's displayed value so
  // it never lags a commit by one render.
  doc: DocState;
  // Which face is being edited (#233), as committed Editor state — paired
  // with `doc` so render-time reads derive the SAME side/stack the commit
  // that produced this render did.
  activeSide: PanelSide;
  selectedIds: readonly string[];
  selectedLayer: Layer | null;
  activeToolId: string;
  showOutsidePanel: boolean;
  onShowOutsidePanelChange: (value: boolean) => void;
  showGuides: boolean;
  onShowGuidesChange: (value: boolean) => void;
}

export function Sidebar({
  ctx,
  doc,
  activeSide,
  selectedIds,
  selectedLayer,
  activeToolId,
  showOutsidePanel,
  onShowOutsidePanelChange,
  showGuides,
  onShowGuidesChange,
}: SidebarProps) {
  // The committed render-time stack of the ACTIVE side (#233) — what the
  // layer list and the selection-driven panels below read instead of
  // doc.layers.
  const sideStack = stackForSide(doc, activeSide);
  return (
    <aside className="flex w-72 flex-col border-l border-neutral-800 bg-neutral-900">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
        <CollapsibleSection title="View">
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-400">Show content outside the panel</span>
              <input
                type="checkbox"
                checked={showOutsidePanel}
                onChange={(e) => onShowOutsidePanelChange(e.target.checked)}
                className="accent-sky-400"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-400">Show guides</span>
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) => onShowGuidesChange(e.target.checked)}
                className="accent-sky-400"
              />
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Panel">
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-400">Format</span>
              <select
                value={doc.format}
                onChange={(e) => {
                  const nextFormat = e.target.value as PanelFormat;
                  const nextSupported = supportedHps(nextFormat);
                  // Switching format clamps an unsupported hp to the nearest
                  // supported size IN THE SAME COMMIT (#237) — one undo entry,
                  // never a hp select momentarily showing a value its own
                  // options list doesn't contain.
                  const nextHp = nextSupported.includes(doc.panelHp)
                    ? doc.panelHp
                    : nearestSupportedHp(nextSupported, doc.panelHp);
                  ctx.commit({ ...doc, format: nextFormat, panelHp: nextHp });
                }}
                className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-400">Size</span>
              <select
                value={doc.panelHp}
                onChange={(e) => ctx.commit({ ...doc, panelHp: Number(e.target.value) })}
                className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
              >
                {/* Constrained to the active format's catalog (#237) — PANEL_SIZES
                    covers every hp either format supports, so filtering it (rather
                    than deriving widths some other way) keeps one width source. */}
                {PANEL_SIZES.filter((s) => supportedHps(doc.format).includes(s.hp)).map((s) => (
                  <option key={s.hp} value={s.hp}>
                    {s.hp}HP — {s.widthMm}×{panelHeightMm(doc.format)}mm
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-400">Material</span>
              <select
                value={doc.material}
                onChange={(e) => ctx.commit({ ...doc, material: e.target.value as PcbMaterial })}
                className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
              >
                {MATERIAL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Layers" keepMounted>
          <LayerList ctx={ctx} stack={sideStack} selectedIds={selectedIds} />
        </CollapsibleSection>

        <CollapsibleSection title="Align & Distribute">
          <AlignPanel ctx={ctx} selectedIds={selectedIds} />
        </CollapsibleSection>

        {/* Gated on a real selection (#214) — hidden with nothing selected,
            shown (with per-button disabled state) once something is. */}
        {selectedIds.length >= 1 && (
          <CollapsibleSection title="Pathfinder">
            <PathfinderPanel ctx={ctx} stack={sideStack} selectedIds={selectedIds} />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title={selectedLayer ? `Properties — ${selectedLayer.type}` : 'Properties'}
        >
          <div className="flex flex-col gap-2">
            {/* Combined (multi/group) selections only (#157) — renders
                nothing for a single-leaf or all-non-rotatable selection, so
                it composes ahead of InspectorHost without an empty gap. */}
            <RotateSelectionPanel
              ctx={ctx}
              doc={doc}
              activeSide={activeSide}
              selectedIds={selectedIds}
            />
            <InspectorHost
              ctx={ctx}
              doc={doc}
              activeSide={activeSide}
              layer={selectedLayer}
              selectedIds={selectedIds}
            />
          </div>
        </CollapsibleSection>
      </div>

      <div className="shrink-0 border-t border-neutral-800 p-3">
        <CollapsibleSection title="Help" defaultOpen={false}>
          <HelpPanel activeToolId={activeToolId} />
          <p className="mt-2 border-t border-neutral-800 pt-2 text-[11px] text-neutral-500">
            The Front/Back tabs above the canvas pick which panel face you edit — the other
            face&rsquo;s layers are hidden while you work, never deleted.
          </p>
        </CollapsibleSection>
      </div>
    </aside>
  );
}
