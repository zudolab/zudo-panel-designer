import { describe, it, expect } from 'vitest';
import { PATTERN_GENERATORS, patternByName, defaultParams } from './patterns';
import type { PanelPatternGenerator } from './types';
import { createMockCtx } from './test-support/mock-canvas';

// Realistic panel sizes where every pattern must draw something. Real panels
// are width x fixed 128.5mm height (see packages/core/src/panel-sizes.ts) —
// [30, 30] is kept alongside as the thumbnail preview window, which is square.
const PANEL_SIZES: [number, number][] = [
  [30, 30],
  [5, 128.5], // narrowest real panel (1HP)
  [40.3, 128.5], // mid-width real panel (8HP)
  [101.3, 128.5], // widest real panel (20HP)
];

// Degenerate/extreme panels: patterns must not throw, but may legitimately draw
// nothing (e.g. a ring pitch larger than a 3mm panel's radius).
const DEGENERATE_PANEL_SIZES: [number, number][] = [
  [3, 3],
  [300, 4],
  [1, 60],
];

const PAINT_METHODS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect']);

// Generous per-draw primitive budget to catch an accidental exponential/fractal
// blowup (real draws land in the hundreds to low thousands of calls).
const MAX_CALLS_PER_DRAW = 200_000;

// Extreme scans are comfortably over Vitest's 5s default under load.
const EXTREME_DRAW_TIMEOUT_MS = 20_000;

// This matrix performs two complete draws for every generator/parameter/panel
// case. It runs in ~12s alone but shares CPU with the full suite in CI.
const DETERMINISM_TIMEOUT_MS = 60_000;

function countCalls(ctx: ReturnType<typeof createMockCtx>, method: string): number {
  return ctx.calls.filter((c) => c.method === method).length;
}

// "Actually drew something" means an actual paint op (fill/stroke/fillRect/
// strokeRect), not just any recorded call — a beginPath()-then-skip would
// otherwise pass a plain "any call" check without painting a single pixel.
function countPaintOps(ctx: ReturnType<typeof createMockCtx>): number {
  return ctx.calls.filter((c) => PAINT_METHODS.has(c.method)).length;
}

function containsNonFiniteNumber(value: unknown, visitedArrays: WeakSet<unknown[]>): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  if (visitedArrays.has(value)) return false;
  visitedArrays.add(value);
  return value.some((item) => containsNonFiniteNumber(item, visitedArrays));
}

// Every generator's draw loops are guarded by resolveParam's clamp (see
// param-utils.ts), so no recorded call should ever carry a NaN/±Infinity
// coordinate even when fed garbage params — a non-finite arg reaching the
// canvas is a silent no-op at best and a real bug at worst.
function assertNoNonFiniteArgs(ctx: ReturnType<typeof createMockCtx>): void {
  // Plain scan, then a SINGLE expect per draw. A per-arg expect() costs ~8µs
  // each in vitest; multiplied by every registered pattern × panel size × param
  // extreme it dominates wall-clock and blows the 20s per-test budget as the
  // registry grows (the pgen port program adds dozens of generators). The check
  // is identical in meaning — it fails iff any recorded numeric arg is
  // non-finite — just O(calls) cheap instead of O(args) of expect() overhead.
  const visitedArrays = new WeakSet<unknown[]>();
  const offender = ctx.calls.find((call) =>
    call.args.some((arg) => containsNonFiniteNumber(arg, visitedArrays)),
  );
  expect(
    offender === undefined,
    offender && `non-finite numeric arg in ${offender.method}`,
  ).toBe(true);
}

function assertWithinCallBudget(ctx: ReturnType<typeof createMockCtx>): void {
  expect(ctx.calls.length).toBeLessThan(MAX_CALLS_PER_DRAW);
}

