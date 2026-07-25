// Shared dispatch glue for the Path Finder panel (components/pathfinder-panel.tsx)
// AND the command registry (commands.ts) — the two UI entry points into
// ../pathfinder's createPathfinderRunner. Kept in one place so a click and a
// palette invocation report exactly the same way, rather than two
// hand-copied .catch() blocks drifting apart.
//
// `applied`/`stale` outcomes are left silent by design: applied is visibly
// obvious (the layer tree/selection just changed) and stale is the runner's
// own guard doing its job — the user's later action already superseded this
// one, so nothing is missing that needs explaining (see pathfinder/runner.ts's
// header). `no-op` and a thrown rejection ARE surfaced: a click that visibly
// does nothing (a disjoint Intersect, an all-consuming Subtract) is otherwise
// indistinguishable from a silently-broken button.
import { PATHFINDER_OP_LABELS, type PathfinderOp, type PathfinderRunner } from './pathfinder';
import { toastError, toastWarning } from './registry/toasts';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Returns a promise that settles once the outcome has been handled (toasted
// or not) — callers that only want fire-and-forget (commands.ts) can ignore
// it; the panel awaits it to clear its own busy state.
export function dispatchPathfinderOp(runner: PathfinderRunner, op: PathfinderOp): Promise<void> {
  return runner
    .run(op)
    .then((outcome) => {
      if (outcome.status === 'no-op') {
        toastWarning(`${PATHFINDER_OP_LABELS[op]} produced no result`);
      }
    })
    .catch((err: unknown) => {
      // Unexpected/catastrophic (e.g. the geometry kernel failed to load) —
      // not a per-click condition to branch on, but still worth telling the
      // user rather than a click that silently does nothing.
      console.error(`pathfinder:${op}`, err);
      toastError(`${PATHFINDER_OP_LABELS[op]} failed`, { description: errorMessage(err) });
    });
}
