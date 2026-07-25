/**
 * The recording proxy: style capture, the ceilings, and the refusal to model a
 * canvas member it does not understand.
 */

import { describe, expect, it } from 'vitest';
import { ringSignedArea } from '../geometry-kernel';
import { subpathFillRing } from './canvas-path';
import {
  createRecordingContext,
  PatternComplexityError,
  PatternRecorder,
  UnsupportedCanvasMemberError,
} from './pattern-recorder';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const LIMITS = { maxRings: 20_000, maxSegments: 2_000_000 };

function recorder(limits = LIMITS): PatternRecorder {
  return new PatternRecorder(DEFAULT_IR_TOLERANCE.arcMm, limits);
}

describe('style is captured at paint time, not at assignment time', () => {
  it('records the width in force when stroke() ran, not the latest one', () => {
    const r = recorder();
    r.lineWidth = 2;
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.stroke();
    r.lineWidth = 9; // after the paint — must not reach back
    r.stroke();

    const widths = r.ops.map((op) => (op.kind === 'stroke' ? op.style.width : null));
    expect(widths).toEqual([2, 9]);
  });

  it('records cap and join per paint', () => {
    const r = recorder();
    r.lineCap = 'round';
    r.lineJoin = 'bevel';
    r.miterLimit = 3;
    r.moveTo(0, 0);
    r.lineTo(1, 1);
    r.stroke();
    const [op] = r.ops;
    expect(op.kind).toBe('stroke');
    if (op.kind !== 'stroke') return;
    expect(op.style).toEqual({ width: 1, cap: 'round', join: 'bevel', miterLimit: 3 });
  });
});

describe('Canvas ignores out-of-range style assignments — so does the recorder', () => {
  it('keeps the previous lineWidth when handed 0, a negative, or NaN', () => {
    // Not pedantry: clamping to 0 instead would silently drop a stroke the
    // editor still paints at the previous width.
    const r = recorder();
    r.lineWidth = 2.5;
    r.lineWidth = 0;
    r.lineWidth = -1;
    r.lineWidth = Number.NaN;
    expect(r.lineWidth).toBe(2.5);
  });

  it('keeps the previous cap/join/miterLimit when handed a bad value', () => {
    const r = recorder();
    r.lineCap = 'round';
    r.lineCap = 'triangle' as never;
    r.lineJoin = 'invalid' as never;
    r.miterLimit = 0;
    expect(r.lineCap).toBe('round');
    expect(r.lineJoin).toBe('miter');
    expect(r.miterLimit).toBe(10);
  });
});

describe('the current path persists across paints', () => {
  it('fills and then strokes the SAME path without beginPath', () => {
    const r = recorder();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.lineTo(10, 10);
    r.fill();
    r.stroke();
    expect(r.ops.map((o) => o.kind)).toEqual(['fill', 'stroke']);
    expect(r.ops[0].subpaths[0].contour).toHaveLength(2);
    expect(r.ops[1].subpaths[0].contour).toHaveLength(2);
  });

  it('beginPath is the only thing that clears it', () => {
    const r = recorder();
    r.moveTo(0, 0);
    r.lineTo(10, 0);
    r.beginPath();
    r.fill();
    expect(r.ops).toHaveLength(0);
  });

  it('defaults fill() to NONZERO — the Canvas default, not zpd layers evenodd', () => {
    const r = recorder();
    r.rect(0, 0, 10, 10);
    r.fill();
    r.fill('evenodd');
    expect(r.ops.map((o) => (o.kind === 'fill' ? o.rule : null))).toEqual(['nonzero', 'evenodd']);
  });
});

describe('fillRect / strokeRect are path-independent', () => {
  it('fillRect neither reads nor disturbs the current path', () => {
    const r = recorder();
    r.moveTo(0, 0);
    r.lineTo(5, 0);
    r.lineTo(5, 5);
    r.fillRect(20, 20, 4, 4);
    r.fill();

    expect(r.ops).toHaveLength(2);
    const rect = subpathFillRing(r.ops[0].subpaths[0]);
    expect(Math.abs(ringSignedArea(rect))).toBeCloseTo(16, 9);
    // The triangle is intact: fillRect did not join it or clear it.
    expect(Math.abs(ringSignedArea(subpathFillRing(r.ops[1].subpaths[0])))).toBeCloseTo(12.5, 9);
  });

  it('paints nothing for a fillRect with a zero dimension', () => {
    const r = recorder();
    r.fillRect(0, 0, 10, 0);
    r.fillRect(0, 0, 0, 10);
    expect(r.ops).toHaveLength(0);
  });

  it('strokeRect degenerates to a line, and to a point, exactly as Canvas does', () => {
    const r = recorder();
    r.strokeRect(0, 0, 10, 0);
    r.strokeRect(5, 5, 0, 0);
    expect(r.ops).toHaveLength(2);
    expect(r.ops[0].subpaths[0].closed).toBe(false);
    expect(r.ops[0].subpaths[0].contour).toHaveLength(1);
    expect(r.ops[1].subpaths[0].contour[0].p0).toEqual({ x: 5, y: 5 });
  });
});

describe('Decision 8 ceilings abort the generator mid-draw', () => {
  it('throws once the ring ceiling is passed, without waiting for the draw to end', () => {
    const r = recorder({ maxRings: 3, maxSegments: 1_000_000 });
    expect(() => {
      for (let i = 0; i < 100; i++) r.fillRect(i, 0, 1, 1);
    }).toThrow(PatternComplexityError);
    expect(r.counts.rings).toBe(4);
  });

  it('throws on the segment ceiling too — a generator may never reach a paint call', () => {
    const r = recorder({ maxRings: 20_000, maxSegments: 10 });
    expect(() => {
      r.moveTo(0, 0);
      for (let i = 0; i < 1000; i++) r.lineTo(i, i);
    }).toThrow(PatternComplexityError);
  });
});

describe('the proxy refuses a canvas member it does not model', () => {
  it('throws on an unknown property read', () => {
    const ctx = createRecordingContext(recorder()) as unknown as Record<string, unknown>;
    expect(() => ctx.globalCompositeOperation).toThrow(UnsupportedCanvasMemberError);
  });

  it('throws on an unknown property WRITE — the silent-failure case', () => {
    // `ctx.globalAlpha = 0.5` on a plain stub would be recorded nowhere and
    // change nothing, and the export would quietly disagree with the screen.
    const ctx = createRecordingContext(recorder()) as unknown as Record<string, unknown>;
    expect(() => {
      ctx.globalAlpha = 0.5;
    }).toThrow(UnsupportedCanvasMemberError);
  });

  it('still lets the modelled 17 members through, methods included', () => {
    const r = recorder();
    const ctx = createRecordingContext(r);
    ctx.fillStyle = '#abcdef';
    ctx.lineWidth = 3;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 0);
    ctx.closePath();
    ctx.stroke();
    expect(r.fillStyle).toBe('#abcdef');
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].kind === 'stroke' && r.ops[0].style.width).toBe(3);
  });
});
