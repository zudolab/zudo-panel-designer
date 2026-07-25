/**
 * Per-layer geometry extraction (Decision 0.4, 5, 9).
 *
 * #209 ships sources for `shape` and `path`. `pattern` (#211), `text` (#212)
 * and `image` return the typed `unsupported` hand-off instead — the first two
 * so their owners slot in, the third because a raster cannot be manufactured
 * (`core/src/types.ts:73`) and skipping it silently would drop artwork the user
 * can see.
 *
 * Everything here emits CUBICS in document millimetres with rotation already
 * baked. Nothing is flattened and nothing is clipped: Decision 5 puts the
 * union, the profile clip and finally the adaptive flattening downstream.
 */

import {
  normalizeRect,
  rectCenter,
  rotatePoint,
  type Layer,
  type PathLayer,
  type PathPoint,
  type ShapeLayer,
} from '@zpd/core';
import type {
  BooleanEngine,
  KernelCubic,
  KernelInput,
  KernelPoint,
  KernelRing,
} from '../geometry-kernel';
import { ellipseToRing } from './arc';
import type {
  IrExtractContext,
  IrLayerCubicResult,
  IrLayerResult,
  IrRegion,
  LayerGeometrySource,
} from './ir';
import { rectToRing } from './primitives';
import { ringsToRegions } from './regions';
import { CANVAS_DEFAULT_JOIN_STYLE, strokeSubpathsToInputs, type StrokeSubpath } from './stroker';
import { textGeometrySource } from './text-outline';
import type { IrTolerance } from './tolerance';

