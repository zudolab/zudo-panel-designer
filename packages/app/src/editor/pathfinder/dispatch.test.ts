// The ten-op dispatcher: the min-input table, the enabled-state gate, and that
// every op name actually routes to a real implementation.
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import {
  applyPathfinderOp,
  canApplyPathfinderOp,
  MIN_ELIGIBLE_INPUTS,
  PATHFINDER_OPS,
  shouldGroupResult,
} from './dispatch';
import { rectShape } from './test-fixtures';
import type { PathfinderOp } from './types';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
});

const back = () => rectShape('back', 0, 0, 100, 100, 0);
const front = () => rectShape('front', 50, 50, 100, 100, 2);

describe('the op table', () => {
  it('lists all ten ops exactly once', () => {
    expect(PATHFINDER_OPS).toHaveLength(10);
    expect(new Set(PATHFINDER_OPS).size).toBe(10);
    expect([...PATHFINDER_OPS].sort()).toEqual(
      (Object.keys(MIN_ELIGIBLE_INPUTS) as PathfinderOp[]).sort(),
    );
  });

  it('needs ≥1 input for divide and outline, ≥2 for the other eight', () => {
    const singles = PATHFINDER_OPS.filter((op) => MIN_ELIGIBLE_INPUTS[op] === 1);
    expect([...singles].sort()).toEqual(['divide', 'outline']);
    expect(PATHFINDER_OPS.filter((op) => MIN_ELIGIBLE_INPUTS[op] === 2)).toHaveLength(8);
  });

  it('canApplyPathfinderOp gates on that table', () => {
    expect(canApplyPathfinderOp('divide', 1)).toBe(true);
    expect(canApplyPathfinderOp('outline', 1)).toBe(true);
    expect(canApplyPathfinderOp('unite', 1)).toBe(false);
    expect(canApplyPathfinderOp('unite', 2)).toBe(true);
    for (const op of PATHFINDER_OPS) expect(canApplyPathfinderOp(op, 0)).toBe(false);
  });
});

describe('applyPathfinderOp', () => {
  it('routes every op to a real implementation and produces geometry', async () => {
    for (const op of PATHFINDER_OPS) {
      const result = await applyPathfinderOp(op, [back(), front()], engine);
      expect(result.specs.length).toBeGreaterThan(0);
      expect(result.target).toEqual({ role: 'copper', frontmostLeafId: 'front' });
    }
  });

  it('honours the min-input table for a one-leaf selection', async () => {
    for (const op of PATHFINDER_OPS) {
      const result = await applyPathfinderOp(op, [back()], engine);
      expect(result.specs.length > 0).toBe(MIN_ELIGIBLE_INPUTS[op] === 1);
    }
  });

  it('builds its own engine when none is injected', async () => {
    const result = await applyPathfinderOp('unite', [back(), front()]);
    expect(result.specs).toHaveLength(1);
  });
});

describe('shouldGroupResult', () => {
  it('is true only for a multi-piece result', async () => {
    expect(shouldGroupResult(await applyPathfinderOp('unite', [back(), front()], engine))).toBe(
      false,
    );
    expect(shouldGroupResult(await applyPathfinderOp('divide', [back(), front()], engine))).toBe(
      true,
    );
    expect(shouldGroupResult({ specs: [], target: null })).toBe(false);
  });
});