describe('non-finite canvas arg guard', () => {
  it('rejects a non-finite numeric leaf inside an array argument', () => {
    const ctx = createMockCtx();
    ctx.setLineDash([Number.NaN]);

    expect(() => assertNoNonFiniteArgs(ctx)).toThrowError(
      /non-finite numeric arg in setLineDash/,
    );
  });

  it('traverses cyclic arrays safely and continues checking their other leaves', () => {
    const ctx = createMockCtx();
    const cyclic: unknown[] = [];
    cyclic.push(cyclic, [Number.POSITIVE_INFINITY]);
    ctx.calls.push({ method: 'setLineDash', args: [cyclic] });

    expect(() => assertNoNonFiniteArgs(ctx)).toThrowError(
      /non-finite numeric arg in setLineDash/,
    );

    cyclic.splice(1);
    expect(() => assertNoNonFiniteArgs(ctx)).not.toThrow();
  });
});

describe('registry', () => {
  it('ships a registry of patterns with unique stable names', () => {
    expect(PATTERN_GENERATORS.length).toBeGreaterThanOrEqual(10);
    const names = PATTERN_GENERATORS.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes 'dot-grid' as the referenced default", () => {
    expect(PATTERN_GENERATORS.some((g) => g.name === 'dot-grid')).toBe(true);
    expect(patternByName('dot-grid')?.name).toBe('dot-grid');
  });

  it('gives every generator a displayName and at least one param def', () => {
    for (const gen of PATTERN_GENERATORS) {
      expect(gen.displayName.length).toBeGreaterThan(0);
      expect(gen.paramDefs.length).toBeGreaterThan(0);
      for (const def of gen.paramDefs) {
        expect(def.min).toBeLessThanOrEqual(def.defaultValue);
        expect(def.defaultValue).toBeLessThanOrEqual(def.max);
        expect(def.step).toBeGreaterThan(0);
      }
    }
  });
});

describe('patternByName', () => {
  it('returns the matching generator', () => {
    for (const gen of PATTERN_GENERATORS) {
      expect(patternByName(gen.name)).toBe(gen);
    }
  });

  it('returns undefined for an unknown name (safe fallback)', () => {
    expect(patternByName('does-not-exist')).toBeUndefined();
    expect(patternByName('')).toBeUndefined();
  });
});

describe('defaultParams', () => {
  it('maps each paramDef to its defaultValue', () => {
    for (const gen of PATTERN_GENERATORS) {
      const params = defaultParams(gen.name);
      expect(Object.keys(params).sort()).toEqual(gen.paramDefs.map((d) => d.key).sort());
      for (const def of gen.paramDefs) {
        expect(params[def.key]).toBe(def.defaultValue);
      }
    }
  });

  it('returns {} for an unknown name (safe fallback)', () => {
    expect(defaultParams('does-not-exist')).toEqual({});
  });
});

describe('draw', () => {
  // Draw on realistic panels: must not throw, must actually paint something,
  // and every recorded call must be finite and within the primitive budget.
  const drawAll = (gen: PanelPatternGenerator, params: Record<string, number>) => {
    for (const [w, h] of PANEL_SIZES) {
      const ctx = createMockCtx();
      expect(() =>
        gen.draw(ctx, { widthMm: w, heightMm: h, color: '#d4af37', params }),
      ).not.toThrow();
      expect(countPaintOps(ctx)).toBeGreaterThan(0); // it actually painted something
      assertNoNonFiniteArgs(ctx);
      assertWithinCallBudget(ctx);
    }
  };

  // Draw on degenerate panels: robustness only — no-throw, may draw nothing,
  // but whatever is recorded must still be finite and within budget.
  const drawAllNoThrow = (gen: PanelPatternGenerator, params: Record<string, number>) => {
    for (const [w, h] of DEGENERATE_PANEL_SIZES) {
      const ctx = createMockCtx();
      expect(() =>
        gen.draw(ctx, { widthMm: w, heightMm: h, color: '#d4af37', params }),
      ).not.toThrow();
      assertNoNonFiniteArgs(ctx);
      assertWithinCallBudget(ctx);
    }
  };

  it('draws every pattern at default params without throwing', () => {
    for (const gen of PATTERN_GENERATORS) {
      drawAll(gen, defaultParams(gen.name));
    }
  });

  it(
    'draws every pattern at each param extreme (min and max) without throwing',
    () => {
      for (const gen of PATTERN_GENERATORS) {
        for (const target of gen.paramDefs) {
          for (const extreme of [target.min, target.max]) {
            const params = defaultParams(gen.name);
            params[target.key] = extreme;
            drawAll(gen, params);
            drawAllNoThrow(gen, params);
          }
        }
      }
    },
    EXTREME_DRAW_TIMEOUT_MS,
  );

  it(
    'tolerates missing, empty, and out-of-range params without throwing',
    () => {
      const cases: Record<string, number>[] = [];
      for (const gen of PATTERN_GENERATORS) {
        cases.length = 0;
        cases.push({}); // empty → all defaults
        // garbage: negatives, NaN, and absurdly large values for every key
        const kinds = [-9999, Number.NaN, 1e6, Number.POSITIVE_INFINITY];
        for (const v of kinds) {
          const params: Record<string, number> = {};
          for (const def of gen.paramDefs) params[def.key] = v;
          cases.push(params);
        }
        for (const params of cases) {
          drawAll(gen, params);
          drawAllNoThrow(gen, params);
        }
      }
    },
    EXTREME_DRAW_TIMEOUT_MS,
  );
});

