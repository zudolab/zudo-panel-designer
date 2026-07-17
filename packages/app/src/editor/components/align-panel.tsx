// Align & distribute panel (Properties sidebar, #73): 6 align + 2 distribute
// buttons and a selection|panel reference toggle that governs both. Ported
// from $HOME/repos/zp/pgen/packages/pattern-gen-viewer/src/components/
// composer/composer-align-panel.tsx, collapsed onto core's two-mode
// AlignReference ('selection' | 'panel' — pgen's 'canvas' is zpd's panel
// rect, the composition bounds here) and zpd's ChromeButton/Tooltip chrome.
// Bboxes come from the app's rotation-aware layerBbox (renderer.ts); results
// apply via core alignLayers/distributeLayers as ONE undo commit per press
// (skipped entirely when the press is a no-op — see apply() below).
import { useState, type ReactNode } from 'react';
import {
  alignLayers,
  distributeLayers,
  normalizeRect,
  rotatedRectAABB,
  translatePathLayer,
  type AlignRect,
  type AlignType,
  type DistributeAxis,
  type DocState,
  type Layer,
  type PatternLayer,
} from '@zpd/core';
import { layerBbox, layerRotation } from '../renderer';
import type { ToolContext } from '../types';
import { ChromeButton } from './chrome';

export interface AlignPanelProps {
  ctx: ToolContext;
  selectedIds: readonly string[];
}

type Reference = 'selection' | 'panel';

interface IconButtonSpec<T> {
  value: T;
  label: string;
  icon: ReactNode;
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 14 14',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
};

