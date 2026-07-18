// Align & distribute logic, split out of components/align-panel.tsx (issue
// #76) so both the Align panel's own buttons AND the command registry's
// palette-facing align/distribute commands (commands.ts) apply through the
// exact same functions — "press the button" and "run the command" are one
// code path, not two kept in sync by hand. (Also keeps align-panel.tsx a
// components-only export for React Fast Refresh.)
//
// Ported from $HOME/repos/zp/pgen/packages/pattern-gen-viewer/src/components/
// composer/composer-align-panel.tsx, collapsed onto core's two-mode
// AlignReference ('selection' | 'panel' — pgen's 'canvas' is zpd's panel
// rect, the composition bounds here). Bboxes come from the app's
// rotation-aware layerBbox (renderer.ts); results apply via core
// alignLayers/distributeLayers as ONE undo commit per call (skipped entirely
// when the call is a no-op — see applyResults() below).
import {
  alignLayers,
  distributeLayers,
  MIN_ALIGN_SELECTION,
  MIN_DISTRIBUTE_SELECTION,
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
import { layerBbox, layerRotation } from './renderer';
import type { ToolContext } from './types';

export type Reference = 'selection' | 'panel';

// Selection reference needs 2+ eligible layers to align against (a single
// layer has nothing to align to) and 3+ to distribute (2 layers have no
// interior gap). Panel reference works from 1+ for both — the panel rect is
// always there to align/distribute against, matching pgen's canvas-reference
// semantics (computeAlignmentToCanvas / distribute-h/-v accept a single
// target).
export function minCount(kind: 'align' | 'distribute', reference: Reference): number {
  if (reference === 'panel') return 1;
  return kind === 'align' ? MIN_ALIGN_SELECTION : MIN_DISTRIBUTE_SELECTION;
}

// Same float hygiene as select.tsx's multi-move addMm: adds a delta without
// re-snapping the absolute position, so a call keeps every target's exact
// resulting offset rather than independently rounding each one.
function addMm(a: number, b: number): number {
  return Number((a + b).toFixed(6));
}

// Pattern layers are excluded from both the eligible set and its count, same
// rule as select.tsx's multi-move/multi-resize targets (they carry an x/y/size
// square since #96, but stay canvas-non-interactive until the interaction
// sub). A type-predicate filter (not a plain `!== 'pattern'` check) so
// downstream code sees the PatternLayer-free type and applyDelta's
// fallthrough branch below can read `.x`/`.y` without a cast.
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

export function eligibleLayers(doc: DocState, selectedIds: readonly string[]): NonPatternLayer[] {
  return doc.layers.filter(
    (l): l is NonPatternLayer =>
      selectedIds.includes(l.id) && l.type !== 'pattern' && hasGeometry(l),
  );
}

export function layerAlignRect(layer: Layer): AlignRect {
  const raw = layerBbox(layer) ?? { x: 0, y: 0, width: 0, height: 0 };
  const bbox = normalizeRect(rotatedRectAABB(raw, layerRotation(layer)));
  return { id: layer.id, x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
}

function applyDelta(layer: NonPatternLayer, dx: number, dy: number): Partial<Layer> {
  if (layer.type === 'path') return translatePathLayer(layer, dx, dy);
  return { x: addMm(layer.x, dx), y: addMm(layer.y, dy) };
}

function alignReferenceInput(reference: Reference, ctx: ToolContext) {
  return reference === 'panel'
    ? ({
        mode: 'panel',
        panel: { x: 0, y: 0, width: ctx.panel.widthMm, height: ctx.panel.heightMm },
      } as const)
    : ({ mode: 'selection' } as const);
}

function applyResults(
  ctx: ToolContext,
  targets: readonly NonPatternLayer[],
  results: { id: string; dx: number; dy: number }[],
): void {
  const patches = new Map<string, Partial<Layer>>();
  for (const layer of targets) {
    const result = results.find((r) => r.id === layer.id);
    // Already-aligned/-distributed targets return a zero delta — skip them so
    // a no-op call doesn't touch history: ctx.commit always discards any redo
    // branch (see history.ts), so committing an identical doc would silently
    // wipe the user's redo stack for zero visual change.
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

export function canAlign(
  doc: DocState,
  selectedIds: readonly string[],
  reference: Reference,
): boolean {
  return eligibleLayers(doc, selectedIds).length >= minCount('align', reference);
}

export function canDistribute(
  doc: DocState,
  selectedIds: readonly string[],
  reference: Reference,
): boolean {
  return eligibleLayers(doc, selectedIds).length >= minCount('distribute', reference);
}

export function applyAlign(
  ctx: ToolContext,
  selectedIds: readonly string[],
  type: AlignType,
  reference: Reference,
): void {
  const targets = eligibleLayers(ctx.doc, selectedIds);
  applyResults(
    ctx,
    targets,
    alignLayers(
      targets.map((l) => layerAlignRect(l)),
      type,
      alignReferenceInput(reference, ctx),
    ),
  );
}

export function applyDistribute(
  ctx: ToolContext,
  selectedIds: readonly string[],
  axis: DistributeAxis,
  reference: Reference,
): void {
  const targets = eligibleLayers(ctx.doc, selectedIds);
  applyResults(
    ctx,
    targets,
    distributeLayers(
      targets.map((l) => layerAlignRect(l)),
      axis,
      alignReferenceInput(reference, ctx),
    ),
  );
}
