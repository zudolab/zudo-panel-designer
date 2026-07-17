// Selection normalization (#44). The ToolContext.selectedIds contract is:
// de-duplicated, only ids present in the current doc (stale ids after a
// delete/undo drop out), and DOCUMENT order — the layers-array order, NOT the
// order the ids were clicked/passed in — so chrome and inspectors are stable.
//
// The Editor applies this lazily at READ time (in the ctx getters), not inside
// selectIds(): tools select a layer they just committed within the same event
// handler, before the Editor's live doc ref has synced, so eager filtering
// would wrongly drop the fresh id (same staleness rule the existing live-ref
// getters already follow — see Editor.tsx).
import type { Layer } from '@zpd/core';

export function normalizeSelectedIds(
  ids: readonly string[],
  layers: readonly Layer[],
): readonly string[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const result: string[] = [];
  for (const layer of layers) {
    if (wanted.has(layer.id)) result.push(layer.id);
  }
  return result;
}
