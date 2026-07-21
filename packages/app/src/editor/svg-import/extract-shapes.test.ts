// @vitest-environment jsdom
//
// Driven end-to-end through analyzeSvg (parse + extract) so the fixtures read
// as the SVG a user would actually import; DOMParser needs jsdom, hence the
// per-file pragma used across this package.
import { describe, expect, it } from 'vitest';
import { analyzeSvg } from './analyze-svg';
import type { IrShape, SvgAnalysis } from './types';

function svg(inner: string, rootAttrs = 'viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${inner}</svg>`;
}

function analyze(inner: string, rootAttrs?: string): SvgAnalysis {
  return analyzeSvg(svg(inner, rootAttrs));
}

function shapesOf(inner: string, rootAttrs?: string): IrShape[] {
  const result = analyze(inner, rootAttrs);
  expect(result.status).toBe('ok');
  return result.shapes;
}

function onlyShape(inner: string, rootAttrs?: string): IrShape {
  const shapes = shapesOf(inner, rootAttrs);
  expect(shapes).toHaveLength(1);
  return shapes[0];
}

function expectFatal(inner: string, code: string, rootAttrs?: string): void {
  const result = analyze(inner, rootAttrs);
  expect(result.status).toBe('fatal');
  expect(result.diagnostics.some((d) => d.level === 'fatal' && d.code === code)).toBe(true);
  expect(result.shapes).toEqual([]);
}

function codes(result: SvgAnalysis): string[] {
  return result.diagnostics.map((d) => d.code);
}

const TRIANGLE_OPEN = 'M0 0 L10 0 L10 10';
const TRIANGLE_CLOSED = 'M0 0 L10 0 L10 10 Z';

describe('extractShapes -- style cascade', () => {
  it('fills a bare path black by default', () => {
    expect(onlyShape(`<path d="${TRIANGLE_CLOSED}"/>`)).toMatchObject({
      fillHex: '#000000',
      strokeHex: null,
      strokeWidth: 0,
    });
  });

  it('resolves currentColor against an ancestor color', () => {
    const shape = onlyShape(
      `<g color="#123456"><path d="${TRIANGLE_CLOSED}" fill="currentColor"/></g>`,
    );
    expect(shape.fillHex).toBe('#123456');
  });

  it('lets an inline style beat the presentation attribute', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" fill="red" style="fill:#00ff00"/>`);
    expect(shape.fillHex).toBe('#00ff00');
  });

  it('inherits fill from an ancestor group', () => {
    expect(onlyShape(`<g fill="blue"><path d="${TRIANGLE_CLOSED}"/></g>`).fillHex).toBe('#0000ff');
  });

  it('skips a visibility:hidden subtree with a warning', () => {
    const result = analyze(`<g style="visibility:hidden"><path d="${TRIANGLE_CLOSED}"/></g>`);
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('invisible-content-skipped');
  });

  it('does not let a descendant re-show a hidden subtree', () => {
    const result = analyze(
      `<g visibility="hidden"><path d="${TRIANGLE_CLOSED}" visibility="visible"/></g>`,
    );
    expect(result.shapes).toEqual([]);
  });

  it('skips an opacity="0" subtree with a warning', () => {
    const result = analyze(`<g opacity="0"><path d="${TRIANGLE_CLOSED}"/></g>`);
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('invisible-content-skipped');
  });

  it('disables a paint whose color alpha is 0', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}" fill="rgba(255,0,0,0)"/>`);
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('unpainted-shape-skipped');
    expect(result.sourceColors).toEqual([]);
  });

  it('warns but keeps the base color for a partially transparent paint', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}" fill="#ff0000" fill-opacity="0.5"/>`);
    expect(result.shapes[0].fillHex).toBe('#ff0000');
    expect(codes(result)).toContain('opacity-ignored');
  });

  it('skips a fill="none" shape with no stroke', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}" fill="none"/>`);
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('unpainted-shape-skipped');
  });

  it('is fatal for an unsupported color', () => {
    expectFatal(
      `<path d="${TRIANGLE_CLOSED}" fill="color-mix(in srgb, red, blue)"/>`,
      'unsupported-color',
    );
  });

  it('keeps the inherited color when a descendant sets color="currentColor"', () => {
    const shape = onlyShape(
      `<g color="red"><g color="currentColor"><path d="${TRIANGLE_CLOSED}" fill="currentColor"/></g></g>`,
    );
    expect(shape.fillHex).toBe('#ff0000');
  });

  it('reads a style declaration that follows a CSS comment', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" style="/* brand */ fill:#ff0000"/>`);
    expect(shape.fillHex).toBe('#ff0000');
  });

  it('skips a display:none root <svg>', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}"/>`, 'viewBox="0 0 10 10" display="none"');
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('hidden-content-skipped');
  });
});

