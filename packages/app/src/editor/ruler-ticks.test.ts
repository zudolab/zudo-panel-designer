import { describe, expect, it } from 'vitest';
import { formatTickLabel, getRulerTicksMm, pickTickStepMm } from './ruler-ticks';

const SEQ_125 = [1, 2, 5];

// Every 1-2-5 x 10^n candidate in a generous range, ascending — used to
// verify pickTickStepMm returns the MINIMAL qualifying step.
function candidates125(): number[] {
  const out: number[] = [];
  for (let exp = -4; exp <= 5; exp++) {
    for (const m of SEQ_125) out.push(m * 10 ** exp);
  }
  return out;
}

describe('pickTickStepMm', () => {
  it('picks 100mm majors at minimum zoom (0.5 px/mm)', () => {
    const { major, minor } = pickTickStepMm(0.5);
    expect(major).toBe(100);
    expect(minor).toBe(20);
  });

  it('picks 0.5mm majors exactly at maximum zoom (100 px/mm)', () => {
    const { major, minor } = pickTickStepMm(100);
    expect(major).toBe(0.5);
    expect(minor).toBe(0.1);
  });

  it('returns steps from the 1-2-5 sequence with minor = major / 5', () => {
    for (const pxPerMm of [0.5, 0.7, 1, 2.3, 4, 8.5, 13, 27, 50, 77, 100]) {
      const { major, minor } = pickTickStepMm(pxPerMm);
      const exp = Math.floor(Math.log10(major) + 1e-9);
      const mantissa = major / 10 ** exp;
      expect(SEQ_125.some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true);
      expect(minor).toBeCloseTo(major / 5, 12);
    }
  });

  it('returns the minimal step meeting targetPx across the zoom range', () => {
    const all = candidates125();
    for (const pxPerMm of [0.5, 0.9, 1, 3.7, 10, 33, 64, 100]) {
      const { major } = pickTickStepMm(pxPerMm);
      expect(major * pxPerMm).toBeGreaterThanOrEqual(50);
      const smaller = all.filter((c) => c < major - 1e-12);
      for (const c of smaller) {
        expect(c * pxPerMm).toBeLessThan(50);
      }
    }
  });

  it('major label spacing never drops below ~40 css px anywhere in the zoom clamp', () => {
    for (let pxPerMm = 0.5; pxPerMm <= 100; pxPerMm *= 1.13) {
      const { major } = pickTickStepMm(pxPerMm);
      expect(major * pxPerMm).toBeGreaterThanOrEqual(40);
    }
  });

  it('honors a custom targetPx', () => {
    // threshold = 80/4 = 20mm -> first qualifying step is 20
    expect(pickTickStepMm(4, 80).major).toBe(20);
  });
});

describe('getRulerTicksMm', () => {
  it('places the mm=0 tick exactly at the camera offset (origin pinning)', () => {
    // offsets chosen inside [0, lengthPx] so the origin tick is on-screen
    const cases = [
      { pxPerMm: 4, offset: 123.456 },
      { pxPerMm: 0.5, offset: 872.5 },
      { pxPerMm: 100, offset: 512 },
      { pxPerMm: 13.7, offset: 0 },
    ];
    for (const { pxPerMm, offset } of cases) {
      const step = pickTickStepMm(pxPerMm);
      const ticks = getRulerTicksMm(pxPerMm, offset, 1000, step);
      const origin = ticks.find((t) => t.mm === 0);
      expect(origin).toBeDefined();
      expect(origin!.cssPx).toBe(offset); // exact, not approximate
      expect(origin!.isMajor).toBe(true);
    }
  });

  it('covers the strip with at most one minor tick of overscan per end', () => {
    for (const { pxPerMm, offset, length } of [
      { pxPerMm: 4, offset: 100, length: 800 },
      { pxPerMm: 0.5, offset: -200, length: 500 },
      { pxPerMm: 100, offset: 350, length: 1200 },
    ]) {
      const step = pickTickStepMm(pxPerMm);
      const ticks = getRulerTicksMm(pxPerMm, offset, length, step);
      const minorPx = step.minor * pxPerMm;
      const first = ticks[0].cssPx;
      const last = ticks[ticks.length - 1].cssPx;
      // reaches past both ends...
      expect(first).toBeLessThanOrEqual(0);
      expect(last).toBeGreaterThanOrEqual(length);
      // ...but never more than ~2 minors beyond (snap-down + 1 overscan)
      expect(first).toBeGreaterThanOrEqual(-2 * minorPx - 1e-6);
      expect(last).toBeLessThanOrEqual(length + 2 * minorPx + 1e-6);
    }
  });

  it('returns ticks sorted by cssPx with uniform minor spacing', () => {
    const step = pickTickStepMm(4);
    const ticks = getRulerTicksMm(4, 60, 600, step);
    const minorPx = step.minor * 4;
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].cssPx).toBeGreaterThan(ticks[i - 1].cssPx);
      expect(ticks[i].cssPx - ticks[i - 1].cssPx).toBeCloseTo(minorPx, 6);
    }
  });

  it('classifies every 5th tick as major, including negative mm', () => {
    const step = pickTickStepMm(4); // major 20, minor 4
    const ticks = getRulerTicksMm(4, 400, 800, step); // visible mm ~ -100..100
    expect(ticks.some((t) => t.mm < 0)).toBe(true);
    for (const t of ticks) {
      const ratio = t.mm / step.major;
      const isOnMajor = Math.abs(ratio - Math.round(ratio)) < 1e-9;
      expect(t.isMajor).toBe(isOnMajor);
    }
    const majors = ticks.filter((t) => t.isMajor);
    expect(majors.map((t) => t.mm)).toContain(-20);
    expect(majors.map((t) => t.mm)).toContain(0);
    expect(majors.map((t) => t.mm)).toContain(20);
  });

  it('classifies sub-mm majors float-tolerantly at deep zoom', () => {
    const step = pickTickStepMm(100); // major 0.5, minor 0.1
    const ticks = getRulerTicksMm(100, 37, 900, step);
    const majors = ticks.filter((t) => t.isMajor);
    expect(majors.length).toBeGreaterThan(0);
    for (const t of majors) {
      const ratio = t.mm / 0.5;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-9);
    }
    // consecutive majors are exactly one major step apart in mm
    for (let i = 1; i < majors.length; i++) {
      expect(majors[i].mm - majors[i - 1].mm).toBeCloseTo(0.5, 9);
    }
  });

  it('returns [] for degenerate inputs', () => {
    const step = pickTickStepMm(4);
    expect(getRulerTicksMm(4, 0, 0, step)).toEqual([]);
    expect(getRulerTicksMm(0, 0, 100, step)).toEqual([]);
  });
});

describe('formatTickLabel', () => {
  it('formats integers when the major step is >= 1mm', () => {
    expect(formatTickLabel(20, 20)).toBe('20');
    expect(formatTickLabel(-40, 20)).toBe('-40');
    expect(formatTickLabel(0, 1)).toBe('0');
  });

  it('formats one decimal for sub-mm steps', () => {
    expect(formatTickLabel(0.5, 0.5)).toBe('0.5');
    expect(formatTickLabel(-1.5, 0.5)).toBe('-1.5');
    expect(formatTickLabel(2, 0.5)).toBe('2.0');
  });
});