describe('determinism', () => {
  it(
    'draws identical call logs at defaults and one-parameter-at-a-time extremes',
    () => {
      for (const gen of PATTERN_GENERATORS) {
        const paramCases: { label: string; params: Record<string, number> }[] = [
          { label: 'defaults', params: defaultParams(gen.name) },
        ];
        for (const target of gen.paramDefs) {
          for (const [extremeName, extreme] of [
            ['min', target.min],
            ['max', target.max],
          ] as const) {
            paramCases.push({
              label: `${target.key}=${extremeName}`,
              params: { ...defaultParams(gen.name), [target.key]: extreme },
            });
          }
        }

        for (const { label, params } of paramCases) {
          for (const [w, h] of [...PANEL_SIZES, ...DEGENERATE_PANEL_SIZES]) {
            const opts = { widthMm: w, heightMm: h, color: '#d4af37' };
            const first = createMockCtx();
            gen.draw(first, { ...opts, params: { ...params } });
            const second = createMockCtx();
            gen.draw(second, { ...opts, params: { ...params } });
            expect(second.calls, `${gen.name} ${label} at ${w}x${h}`).toEqual(first.calls);
          }
        }
      }
    },
    DETERMINISM_TIMEOUT_MS,
  );
});

describe('param clamping', () => {
  // Clamping is observable: a below-min pitch must be raised to the def min, so
  // the number of dots drawn matches the min-pitch case exactly (and the loop
  // stays finite — an unclamped negative pitch would never terminate).
  it('clamps a below-min value up to the def minimum', () => {
    const dotGrid = patternByName('dot-grid') as PanelPatternGenerator;
    const opts = { widthMm: 40, heightMm: 40, color: '#fff' };

    const atMin = createMockCtx();
    dotGrid.draw(atMin, { ...opts, params: { pitch: 2, radius: 1 } });

    const belowMin = createMockCtx();
    dotGrid.draw(belowMin, { ...opts, params: { pitch: -100, radius: 1 } });

    expect(countCalls(belowMin, 'arc')).toBe(countCalls(atMin, 'arc'));
    expect(countCalls(atMin, 'arc')).toBeGreaterThan(0);
  });

  it('clamps an above-max value down to the def maximum', () => {
    const dotGrid = patternByName('dot-grid') as PanelPatternGenerator;
    const opts = { widthMm: 40, heightMm: 40, color: '#fff' };

    const atMax = createMockCtx();
    dotGrid.draw(atMax, { ...opts, params: { pitch: 15, radius: 1 } });

    const aboveMax = createMockCtx();
    dotGrid.draw(aboveMax, { ...opts, params: { pitch: 500, radius: 1 } });

    expect(countCalls(aboveMax, 'arc')).toBe(countCalls(atMax, 'arc'));
  });
});