describe('extractShapes -- source colors', () => {
  it('collects unique enabled paints in first-appearance order', () => {
    const result = analyze(
      `<path d="${TRIANGLE_CLOSED}" fill="#ff0000" stroke="#00ff00"/>` +
        `<path d="${TRIANGLE_CLOSED}" fill="#ff0000"/>` +
        `<path d="${TRIANGLE_CLOSED}" fill="#0000ff"/>`,
    );
    expect(result.sourceColors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('does not register a color whose stroke is dropped for zero width', () => {
    const result = analyze(
      `<path d="${TRIANGLE_CLOSED}" fill="#ff0000" stroke="#00ff00" stroke-width="0"/>`,
    );
    expect(result.sourceColors).toEqual(['#ff0000']);
  });

  it('is fatal past the color quota', () => {
    const paths = Array.from(
      { length: 25 },
      (_, i) => `<path d="${TRIANGLE_CLOSED}" fill="rgb(${i},0,0)"/>`,
    ).join('');
    expectFatal(paths, 'too-many-colors');
  });
});

describe('extractShapes -- transforms', () => {
  it('bakes a translate into the anchors', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" transform="translate(5,7)"/>`);
    expect(shape.contours[0].points[0]).toEqual({ x: 5, y: 7 });
  });

  it('composes a comma-separated transform list', () => {
    const shape = onlyShape(
      `<path d="M0 0 L1 0" transform="translate(10,0), scale(2)" stroke="black" fill="none"/>`,
    );
    expect(shape.contours[0].points.map((p) => p.x)).toEqual([10, 12]);
  });

  it('multiplies ancestor group transforms down the tree', () => {
    const shape = onlyShape(
      `<g transform="translate(10,0)"><g transform="scale(2)"><path d="${TRIANGLE_CLOSED}"/></g></g>`,
    );
    expect(shape.contours[0].points[1]).toEqual({ x: 30, y: 0 });
  });

  it('rotates about an explicit center', () => {
    const shape = onlyShape(
      `<path d="M20 10 L20 10" transform="rotate(90 10 10)" stroke="black"/>`,
    );
    expect(shape.contours[0].points[0].x).toBeCloseTo(10, 9);
    expect(shape.contours[0].points[0].y).toBeCloseTo(20, 9);
  });

  it('bakes a nonuniform scale into handles as well as anchors', () => {
    const shape = onlyShape(`<path d="M0 0 C1 2 3 4 5 6" transform="scale(2,10)"/>`);
    const [start, end] = shape.contours[0].points;
    expect(start).toMatchObject({ x: 0, y: 0, hout: { x: 2, y: 20 } });
    expect(end).toMatchObject({ x: 10, y: 60, hin: { x: 6, y: 40 } });
  });

  it('scales the stroke width by a uniform scale', () => {
    const shape = onlyShape(
      `<path d="${TRIANGLE_OPEN}" fill="none" stroke="black" stroke-width="2" transform="scale(3)"/>`,
    );
    expect(shape.strokeWidth).toBeCloseTo(6, 9);
  });

  it('accepts a reflection on a stroked shape', () => {
    const shape = onlyShape(
      `<path d="${TRIANGLE_OPEN}" fill="none" stroke="black" stroke-width="2" transform="scale(-3,3)"/>`,
    );
    expect(shape.strokeWidth).toBeCloseTo(6, 9);
  });

  it('is fatal for a stroked shape under a nonuniform scale', () => {
    expectFatal(
      `<path d="${TRIANGLE_OPEN}" fill="none" stroke="black" transform="scale(2,5)"/>`,
      'nonuniform-stroke',
    );
  });

  it('is fatal for a stroked shape under a skew', () => {
    expectFatal(
      `<path d="${TRIANGLE_OPEN}" fill="none" stroke="black" transform="skewX(20)"/>`,
      'nonuniform-stroke',
    );
  });

  it('accepts a nonuniform scale on a fill-only shape', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" transform="scale(2,5)"/>`);
    expect(shape.contours[0].points[1]).toEqual({ x: 20, y: 0 });
  });

  it('skips a shape collapsed by scale(0)', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}" fill="#ff0000" transform="scale(0)"/>`);
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('degenerate-transform-skipped');
    // a skipped shape must not contribute a color the user then has to map
    expect(result.sourceColors).toEqual([]);
  });

  it('is fatal for an unreadable transform', () => {
    expectFatal(`<path d="${TRIANGLE_CLOSED}" transform="wobble(3)"/>`, 'invalid-transform');
  });
});

