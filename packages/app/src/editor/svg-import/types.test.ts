// types.ts is pure types (tsc already enforces the shape at compile time);
// these tests exist as living, executable examples of a valid value for
// each contract type, and pin the fill+stroke/closed-contour invariant
// documented on IrShape.
import { describe, expect, it } from 'vitest';
import type { IrContour, IrShape, SvgAnalysis, SvgImportDiagnostic, SvgViewport } from './types';

describe('svg-import types', () => {
  it('accepts a valid SvgImportDiagnostic', () => {
    const diag: SvgImportDiagnostic = { level: 'fatal', code: 'malformed-xml', message: 'bad xml' };
    expect(diag.level).toBe('fatal');
  });

  it('accepts a viewport preserving a non-zero origin', () => {
    const viewport: SvgViewport = { minX: -20, minY: 10, width: 100, height: 50 };
    expect(viewport).toEqual({ minX: -20, minY: 10, width: 100, height: 50 });
  });

  it('accepts an open contour on a stroke-only shape', () => {
    const contour: IrContour = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      closed: false,
    };
    const shape: IrShape = {
      name: 'stroke-only',
      contours: [contour],
      fillHex: null,
      strokeHex: '#000000',
      strokeWidth: 1,
    };
    expect(shape.fillHex).toBeNull();
    expect(shape.contours[0].closed).toBe(false);
  });

  it('keeps all contours closed on a shape with both fill and stroke', () => {
    const shape: IrShape = {
      name: 'filled-and-stroked',
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
          closed: true,
        },
      ],
      fillHex: '#ff0000',
      strokeHex: '#000000',
      strokeWidth: 2,
    };
    expect(shape.contours.every((c) => c.closed)).toBe(true);
  });

  it('accepts a fatal SvgAnalysis with no shapes', () => {
    const analysis: SvgAnalysis = {
      status: 'fatal',
      shapes: [],
      diagnostics: [{ level: 'fatal', code: 'no-viewport', message: 'no viewport' }],
      sourceColors: [],
      viewport: { minX: 0, minY: 0, width: 0, height: 0 },
    };
    expect(analysis.status).toBe('fatal');
    expect(analysis.shapes).toHaveLength(0);
  });

  it('accepts an ok SvgAnalysis carrying shapes and source colors', () => {
    const analysis: SvgAnalysis = {
      status: 'ok',
      shapes: [
        {
          name: 'a',
          contours: [{ points: [{ x: 0, y: 0 }], closed: true }],
          fillHex: '#123456',
          strokeHex: null,
          strokeWidth: 0,
        },
      ],
      diagnostics: [],
      sourceColors: ['#123456'],
      viewport: { minX: 0, minY: 0, width: 10, height: 10 },
    };
    expect(analysis.shapes).toHaveLength(1);
    expect(analysis.sourceColors).toEqual(['#123456']);
  });
});
