// Path Finder panel (Properties sidebar, #214): the ten Illustrator-panel
// ops as two icon-only button rows — "Shape Modes:" (unite / minusFront /
// intersect / exclude) and "Pathfinders:" (divide / trim / merge / crop /
// outline / minusBack). `minusBack` lives in the second row even though it
// is engine-wise a shape mode — that is where Illustrator puts it (see
// ../pathfinder/README.md), and users expect it there.
//
// UI only. The op math, selection eligibility and document mutation are the
// pathfinder module's job (#208/#213) — this file wires buttons to
// `createPathfinderRunner(ctx).run(op)`, which owns the async stale-input
// guard and the one-undo-entry commit; nothing here re-derives either.
import { useMemo, useState, type ReactNode } from 'react';
import type { PcbLayerStack } from '@zpd/core';
import {
  canApplyPathfinderOp,
  createPathfinderRunner,
  PATHFINDER_OP_LABELS,
  resolvePathfinderInputs,
  type PathfinderOp,
} from '../pathfinder';
import { dispatchPathfinderOp } from '../pathfinder-run';
import type { ToolContext } from '../types';
import { ChromeButton } from './chrome';
import {
  PathfinderCrop,
  PathfinderDivide,
  PathfinderExclude,
  PathfinderIntersect,
  PathfinderMerge,
  PathfinderMinusBack,
  PathfinderMinusFront,
  PathfinderOutline,
  PathfinderTrim,
  PathfinderUnite,
} from './icons';

export interface PathfinderPanelProps {
  ctx: ToolContext;
  // The COMMITTED active-side stack from Editor's render (#233) — NOT the
  // docRef-lagged ctx.activeStack (see rotate-selection-panel.tsx's identical
  // doc-prop comment for why: ctx.doc resyncs in a passive effect, so the
  // render a commit triggers still sees the PREVIOUS tree). Align/Distribute
  // get away with reading ctx directly because their ops never change WHICH
  // ids are selected or eligible; a Path Finder op mints brand-new leaf ids
  // and reselects them in the same commit, so pairing the fresh `selectedIds`
  // below against a stale ctx stack would resolve zero eligible leaves —
  // every button (including Divide/Outline) would render disabled right
  // after a successful op, with no further render to self-correct it.
  stack: PcbLayerStack;
  selectedIds: readonly string[];
}

interface PathfinderButtonSpec {
  op: PathfinderOp;
  icon: ReactNode;
}

const ICON_CLASS = 'h-4 w-4';

const SHAPE_MODE_BUTTONS: PathfinderButtonSpec[] = [
  { op: 'unite', icon: <PathfinderUnite className={ICON_CLASS} /> },
  { op: 'minusFront', icon: <PathfinderMinusFront className={ICON_CLASS} /> },
  { op: 'intersect', icon: <PathfinderIntersect className={ICON_CLASS} /> },
  { op: 'exclude', icon: <PathfinderExclude className={ICON_CLASS} /> },
];

const PATHFINDER_BUTTONS: PathfinderButtonSpec[] = [
  { op: 'divide', icon: <PathfinderDivide className={ICON_CLASS} /> },
  { op: 'trim', icon: <PathfinderTrim className={ICON_CLASS} /> },
  { op: 'merge', icon: <PathfinderMerge className={ICON_CLASS} /> },
  { op: 'crop', icon: <PathfinderCrop className={ICON_CLASS} /> },
  { op: 'outline', icon: <PathfinderOutline className={ICON_CLASS} /> },
  { op: 'minusBack', icon: <PathfinderMinusBack className={ICON_CLASS} /> },
];

export function PathfinderPanel({ ctx, stack, selectedIds }: PathfinderPanelProps) {
  // `ctx` is a stable, getter-backed object for the life of the Editor (see
  // Editor.tsx's ctx useMemo), so one runner per panel instance is enough —
  // it is what carries the dispatch sequence number across clicks, letting
  // a rapid second click supersede an in-flight first one (runner.ts). Only
  // used for DISPATCH (createPathfinderRunner reads ctx.doc/.selectedIds
  // live, from inside a click handler, where the refs have already caught
  // up) — never for this render's own gating math, see the `doc` prop above.
  const runner = useMemo(() => createPathfinderRunner(ctx), [ctx]);

  // The same committed tree this render's `selectedIds` was resolved
  // against (both come from Editor's own commit-triggered render — see the
  // `stack` prop's comment) — never lags a commit, unlike ctx.doc.
  const eligibleCount = resolvePathfinderInputs(stack, selectedIds).length;

  // Dispatches in flight, across all ten buttons — the whole row is disabled
  // while any is pending, mainly to cover the first (slowest) click, which
  // also pays the lazy `import('path-bool')` cost (see runner.ts's `pending`
  // doc comment: "the panel's busy state").
  const [pendingCount, setPendingCount] = useState(0);

  function handleOp(op: PathfinderOp) {
    setPendingCount((n) => n + 1);
    dispatchPathfinderOp(runner, op).finally(() => setPendingCount((n) => n - 1));
  }

  function renderRow(label: string, buttons: PathfinderButtonSpec[]) {
    return (
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
        <div className="flex flex-wrap gap-1">
          {buttons.map((btn) => (
            <ChromeButton
              key={btn.op}
              tooltip={PATHFINDER_OP_LABELS[btn.op]}
              placement="top"
              disabled={!canApplyPathfinderOp(btn.op, eligibleCount) || pendingCount > 0}
              onClick={() => handleOp(btn.op)}
              className="h-7 w-7 !p-0"
            >
              {btn.icon}
            </ChromeButton>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {renderRow('Shape Modes:', SHAPE_MODE_BUTTONS)}
      {renderRow('Pathfinders:', PATHFINDER_BUTTONS)}
    </div>
  );
}