describe('extractShapes -- shape conversion', () => {
  it('converts a rect to a closed 4-point contour', () => {
    const shape = onlyShape('<rect x="1" y="2" width="10" height="20"/>');
    expect(shape.contours).toHaveLength(1);
    expect(shape.contours[0].closed).toBe(true);
    expect(shape.contours[0].points.map((p) => [p.x, p.y])).toEqual([
      [1, 2],
      [11, 2],
      [11, 22],
      [1, 22],
    ]);
  });

  it('converts a rounded rect into curves with clamped radii', () => {
    const shape = onlyShape('<rect width="10" height="10" rx="99"/>');
    const points = shape.contours[0].points;
    expect(points.length).toBeGreaterThan(4);
    expect(points.every((p) => p.x >= -1e-9 && p.x <= 10 + 1e-9)).toBe(true);
  });

  it('mirrors a missing ry from rx', () => {
    const withRx = onlyShape('<rect width="10" height="10" rx="2"/>');
    const withBoth = onlyShape('<rect width="10" height="10" rx="2" ry="2"/>');
    expect(withRx.contours).toEqual(withBoth.contours);
  });

  it('converts a circle to a closed curve contour', () => {
    const shape = onlyShape('<circle cx="50" cy="50" r="10"/>');
    expect(shape.contours[0].closed).toBe(true);
    expect(shape.contours[0].points.every((p) => p.hin || p.hout)).toBe(true);
  });

  it('converts an ellipse', () => {
    const shape = onlyShape('<ellipse cx="50" cy="50" rx="20" ry="10"/>');
    const xs = shape.contours[0].points.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(30, 6);
    expect(Math.max(...xs)).toBeCloseTo(70, 6);
  });

  it('converts a polyline to an open contour', () => {
    const shape = onlyShape('<polyline points="0,0 10,0 10,10" fill="none" stroke="black"/>');
    expect(shape.contours[0].closed).toBe(false);
    expect(shape.contours[0].points).toHaveLength(3);
  });

  it('converts a polygon to a closed contour', () => {
    const shape = onlyShape('<polygon points="0,0 10,0 10,10"/>');
    expect(shape.contours[0]).toMatchObject({ closed: true });
    expect(shape.contours[0].points).toHaveLength(3);
  });

  it('reads glued negative coordinates in a points list', () => {
    const shape = onlyShape('<polygon points="0,0 10,0-5,10"/>');
    expect(shape.contours[0].points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [10, 0],
      [-5, 10],
    ]);
  });

  it('never fills a line', () => {
    const shape = onlyShape('<line x1="0" y1="0" x2="10" y2="10" fill="red" stroke="blue"/>');
    expect(shape.fillHex).toBeNull();
    expect(shape.strokeHex).toBe('#0000ff');
  });

  it('skips a zero-size rect', () => {
    const result = analyze('<rect width="0" height="10"/>');
    expect(result.shapes).toEqual([]);
    expect(codes(result)).toContain('empty-geometry-skipped');
  });

  it('is fatal for a percentage length', () => {
    expectFatal('<rect x="10%" width="10" height="10"/>', 'unsupported-unit');
  });

  it('accepts a px length', () => {
    expect(onlyShape('<rect width="10px" height="10px"/>').contours[0].points).toHaveLength(4);
  });

  it('is fatal for malformed path data rather than throwing', () => {
    expectFatal('<path d="M0 0 Q Q nope"/>', 'invalid-path-data');
  });

  it('is fatal for an odd coordinate count in points', () => {
    expectFatal('<polygon points="0,0 10,0 10"/>', 'invalid-path-data');
  });
});

