// Shared fixtures + measurement helpers for the Path Finder op tests.
//
// Leaves are hand-built rather than read out of a document on purpose: the ops
// take `EligibleLeaf[]` directly, and `normalizeLayerMaterial` would force every
// leaf inside one material container to the same colour — which would make the
// style-inheritance and face-attribution assertions untestable. selection.ts's
// own tests use a real `PcbLayerStack`, where that normalization is the point.
import type { ColorIndex, PathLayer, PathPoint, PcbLayerRole, ShapeLayer } from '@zpd/core';
import { expect } from 'vitest';
import {
  flattenRing,
  pointInPolygon,
  ringSignedArea,
  type KernelPathSpec,
  type KernelPoint,
  type KernelRing,
} from '../geometry-kernel';
import { specHoleRings, specOuterRing } from './convert';
import type { EligibleLeaf, PathfinderOpResult } from './types';

export function shapeLeaf(
  id: string,
  shape: ShapeLayer['shape'],
  x: number,
  y: number,
  width: number,
  height: number,
  color: ColorIndex,
  extra: { rotation?: number; role?: PcbLayerRole; hidden?: boolean } = {},
): EligibleLeaf {
  const layer: ShapeLayer = {
    id,
    name: id,
    type: 'shape',
    shape,
    x,
    y,
    width,
    height,
    color,
    ...(extra.rotation === undefined ? {} : { rotation: extra.rotation }),
    ...(extra.hidden ? { hidden: true } : {}),
  };
  return { id, layer, role: extra.role ?? 'copper' };
}

export const rectShape = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: ColorIndex,
  extra?: { rotation?: number; role?: PcbLayerRole },
): EligibleLeaf => shapeLeaf(id, 'rect', x, y, w, h, color, extra);

export const ellipseShape = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: ColorIndex,
  extra?: { rotation?: number; role?: PcbLayerRole },
): EligibleLeaf => shapeLeaf(id, 'ellipse', x, y, w, h, color, extra);

export function pathLeaf(
  id: string,
  points: PathPoint[],
  closed: boolean,
  fill: ColorIndex | null,
  extra: {
    extraSubpaths?: PathPoint[][];
    stroke?: ColorIndex | null;
    strokeWidth?: number;
    role?: PcbLayerRole;
  } = {},
): EligibleLeaf {
  const layer: PathLayer = {
    id,
    name: id,
    type: 'path',
    points,
    closed,
    ...(extra.extraSubpaths ? { extraSubpaths: extra.extraSubpaths } : {}),
    fill,
    stroke: extra.stroke ?? null,
    strokeWidth: extra.strokeWidth ?? 0,
  };
  return { id, layer, role: extra.role ?? 'copper' };
}

/** Narrow a fixture leaf back to its `ShapeLayer` for the direct bake helpers. */
export function shapeLayerOf(leaf: EligibleLeaf): ShapeLayer {
  if (leaf.layer.type !== 'shape') throw new Error(`leaf ${leaf.id} is not a shape leaf`);
  return leaf.layer;
}

/** Axis-aligned rectangle as absolute-mm path points (world space — no transform). */
export function rectPoints(x: number, y: number, w: number, h: number): PathPoint[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export const rectPath = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: ColorIndex | null,
  extra?: Parameters<typeof pathLeaf>[4],
): EligibleLeaf => pathLeaf(id, rectPoints(x, y, w, h), true, fill, extra);

/** Rectangle path carrying explicit hole subpaths (`extraSubpaths`, evenodd). */
export const compoundRectPath = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: ColorIndex | null,
  holes: PathPoint[][],
  extra: { role?: PcbLayerRole } = {},
): EligibleLeaf =>
  pathLeaf(id, rectPoints(x, y, w, h), true, fill, { extraSubpaths: holes, ...extra });

/** A self-intersecting "bowtie" path — two triangle lobes crossing at (50,50). */
export const bowtiePath = (id: string, fill: ColorIndex | null): EligibleLeaf =>
  pathLeaf(
    id,
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ],
    true,
    fill,
  );

/** A smooth, non-self-intersecting bezier blob centred on (cx, cy). */
export function blobPath(
  id: string,
  cx: number,
  cy: number,
  r: number,
  fill: ColorIndex | null,
): EligibleLeaf {
  const n = 5;
  const points: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    // Handles perpendicular to the radius → simple, non-self-intersecting.
    const h = r * 0.4;
    const dx = -Math.sin(theta) * h;
    const dy = Math.cos(theta) * h;
    points.push({ x, y, hout: { x: x + dx, y: y + dy }, hin: { x: x - dx, y: y - dy } });
  }
  return pathLeaf(id, points, true, fill);
}

// ─── Measurement helpers (world mm) ────────────────────────────────────────

export const absArea = (ring: KernelRing): number => Math.abs(ringSignedArea(ring));

export const specArea = (spec: KernelPathSpec): number => absArea(specOuterRing(spec));

/** True painted area of a spec = |outer| − Σ|holes|. */
export const specNetArea = (spec: KernelPathSpec): number =>
  specArea(spec) - specHoleRings(spec).reduce((sum, ring) => sum + absArea(ring), 0);

export const resultNetArea = (result: PathfinderOpResult): number =>
  result.specs.reduce((sum, spec) => sum + specNetArea(spec), 0);

export const holeCount = (spec: KernelPathSpec): number => spec.extraSubpaths?.length ?? 0;

export const totalHoleCount = (result: PathfinderOpResult): number =>
  result.specs.reduce((sum, spec) => sum + holeCount(spec), 0);

export function specContainsPoint(spec: KernelPathSpec, point: KernelPoint): boolean {
  if (!pointInPolygon(point, flattenRing(specOuterRing(spec)))) return false;
  return specHoleRings(spec).every((ring) => !pointInPolygon(point, flattenRing(ring)));
}

/**
 * Compare mm² areas with a RELATIVE tolerance. Vitest's `toBeCloseTo(x, 0)`
 * is absolute (±0.5), which is meaningless next to a 18_000 mm² region and
 * would flag the kappa ellipse's documented ~0.03% curve approximation as a
 * failure. Default 0.1% comfortably covers that and still catches a real error.
 */
export function expectAreaClose(actual: number, expected: number, relativeTolerance = 1e-3): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * relativeTolerance);
}

export function fillCounts(specs: KernelPathSpec[]): Map<ColorIndex | null, number> {
  const counts = new Map<ColorIndex | null, number>();
  for (const spec of specs) counts.set(spec.fill, (counts.get(spec.fill) ?? 0) + 1);
  return counts;
}
