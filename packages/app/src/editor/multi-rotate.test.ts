// Pure gesture-math contract for the multi/group-rotate session (#152):
// capture freezing (rotatable-only pivot/bounds), re-bake-from-start
// idempotence, the atan2 branch-cut unwrap, and the delta snap. The full
// pointer lifecycle is covered in tools/select-multi-rotate.test.ts.
import { describe, expect, it } from 'vitest';
import {
  flattenLayerNodes,
  type GroupNode,
  type Layer,
  type LayerNode,
  type PathLayer,
  type ShapeLayer,
} from '@zpd/core';
import {
  bakeMultiRotate,
  captureMultiRotateSession,
  snapRotateDelta,
  unwrapRotateDelta,
} from './multi-rotate';

const shape = (id: string, x: number, y: number, extra: Partial<ShapeLayer> = {}): ShapeLayer => ({
  id,
  name: id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: 10,
  height: 10,
  color: 1,
  ...extra,
});

const pattern = (id: string, x = 0, y = 0, size = 50): Layer => ({
  id,
  name: id,
  type: 'pattern',
  patternType: 'dot-grid',
  params: {},
  color: 1,
  x,
  y,
  size,
});

const path = (id: string): PathLayer => ({
  id,
  name: id,
  type: 'path',
  points: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
  ],
  closed: false,
  fill: null,
  stroke: 1,
  strokeWidth: 1,
});

const group = (id: string, children: LayerNode[]): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
});

describe('captureMultiRotateSession (#152 frozen capture)', () => {
  it('freezes rotatable leaf ids, start snapshots, centers, bounds and pivot', () => {
    const tree: LayerNode[] = [shape('a', 10, 10), shape('b', 30, 10)];
    const session = captureMultiRotateSession(tree, ['a', 'b'], flattenLayerNodes(tree))!;
    expect(session.leafIds).toEqual(['a', 'b']);
    expect(session.bounds).toEqual({ x: 10, y: 10, width: 30, height: 10 });
    expect(session.pivot).toEqual({ x: 25, y: 15 });
    expect(session.centersById).toEqual({ a: { x: 15, y: 15 }, b: { x: 35, y: 15 } });
  });

  it('pivot and bounds derive from the ROTATABLE leaves only — a big pattern must not displace them', () => {
    const tree: LayerNode[] = [pattern('g', 0, 0, 100), shape('a', 10, 10)];
    const session = captureMultiRotateSession(tree, ['g', 'a'], flattenLayerNodes(tree))!;
    expect(session.leafIds).toEqual(['a']);
    expect(session.bounds).toEqual({ x: 10, y: 10, width: 10, height: 10 });
    expect(session.pivot).toEqual({ x: 15, y: 15 });
  });

  it('a rotated member contributes its rotation-aware AABB to the frozen bounds', () => {
    // 20×10 at (0,0) rotated 90° → AABB 10×20 centered at (10,5): x 5..15, y -5..15.
    const tree: LayerNode[] = [shape('r', 0, 0, { width: 20, height: 10, rotation: 90 })];
    const session = captureMultiRotateSession(tree, ['r'], flattenLayerNodes(tree))!;
    expect(session.bounds.x).toBeCloseTo(5);
    expect(session.bounds.y).toBeCloseTo(-5);
    expect(session.bounds.width).toBeCloseTo(10);
    expect(session.bounds.height).toBeCloseTo(20);
  });

  it('returns null when the selection has no rotatable editable leaf', () => {
    const tree: LayerNode[] = [pattern('g1'), pattern('g2', 60, 0)];
    expect(captureMultiRotateSession(tree, ['g1', 'g2'], flattenLayerNodes(tree))).toBeNull();
  });

  it('expands a group id to its rotatable descendant leaves', () => {
    const tree: LayerNode[] = [group('G', [shape('a', 10, 10), shape('b', 30, 10)])];
    const session = captureMultiRotateSession(tree, ['G'], flattenLayerNodes(tree))!;
    expect(session.leafIds).toEqual(['a', 'b']);
    expect(session.pivot).toEqual({ x: 25, y: 15 });
  });
});