describe('extractShapes -- implicit fill closure', () => {
  it('produces identical IR for open and explicitly closed fill geometry', () => {
    const open = onlyShape(`<path d="${TRIANGLE_OPEN}"/>`);
    const closed = onlyShape(`<path d="${TRIANGLE_CLOSED}"/>`);
    expect(open.contours).toEqual(closed.contours);
    expect(open.contours[0].closed).toBe(true);
  });

  it('drops a duplicate closing anchor and keeps its incoming handle', () => {
    const shape = onlyShape('<path d="M0 0 L10 0 C10 5 5 10 0 0"/>');
    const points = shape.contours[0].points;
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ x: 0, y: 0, hin: { x: 5, y: 10 } });
  });

  it('runs the coincidence test in source space, before the transform', () => {
    // 1e-7 apart in source space: over the 1e-9 threshold, so no dedup, and
    // scale(4) must not change that verdict.
    const nearly = onlyShape('<path d="M0 0 L10 0 L10 10 L0.0000001 0" transform="scale(4)"/>');
    expect(nearly.contours[0].points).toHaveLength(4);

    const exact = onlyShape('<path d="M0 0 L10 0 L10 10 L0 0" transform="scale(4)"/>');
    expect(exact.contours[0].points).toHaveLength(3);
  });

  it('starts a new subpath when a drawing command follows Z', () => {
    // per SVG, the L after Z opens a new subpath at the closed subpath's
    // start point -- it must not extend the closed triangle
    const shape = onlyShape(`<path d="M0 0 L10 0 L10 10 Z L0 10" fill="none" stroke="black"/>`);
    expect(shape.contours).toHaveLength(2);
    expect(shape.contours[0]).toMatchObject({ closed: true });
    expect(shape.contours[0].points).toHaveLength(3);
    expect(shape.contours[1].closed).toBe(false);
    expect(shape.contours[1].points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it('keeps the authored open contour for a stroke-only shape', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_OPEN}" fill="none" stroke="black"/>`);
    expect(shape.contours[0].closed).toBe(false);
    expect(shape.contours[0].points).toHaveLength(3);
  });
});

