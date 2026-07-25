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
import { useMemo, type ReactNode } from 'react';
import {
  canApplyPathfinderOp,
  createPathfinderRunner,
  PATHFINDER_OP_LABELS,
  resolvePathfinderInputs,
  type PathfinderOp,
} from '../pathfinder';
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

export function PathfinderPanel({ ctx, selectedIds }: PathfinderPanelProps) {
  // `ctx` is a stable, getter-backed object for the life of the Editor (see
  // Editor.tsx's ctx useMemo), so one runner per panel instance is enough —
  // it is what carries the dispatch sequence number across clicks, letting
  // a rapid second click supersede an in-flight first one (runner.ts).
  const runner = useMemo(() => createPathfinderRunner(ctx), [ctx]);

  // Same live tree + selection the runner will resolve at dispatch time;
  // recomputed on every render so the gating never lags a commit.
  const eligibleCount = resolvePathfinderInputs(ctx.doc.layers, selectedIds).length;

  function handleOp(op: PathfinderOp) {
    // Fire-and-forget, like every other async command in this app (see
    // use-clipboard.ts's routeImportFile calls) — a rejected geometry load
    // is unexpected/catastrophic, not a per-click condition to branch on.
    runner.run(op).catch((err: unknown) => {
      console.error(`pathfinder:${op}`, err);
    });
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
              disabled={!canApplyPathfinderOp(btn.op, eligibleCount)}
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
