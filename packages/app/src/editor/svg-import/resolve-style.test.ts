// @vitest-environment jsdom
//
// resolveStyle reads presentation attributes off real Elements, so this file
// runs under jsdom (same per-file pragma convention as
// parse-svg-document.test.ts).
import { describe, expect, it } from 'vitest';
import { DiagnosticSink, SvgFatalError } from './diagnostics';
import {
  INITIAL_STYLE,
  parseColorValue,
  resolvePaint,
  resolveStyle,
  type StyleState,
} from './resolve-style';
import type { SvgImportDiagnostic } from './types';

function element(markup: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement.children[0];
}

function resolve(markup: string, parent: StyleState = INITIAL_STYLE) {
  const diagnostics: SvgImportDiagnostic[] = [];
  const style = resolveStyle(element(markup), parent, new DiagnosticSink(diagnostics));
  return { style, diagnostics };
}

describe('resolveStyle -- cascade', () => {
  it('defaults fill to black and stroke to none', () => {
    expect(INITIAL_STYLE.fill).toBe('black');
    expect(INITIAL_STYLE.stroke).toBe('none');
  });

  it('reads presentation attributes', () => {
    expect(resolve('<path fill="red" stroke-width="3"/>').style).toMatchObject({
      fill: 'red',
      strokeWidth: '3',
    });
  });

  it('lets an inline style declaration beat the presentation attribute', () => {
    expect(resolve('<path fill="red" style="fill: blue"/>').style.fill).toBe('blue');
  });

  it('strips !important from a declaration value', () => {
    expect(resolve('<path style="fill: blue !important"/>').style.fill).toBe('blue');
  });

  it('inherits from the parent state', () => {
    const parent = resolve('<g fill="green" color="orange"/>').style;
    expect(resolve('<path/>', parent).style).toMatchObject({ fill: 'green', color: 'orange' });
  });

  it('keeps the inherited value for an explicit "inherit"', () => {
    const parent = resolve('<g fill="green"/>').style;
    expect(resolve('<path fill="inherit"/>', parent).style.fill).toBe('green');
  });

  it('multiplies group opacity down the tree', () => {
    const parent = resolve('<g opacity="0.5"/>').style;
    expect(resolve('<path opacity="0.5"/>', parent).style.opacity).toBeCloseTo(0.25, 9);
  });

  it('lets style opacity override the attribute rather than multiply with it', () => {
    expect(resolve('<path opacity="0.5" style="opacity:0.2"/>').style.opacity).toBeCloseTo(0.2, 9);
  });

  it('warns once for an unsupported style declaration', () => {
    const { diagnostics } = resolve('<path style="paint-order:stroke;paint-order:stroke"/>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'warning', code: 'style-ignored' });
  });

  it('does not warn about display, which the safety gate already handled', () => {
    expect(resolve('<path style="display:inline"/>').diagnostics).toEqual([]);
  });

  it('is fatal for a non-numeric opacity', () => {
    expect(() => resolve('<path opacity="wat"/>')).toThrow(SvgFatalError);
  });
});

describe('parseColorValue -- locked grammar', () => {
  it.each([
    ['#f00', '#ff0000', 1],
    ['#F00', '#ff0000', 1],
    ['#ff0000', '#ff0000', 1],
    ['#00ff0080', '#00ff00', 128 / 255],
    ['#0f08', '#00ff00', 136 / 255],
    ['rgb(255, 0, 0)', '#ff0000', 1],
    ['rgb(255 0 0)', '#ff0000', 1],
    ['rgba(255, 0, 0, 0.5)', '#ff0000', 0.5],
    ['rgb(255 0 0 / 50%)', '#ff0000', 0.5],
    ['rgb(100%, 0%, 0%)', '#ff0000', 1],
    ['hsl(0, 100%, 50%)', '#ff0000', 1],
    ['hsl(120 100% 50%)', '#00ff00', 1],
    ['hsla(240, 100%, 50%, 0.25)', '#0000ff', 0.25],
    ['tomato', '#ff6347', 1],
    ['TOMATO', '#ff6347', 1],
    ['transparent', '#000000', 0],
  ])('parses %s', (raw, hex, alpha) => {
    const parsed = parseColorValue(raw);
    expect(parsed.kind).toBe('color');
    if (parsed.kind !== 'color') return;
    expect(parsed.hex).toBe(hex);
    expect(parsed.alpha).toBeCloseTo(alpha, 6);
  });

  it('recognizes none', () => {
    expect(parseColorValue('none').kind).toBe('none');
  });

  it('recognizes currentColor', () => {
    expect(parseColorValue('currentColor').kind).toBe('current');
  });

  it.each([
    'url(#grad)',
    'color-mix(in oklab, red, blue)',
    '#ff',
    '#ff000',
    'rgb(1,2)',
    'nosuchcolor',
  ])('rejects %s', (raw) => {
    expect(parseColorValue(raw).kind).toBe('invalid');
  });
});

describe('resolvePaint', () => {
  const paint = (value: string, style: StyleState = INITIAL_STYLE, opacity = '1') =>
    resolvePaint(value, style, opacity, 'fill-opacity');

  it('returns null for none', () => {
    expect(paint('none')).toBeNull();
  });

  it('resolves currentColor against the inherited color', () => {
    const style = { ...INITIAL_STYLE, color: 'rebeccapurple' };
    expect(paint('currentColor', style)).toEqual({ hex: '#663399', alpha: 1 });
  });

  it('falls back to black when currentColor has no usable color', () => {
    const style = { ...INITIAL_STYLE, color: 'none' };
    expect(paint('currentColor', style)).toEqual({ hex: '#000000', alpha: 1 });
  });

  it('multiplies color alpha, paint opacity and element opacity', () => {
    const style = { ...INITIAL_STYLE, opacity: 0.5 };
    const resolved = paint('rgba(255,0,0,0.5)', style, '0.5');
    expect(resolved?.hex).toBe('#ff0000');
    expect(resolved?.alpha).toBeCloseTo(0.125, 9);
  });

  it('reports alpha 0 for a fully transparent color', () => {
    expect(paint('rgba(255,0,0,0)')?.alpha).toBe(0);
  });

  it('is fatal for an unsupported color', () => {
    expect(() => paint('chartreuse-ish')).toThrow(SvgFatalError);
  });
});