const ALIGN_BUTTONS: IconButtonSpec<AlignType>[] = [
  {
    value: 'left',
    label: 'Align Left',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="2" y1="1" x2="2" y2="13" />
        <rect x="4" y="3" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="4" y="8" width="5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'center-h',
    label: 'Align Center (Horizontal)',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="7" y1="1" x2="7" y2="13" />
        <rect x="2" y="3" width="10" height="3" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="3.5" y="8" width="7" height="3" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'right',
    label: 'Align Right',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="12" y1="1" x2="12" y2="13" />
        <rect x="2" y="3" width="8" height="3" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="5" y="8" width="5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'top',
    label: 'Align Top',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="1" y1="2" x2="13" y2="2" />
        <rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="8" y="4" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'middle-v',
    label: 'Align Middle (Vertical)',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="1" y1="7" x2="13" y2="7" />
        <rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="8" y="3.5" width="3" height="7" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'bottom',
    label: 'Align Bottom',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="1" y1="12" x2="13" y2="12" />
        <rect x="3" y="2" width="3" height="8" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="8" y="5" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

const DISTRIBUTE_BUTTONS: IconButtonSpec<DistributeAxis>[] = [
  {
    value: 'horizontal',
    label: 'Distribute Horizontally',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="1" y1="1" x2="1" y2="13" />
        <line x1="13" y1="1" x2="13" y2="13" />
        <rect x="5" y="3" width="4" height="8" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    value: 'vertical',
    label: 'Distribute Vertically',
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="1" y1="1" x2="13" y2="1" />
        <line x1="1" y1="13" x2="13" y2="13" />
        <rect x="3" y="5" width="8" height="4" rx="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

// Selection reference needs 2+ eligible layers to align against (a single
// layer has nothing to align to) and 3+ to distribute (2 layers have no
// interior gap). Panel reference works from 1+ for both — the panel rect is
// always there to align/distribute against, matching pgen's canvas-reference
// semantics (computeAlignmentToCanvas / distribute-h/-v accept a single
// target).
function minCount(kind: 'align' | 'distribute', reference: Reference): number {
  if (reference === 'panel') return 1;
  return kind === 'align' ? 2 : 3;
}

// Same float hygiene as select.tsx's multi-move addMm: adds a delta without
// re-snapping the absolute position, so a press keeps every target's exact
// resulting offset rather than independently rounding each one.
function addMm(a: number, b: number): number {
  return Number((a + b).toFixed(6));
}

// Pattern layers are panel-wide, position-pinned backgrounds (no x/y of their
// own to align) — excluded from both the eligible set and its count, same
// rule as select.tsx's multi-move/multi-resize targets. A type-predicate
// filter (not a plain `!== 'pattern'` check) so downstream code sees the
// PatternLayer-free type and applyDelta's fallthrough branch below can read
// `.x`/`.y` without a cast.
type NonPatternLayer = Exclude<Layer, PatternLayer>;

// A path with no anchors (and no extra subpaths) has no real geometry, but
// core's pathBbox still has to return SOME Rect for it — it falls back to a
// 0×0 rect at the origin (see path-geometry.ts). Counting that as a real
// alignment target would silently pull a combined bbox toward (0, 0) and
// could yank a legitimately selected shape there too. Excluded here, before
// the target ever reaches layerAlignRect.
function hasGeometry(layer: NonPatternLayer): boolean {
  if (layer.type !== 'path') return true;
  return layer.points.length > 0 || (layer.extraSubpaths ?? []).some((sub) => sub.length > 0);
}

function eligibleLayers(doc: DocState, selectedIds: readonly string[]): NonPatternLayer[] {
  return doc.layers.filter(
    (l): l is NonPatternLayer =>
      selectedIds.includes(l.id) && l.type !== 'pattern' && hasGeometry(l),
  );
}

function layerAlignRect(layer: Layer, ctx: ToolContext): AlignRect {
  const raw = layerBbox(layer, ctx.panel) ?? { x: 0, y: 0, width: 0, height: 0 };
  const bbox = normalizeRect(rotatedRectAABB(raw, layerRotation(layer)));
  return { id: layer.id, x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
}

function applyDelta(layer: NonPatternLayer, dx: number, dy: number): Partial<Layer> {
  if (layer.type === 'path') return translatePathLayer(layer, dx, dy);
  return { x: addMm(layer.x, dx), y: addMm(layer.y, dy) };
}

export function AlignPanel({ ctx, selectedIds }: AlignPanelProps) {
  const [reference, setReference] = useState<Reference>('selection');

  const targets = eligibleLayers(ctx.doc, selectedIds);
  const alignDisabled = targets.length < minCount('align', reference);
  const distributeDisabled = targets.length < minCount('distribute', reference);

  function apply(results: { id: string; dx: number; dy: number }[]) {
    const patches = new Map<string, Partial<Layer>>();
    for (const layer of targets) {
      const result = results.find((r) => r.id === layer.id);
      // Already-aligned/-distributed targets return a zero delta — skip them
      // so a no-op press doesn't touch history: ctx.commit always discards
      // any redo branch (see history.ts), so committing an identical doc
      // would silently wipe the user's redo stack for zero visual change.
      if (result && (result.dx !== 0 || result.dy !== 0)) {
        patches.set(layer.id, applyDelta(layer, result.dx, result.dy));
      }
    }
    if (patches.size === 0) return;
    ctx.commit({
      ...ctx.doc,
      layers: ctx.doc.layers.map((l) => {
        const patch = patches.get(l.id);
        return patch ? ({ ...l, ...patch } as Layer) : l;
      }),
    });
  }

  function alignReference() {
    return reference === 'panel'
      ? ({ mode: 'panel', panel: { x: 0, y: 0, width: ctx.panel.widthMm, height: ctx.panel.heightMm } } as const)
      : ({ mode: 'selection' } as const);
  }

  function handleAlign(type: AlignType) {
    apply(alignLayers(targets.map((l) => layerAlignRect(l, ctx)), type, alignReference()));
  }

  function handleDistribute(axis: DistributeAxis) {
    apply(distributeLayers(targets.map((l) => layerAlignRect(l, ctx)), axis, alignReference()));
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">Align</p>
        <div className="flex flex-wrap gap-1">
          {ALIGN_BUTTONS.map((btn) => (
            <ChromeButton
              key={btn.value}
              tooltip={btn.label}
              placement="top"
              disabled={alignDisabled}
              onClick={() => handleAlign(btn.value)}
              className="h-8 w-8 !px-0 text-base"
            >
              {btn.icon}
            </ChromeButton>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">Distribute</p>
        <div className="flex flex-wrap gap-1">
          {DISTRIBUTE_BUTTONS.map((btn) => (
            <ChromeButton
              key={btn.value}
              tooltip={btn.label}
              placement="top"
              disabled={distributeDisabled}
              onClick={() => handleDistribute(btn.value)}
              className="h-8 w-8 !px-0 text-base"
            >
              {btn.icon}
            </ChromeButton>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-2 text-xs">
        <span className="text-neutral-400">Align to</span>
        <select
          value={reference}
          onChange={(e) => setReference(e.target.value as Reference)}
          className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-neutral-100"
        >
          <option value="selection">Selection</option>
          <option value="panel">Panel</option>
        </select>
      </label>
    </div>
  );
}
