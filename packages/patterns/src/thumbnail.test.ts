import { describe, it, expect, afterEach } from 'vitest';
import { renderPatternThumb } from './thumbnail';
import { PATTERN_GENERATORS, patternByName } from './patterns';
import type { PanelPatternGenerator } from './types';
import { createMockCanvas } from './test-support/mock-canvas';

const glob = globalThis as { devicePixelRatio?: number };

function setDpr(value: number | undefined): void {
  if (value === undefined) delete glob.devicePixelRatio;
  else glob.devicePixelRatio = value;
}

afterEach(() => setDpr(undefined));

describe('renderPatternThumb', () => {
  it('sizes the backing store per devicePixelRatio while keeping the CSS box fixed', () => {
    const gen = patternByName('dot-grid') as PanelPatternGenerator;

    setDpr(2);
    const canvas = createMockCanvas();
    renderPatternThumb(canvas, gen, 40);
    expect(canvas.width).toBe(80);
    expect(canvas.height).toBe(80);
    expect(canvas.style.width).toBe('40px');
    expect(canvas.style.height).toBe('40px');
  });

  it('defaults to dpr 1 when devicePixelRatio is absent', () => {
    const gen = patternByName('dot-grid') as PanelPatternGenerator;
    setDpr(undefined);
    const canvas = createMockCanvas();
    renderPatternThumb(canvas, gen, 64);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
  });

  it('honours a fractional dpr (rounded backing store)', () => {
    const gen = patternByName('dot-grid') as PanelPatternGenerator;
    setDpr(1.5);
    const canvas = createMockCanvas();
    renderPatternThumb(canvas, gen, 33);
    expect(canvas.width).toBe(Math.round(33 * 1.5));
  });

  it('paints the black background and draws the pattern', () => {
    const gen = patternByName('dot-grid') as PanelPatternGenerator;
    setDpr(2);
    const canvas = createMockCanvas();
    renderPatternThumb(canvas, gen, 40);
    const ctx = canvas.ctx;
    expect(ctx).not.toBeNull();
    // scaled once, filled the 30mm background rect, then the generator drew
    expect(ctx?.calls.some((c) => c.method === 'scale')).toBe(true);
    expect(ctx?.calls.some((c) => c.method === 'fillRect')).toBe(true);
    expect((ctx?.calls.length ?? 0)).toBeGreaterThan(2);
  });

  it('no-ops safely when getContext returns null', () => {
    const gen = patternByName('dot-grid') as PanelPatternGenerator;
    const canvas = createMockCanvas({ nullCtx: true });
    expect(() => renderPatternThumb(canvas, gen, 40)).not.toThrow();
    expect(canvas.width).toBe(0); // guard returned before touching the canvas
  });

  it('renders a thumbnail for every registered pattern without throwing', () => {
    setDpr(2);
    for (const gen of PATTERN_GENERATORS) {
      const canvas = createMockCanvas();
      expect(() => renderPatternThumb(canvas, gen, 48)).not.toThrow();
      expect(canvas.width).toBe(96);
    }
  });
});
