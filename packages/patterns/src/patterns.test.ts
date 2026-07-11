import { describe, it, expect } from 'vitest';
import { PATTERN_GENERATORS, patternByName, defaultParams } from './patterns';
import type { PanelPatternGenerator } from './types';
import { createMockCtx } from './test-support/mock-canvas';

// Realistic Eurorack-ish panel sizes where every pattern must draw something.
const PANEL_SIZES: [number, number][] = [
  [30, 30],
  [128.5, 42.4], // odd non-square panel to shake out centering/overscan math
];

// Degenerate/extreme panels: patterns must not throw, but may legitimately draw
// nothing (e.g. a ring pitch larger than a 3mm panel's radius).
const DEGENERATE_PANEL_SIZES: [number, number][] = [
  [3, 3],
  [300, 4],
  [1, 60],
];

function countCalls(ctx: ReturnType<typeof createMockCtx>, method: string): number {
  return ctx.calls.filter((c) => c.method === method).length;
}

describe('registry', () => {
  it('ships around a dozen patterns with unique stable names', () => {
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
  // Draw on realistic panels: must not throw AND must actually emit draw calls.
  const drawAll = (gen: PanelPatternGenerator, params: Record<string, number>) => {
    for (const [w, h] of PANEL_SIZES) {
      const ctx = createMockCtx();
      expect(() =>
        gen.draw(ctx, { widthMm: w, heightMm: h, color: '#d4af37', params }),
      ).not.toThrow();
      expect(ctx.calls.length).toBeGreaterThan(0); // it actually drew something
    }
  };

  // Draw on degenerate panels: robustness only — no-throw, may draw nothing.
  const drawAllNoThrow = (gen: PanelPatternGenerator, params: Record<string, number>) => {
    for (const [w, h] of DEGENERATE_PANEL_SIZES) {
      const ctx = createMockCtx();
      expect(() =>
        gen.draw(ctx, { widthMm: w, heightMm: h, color: '#d4af37', params }),
      ).not.toThrow();
    }
  };

  it('draws every pattern at default params without throwing', () => {
    for (const gen of PATTERN_GENERATORS) {
      drawAll(gen, defaultParams(gen.name));
    }
  });

  it('draws every pattern at each param extreme (min and max) without throwing', () => {
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
  });

  it('tolerates missing, empty, and out-of-range params without throwing', () => {
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
  });
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
