// Align & distribute panel (Properties sidebar, #73): 6 align + 2 distribute
// buttons and a selection|panel reference toggle that governs both. The
// actual align/distribute math + eligibility rules live in ../align-ops.ts
// (issue #76) — shared with the command registry's palette-facing
// align/distribute commands — this file is UI only: buttons + the reference
// toggle.
import { useState, type ReactNode } from 'react';
import type { AlignType, DistributeAxis } from '@zpd/core';
import { applyAlign, applyDistribute, canAlign, canDistribute, type Reference } from '../align-ops';
import type { ToolContext } from '../types';
import { ChromeButton } from './chrome';

export interface AlignPanelProps {
  ctx: ToolContext;
  selectedIds: readonly string[];
}

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

export function AlignPanel({ ctx, selectedIds }: AlignPanelProps) {
  const [reference, setReference] = useState<Reference>('selection');

  const alignDisabled = !canAlign(ctx.doc, selectedIds, reference);
  const distributeDisabled = !canDistribute(ctx.doc, selectedIds, reference);

  function handleAlign(type: AlignType) {
    applyAlign(ctx, selectedIds, type, reference);
  }

  function handleDistribute(axis: DistributeAxis) {
    applyDistribute(ctx, selectedIds, axis, reference);
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