function unsupported(
  layer: Layer,
  reason: Extract<IrLayerResult, { kind: 'unsupported' }>['reason'],
  detail?: string,
): IrLayerResult & { kind: 'unsupported' } {
  return {
    kind: 'unsupported',
    layerId: layer.id,
    layerName: layer.name,
    reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

// ─── shape ─────────────────────────────────────────────────────────────────

function rotateRing(ring: KernelRing, center: KernelPoint, deg: number): KernelRing {
  const r = (p: KernelPoint): KernelPoint => rotatePoint(p, center, deg);
  return ring.map((c) => ({ p0: r(c.p0), c1: r(c.c1), c2: r(c.c2), p3: r(c.p3) }));
}

export function shapeLayerToGroups(layer: ShapeLayer, tolerance: IrTolerance): KernelInput[] {
  if (!finite(layer.x, layer.y, layer.width, layer.height)) return [];
  if (layer.width === 0 || layer.height === 0) return [];

  const raw = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  // Decision 9: normalise first. `ctx.rect` with a negative w/h draws the
  // mirrored rect (`renderer.ts:371`), and the ellipse branch already
  // normalises by hand (`:376-384`) because `ctx.ellipse` throws on a negative
  // radius — `normalizeRect` reproduces both.
  const rect = normalizeRect(raw);
  const ring =
    layer.shape === 'rect'
      ? rectToRing(rect.x, rect.y, rect.width, rect.height)
      : ellipseToRing(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          rect.width / 2,
          rect.height / 2,
          tolerance.arcMm,
        );
  if (ring.length === 0) return [];

  // The pivot is the RAW bbox centre (`renderer.ts:357-360`), which is
  // invariant under normalizeRect — so normalise-then-rotate and the
  // renderer's rotate-then-draw agree.
  const rotation = layer.rotation;
  const placed = rotation ? rotateRing(ring, rectCenter(raw), rotation) : ring;
  return [{ contours: [placed], fillRule: 'nonzero' }];
}

// ─── path ──────────────────────────────────────────────────────────────────

function segmentCubic(a: PathPoint, b: PathPoint): KernelCubic {
  // Mirrors `appendSubpath` (`core/src/path-geometry.ts:18-36`): a missing
  // handle collapses onto its own anchor, which is a straight edge.
  return {
    p0: { x: a.x, y: a.y },
    c1: a.hout ? { x: a.hout.x, y: a.hout.y } : { x: a.x, y: a.y },
    c2: b.hin ? { x: b.hin.x, y: b.hin.y } : { x: b.x, y: b.y },
    p3: { x: b.x, y: b.y },
  };
}

export function subpathToCubics(points: readonly PathPoint[], closed: boolean): KernelCubic[] {
  const out: KernelCubic[] = [];
  for (let i = 1; i < points.length; i++) out.push(segmentCubic(points[i - 1], points[i]));
  if (closed && points.length > 1) out.push(segmentCubic(points[points.length - 1], points[0]));
  return out;
}

export function pathLayerToGroups(
  layer: PathLayer,
  tolerance: IrTolerance,
  engine: BooleanEngine,
): KernelInput[] {
  const main = subpathToCubics(layer.points, layer.closed);
  // `extraSubpaths` are always appended closed (`path-geometry.ts:48-50`).
  const extras = (layer.extraSubpaths ?? [])
    .map((sub) => subpathToCubics(sub, true))
    .filter((sub) => sub.length > 0);

  const groups: KernelInput[] = [];

  // Fill: `renderer.ts:428-431` fills only when the primary subpath is closed,
  // and fills the WHOLE Path2D (primary + extras) with evenodd so traced
  // holes stay holes.
  if (layer.fill !== null && layer.closed && main.length > 0) {
    groups.push({ contours: [main, ...extras], fillRule: 'evenodd' });
  }

  // Stroke: `renderer.ts:432-435` strokes every subpath, with Canvas2D's
  // default butt cap / miter join / miter limit 10 (Decision 5).
  if (layer.stroke !== null && layer.strokeWidth > 0 && Number.isFinite(layer.strokeWidth)) {
    const subpaths: StrokeSubpath[] = [];
    if (main.length > 0) subpaths.push({ contour: main, closed: layer.closed });
    for (const extra of extras) subpaths.push({ contour: extra, closed: true });
    groups.push(
      ...strokeSubpathsToInputs(
        subpaths,
        { width: layer.strokeWidth, ...CANVAS_DEFAULT_JOIN_STYLE },
        tolerance,
        engine,
      ),
    );
  }

  return groups;
}

// ─── sources ───────────────────────────────────────────────────────────────

/**
 * The `IrLayerResult` form Decision 0.4 pins, derived from the cubic groups by
 * resolving them through the kernel and flattening. The orchestrator prefers
 * `extractCubics` (Decision 5 puts flattening last), so this path only runs for
 * a caller that consults a source directly.
 */
async function groupsToRegions(
  groups: readonly KernelInput[],
  ctx: IrExtractContext,
): Promise<IrRegion[]> {
  if (groups.length === 0) return [];
  const united = ctx.engine.arrange(groups.map((g) => ({ ...g }))).unite();
  return ringsToRegions(united, ctx.tolerance);
}

function cubicSource(
  handles: Layer['type'],
  toGroups: (layer: Layer, ctx: IrExtractContext) => KernelInput[],
): LayerGeometrySource {
  return {
    handles,
    async extract(layer, ctx) {
      return {
        kind: 'regions',
        layerId: layer.id,
        regions: await groupsToRegions(toGroups(layer, ctx), ctx),
      };
    },
    async extractCubics(layer, ctx): Promise<IrLayerCubicResult> {
      return { kind: 'cubics', layerId: layer.id, groups: toGroups(layer, ctx) };
    },
  };
}

export const shapeGeometrySource: LayerGeometrySource = cubicSource('shape', (layer, ctx) =>
  shapeLayerToGroups(layer as ShapeLayer, ctx.tolerance),
);

export const pathGeometrySource: LayerGeometrySource = cubicSource('path', (layer, ctx) =>
  pathLayerToGroups(layer as PathLayer, ctx.tolerance, ctx.engine),
);

function handoffSource(
  handles: Layer['type'],
  reason: Extract<IrLayerResult, { kind: 'unsupported' }>['reason'],
): LayerGeometrySource {
  return {
    handles,
    async extract(layer) {
      return unsupported(layer, reason);
    },
    async extractCubics(layer): Promise<IrLayerCubicResult> {
      return unsupported(layer, reason);
    },
  };
}

/** #211 owns pattern layers; until it registers a source this hands off. */
export const patternHandoffSource = handoffSource('pattern', 'pattern-layer');
/**
 * The pre-#212 hand-off. Kept exported (and tested) because it is the shape
 * every not-yet-implemented extractor takes, but it is no longer in
 * `BUILTIN_GEOMETRY_SOURCES` — `textGeometrySource` outlines text for real.
 */
export const textHandoffSource = handoffSource('text', 'text-layer');
/** Terminal: `image-layer` becomes the `image-layer-present` refusal. */
export const imageGeometrySource = handoffSource('image', 'image-layer');

export const BUILTIN_GEOMETRY_SOURCES: readonly LayerGeometrySource[] = [
  shapeGeometrySource,
  pathGeometrySource,
  patternHandoffSource,
  textGeometrySource,
  imageGeometrySource,
];