describe('bakeMultiRotate (#152 re-bake-from-start)', () => {
  const tree: LayerNode[] = [shape('a', 10, 10), shape('b', 30, 10)];
  const capture = () => captureMultiRotateSession(tree, ['a', 'b'], flattenLayerNodes(tree))!;

  it('orbits each member center about the frozen pivot and folds the delta into rotation', () => {
    const session = capture();
    const baked = flattenLayerNodes(bakeMultiRotate(tree, session, 90));
    // a: center (15,15) about pivot (25,15) by 90° cw → (25, 5) → x 20, y 0.
    expect(baked[0]).toMatchObject({ id: 'a', rotation: 90 });
    expect((baked[0] as ShapeLayer).x).toBeCloseTo(20);
    expect((baked[0] as ShapeLayer).y).toBeCloseTo(0);
    // b: center (35,15) → (25, 25) → x 20, y 20.
    expect((baked[1] as ShapeLayer).x).toBeCloseTo(20);
    expect((baked[1] as ShapeLayer).y).toBeCloseTo(20);
  });

  it('is idempotent: the same (session, delta) always produces the same tree', () => {
    const session = capture();
    expect(bakeMultiRotate(tree, session, 33.3)).toEqual(bakeMultiRotate(tree, session, 33.3));
  });

  it('streamed ticks re-bake from start: applying 10° then 20° then 30° equals one 30° bake', () => {
    const session = capture();
    let live = bakeMultiRotate(tree, session, 10);
    live = bakeMultiRotate(live, session, 20);
    live = bakeMultiRotate(live, session, 30);
    expect(live).toEqual(bakeMultiRotate(tree, session, 30));
  });

  it('delta 0 restores the exact start geometry (a drag back to zero reverts fully)', () => {
    const session = capture();
    const forward = bakeMultiRotate(tree, session, 137.2);
    const back = flattenLayerNodes(bakeMultiRotate(forward, session, 0));
    const start = flattenLayerNodes(tree);
    for (let i = 0; i < start.length; i += 1) {
      expect(back[i]).toMatchObject({ id: start[i].id });
      expect((back[i] as ShapeLayer).x).toBeCloseTo((start[i] as ShapeLayer).x);
      expect((back[i] as ShapeLayer).y).toBeCloseTo((start[i] as ShapeLayer).y);
    }
  });

  it('bakes a path by rotating its point geometry (no rotation field invented)', () => {
    const t: LayerNode[] = [path('p'), shape('a', 10, 20)];
    const session = captureMultiRotateSession(t, ['p', 'a'], flattenLayerNodes(t))!;
    const baked = flattenLayerNodes(bakeMultiRotate(t, session, 90));
    const p = baked[0] as PathLayer;
    expect('rotation' in p).toBe(false);
    expect(p.points[0].x).not.toBeCloseTo(10); // geometry actually moved
  });

  it('leaves a selected pattern member completely unchanged', () => {
    const t: LayerNode[] = [pattern('g', 0, 0, 100), shape('a', 10, 10)];
    const session = captureMultiRotateSession(t, ['g', 'a'], flattenLayerNodes(t))!;
    const baked = flattenLayerNodes(bakeMultiRotate(t, session, 45));
    expect(baked[0]).toEqual(flattenLayerNodes(t)[0]);
  });

  it('a lone group id bakes identically to the equivalent flat multi-selection', () => {
    const flatTree: LayerNode[] = [shape('a', 10, 10), shape('b', 30, 10)];
    const groupedTree: LayerNode[] = [group('G', [shape('a', 10, 10), shape('b', 30, 10)])];
    const flatSession = captureMultiRotateSession(flatTree, ['a', 'b'], flattenLayerNodes(flatTree))!;
    const groupSession = captureMultiRotateSession(groupedTree, ['G'], flattenLayerNodes(groupedTree))!;
    expect(flattenLayerNodes(bakeMultiRotate(groupedTree, groupSession, 67.5))).toEqual(
      flattenLayerNodes(bakeMultiRotate(flatTree, flatSession, 67.5)),
    );
  });
});

describe('unwrapRotateDelta (#152 — the atan2 ±180° branch cut)', () => {
  it('passes small offsets through untouched', () => {
    expect(unwrapRotateDelta(15, 10)).toBe(15);
    expect(unwrapRotateDelta(-15, -10)).toBe(-15);
  });

  it('accumulates continuously past +180°: raw jumps to the negative branch, delta keeps growing', () => {
    // prev 170°, pointer crosses the cut → raw offset reads -160 (mod-360 of 200)
    expect(unwrapRotateDelta(-160, 170)).toBe(200);
  });

  it('accumulates continuously past -180° (counter-clockwise)', () => {
    // prev -170°, raw reads +165 (mod-360 of -195)
    expect(unwrapRotateDelta(165, -170)).toBe(-195);
  });

  it('keeps counting across full turns (prev 350° → raw 10 means 370)', () => {
    expect(unwrapRotateDelta(10, 350)).toBe(370);
  });

  it('picks the representative CLOSEST to the previous delta, both directions', () => {
    expect(unwrapRotateDelta(179, -179)).toBe(-181);
    expect(unwrapRotateDelta(-179, 179)).toBe(181);
  });
});

describe('snapRotateDelta (#152)', () => {
  it('Shift snaps the DELTA to 45° increments from gesture start', () => {
    expect(snapRotateDelta(50, true)).toBe(45);
    expect(snapRotateDelta(-100, true)).toBe(-90);
    expect(snapRotateDelta(200, true)).toBe(180);
  });

  it('free rotation rounds the delta to 0.1°', () => {
    expect(snapRotateDelta(33.333, false)).toBe(33.3);
    expect(snapRotateDelta(-0.04, false)).toBe(-0);
  });
});