describe('extractShapes -- fill/stroke emission', () => {
  it('emits one shape when a closed contour is filled and stroked', () => {
    const shape = onlyShape(
      `<path d="${TRIANGLE_CLOSED}" fill="red" stroke="blue" stroke-width="3"/>`,
    );
    expect(shape).toMatchObject({ fillHex: '#ff0000', strokeHex: '#0000ff', strokeWidth: 3 });
  });

  it('splits an open filled+stroked shape into fill then stroke', () => {
    const shapes = shapesOf(
      `<path d="${TRIANGLE_OPEN} M20 20 L30 20 L30 30 Z" fill="red" stroke="blue"/>`,
    );
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ fillHex: '#ff0000', strokeHex: null, strokeWidth: 0 });
    expect(shapes[0].contours.every((c) => c.closed)).toBe(true);
    expect(shapes[1]).toMatchObject({ fillHex: null, strokeHex: '#0000ff' });
    expect(shapes[1].contours[0].closed).toBe(false);
  });

  it('keeps a donut as one shape with two contours', () => {
    const result = analyze(
      `<path fill-rule="evenodd" d="M0 0 L30 0 L30 30 L0 30 Z M10 10 L20 10 L20 20 L10 20 Z"/>`,
    );
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].contours).toHaveLength(2);
    expect(codes(result)).not.toContain('nonzero-compound');
  });

  it('warns when a compound filled shape uses the default nonzero rule', () => {
    const result = analyze(`<path d="M0 0 L30 0 L30 30 Z M10 10 L20 10 L20 20 Z"/>`);
    expect(result.shapes).toHaveLength(1);
    expect(codes(result)).toContain('nonzero-compound');
  });

  it('does not warn about nonzero for a single-contour shape', () => {
    expect(codes(analyze(`<path d="${TRIANGLE_CLOSED}"/>`))).not.toContain('nonzero-compound');
  });

  it('ignores a unit-bearing stroke-width on an unstroked shape', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" stroke="none" stroke-width="0.5mm"/>`);
    expect(shape).toMatchObject({ fillHex: '#000000', strokeHex: null });
  });

  it('is still fatal for a unit-bearing stroke-width on a stroked shape', () => {
    expectFatal(
      `<path d="${TRIANGLE_CLOSED}" stroke="black" stroke-width="0.5mm"/>`,
      'unsupported-unit',
    );
  });

  it('drops the stroke when stroke-width is 0', () => {
    const shape = onlyShape(`<path d="${TRIANGLE_CLOSED}" stroke="blue" stroke-width="0"/>`);
    expect(shape.strokeHex).toBeNull();
  });

  it('warns about non-default stroke cap/join', () => {
    const result = analyze(
      `<path d="${TRIANGLE_OPEN}" fill="none" stroke="black" stroke-linecap="round"/>`,
    );
    expect(codes(result)).toContain('stroke-style-ignored');
  });

  it('emits shapes in document order', () => {
    const shapes = shapesOf(
      `<rect id="first" width="5" height="5"/><circle id="second" r="5"/><path id="third" d="${TRIANGLE_CLOSED}"/>`,
    );
    expect(shapes.map((s) => s.name)).toEqual(['first', 'second', 'third']);
  });

  it('names unnamed shapes with a per-type ordinal', () => {
    const shapes = shapesOf(
      `<rect width="5" height="5"/><rect width="5" height="5"/><path d="${TRIANGLE_CLOSED}"/>`,
    );
    expect(shapes.map((s) => s.name)).toEqual(['rect 1', 'rect 2', 'path 1']);
  });

  it('suffixes the split shapes with fill and stroke', () => {
    const shapes = shapesOf(`<path id="sign" d="${TRIANGLE_OPEN}" fill="red" stroke="blue"/>`);
    expect(shapes.map((s) => s.name)).toEqual(['sign fill', 'sign stroke']);
  });
});

describe('extractShapes -- geometry quotas', () => {
  it('is fatal past the contour quota', () => {
    const d = Array.from({ length: 2001 }, (_, i) => `M0 ${i} L1 ${i}`).join(' ');
    expectFatal(`<path d="${d}"/>`, 'quota-exceeded');
  });

  it('accepts geometry just under the contour quota', () => {
    const d = Array.from({ length: 2000 }, (_, i) => `M0 ${i} L1 ${i}`).join(' ');
    expect(onlyShape(`<path d="${d}"/>`).contours).toHaveLength(2000);
  });
});

describe('analyzeSvg -- composition', () => {
  it('reports the viewport from the safety gate', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}"/>`, 'viewBox="-20 10 100 50"');
    expect(result.viewport).toEqual({ minX: -20, minY: 10, width: 100, height: 50 });
  });

  it('keeps safety-gate warnings alongside extraction warnings', () => {
    const result = analyze(`<path d="${TRIANGLE_CLOSED}" data-x="1" style="paint-order:stroke"/>`);
    expect(codes(result)).toContain('style-ignored');
    expect(result.status).toBe('ok');
  });

  it('does not warn that consumed style attributes were ignored', () => {
    const result = analyze(
      `<g opacity="0.5" color="red"><path d="${TRIANGLE_CLOSED}" fill-opacity="0.5" fill-rule="evenodd" visibility="visible" stroke-linecap="round" stroke-opacity="1"/></g>`,
    );
    expect(codes(result)).not.toContain('attribute-ignored');
  });

  it('returns a fatal for a document the safety gate rejects', () => {
    const result = analyzeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(result.status).toBe('fatal');
    expect(result.shapes).toEqual([]);
  });

  it('ignores non-rendering containers', () => {
    const result = analyze(`<defs><path d="${TRIANGLE_CLOSED}"/></defs><title>x</title>`);
    expect(result.shapes).toEqual([]);
    expect(result.status).toBe('ok');
  });
});
