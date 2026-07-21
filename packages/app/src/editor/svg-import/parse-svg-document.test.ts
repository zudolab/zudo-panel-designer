// @vitest-environment jsdom
//
// parseSvgDocument needs a real DOMParser to build the inert document it
// walks, so this file runs under jsdom (per-file pragma, same convention as
// import-image.test.ts / google-font-loader.test.ts elsewhere in this
// package).
import { describe, expect, it } from 'vitest';
import { parseSvgDocument } from './parse-svg-document';

const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

function svg(inner: string, rootAttrs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>${inner}</svg>`;
}

function expectFatal(text: string, code: string) {
  const result = parseSvgDocument(text);
  expect(result.status).toBe('fatal');
  if (result.status === 'fatal') {
    expect(result.diagnostics.some((d) => d.level === 'fatal' && d.code === code)).toBe(true);
  }
}

describe('parseSvgDocument -- pre-parse string-scan rejects', () => {
  it('rejects a DOCTYPE declaration', () => {
    const text = `<!DOCTYPE svg>${svg('<path d="M0 0"/>')}`;
    expectFatal(text, 'doctype-or-entity');
  });

  it('rejects an ENTITY declaration', () => {
    const text = `<!DOCTYPE svg [<!ENTITY x "y">]>${svg('<path d="M0 0"/>')}`;
    expectFatal(text, 'doctype-or-entity');
  });

  it('rejects a processing instruction other than the XML declaration', () => {
    const text = `<?xml-stylesheet type="text/css" href="style.css"?>${svg('<path d="M0 0"/>')}`;
    expectFatal(text, 'doctype-or-entity');
  });

  it('allows a leading XML declaration', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>${svg('<path d="M0 0"/>', 'width="10" height="10"')}`;
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
  });
});

describe('parseSvgDocument -- malformed XML', () => {
  it('rejects text the parser cannot complete', () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"></svg>`;
    expectFatal(text, 'malformed-xml');
  });

  it('rejects a root element that is not <svg>', () => {
    const text = '<g xmlns="http://www.w3.org/2000/svg"></g>';
    expectFatal(text, 'malformed-xml');
  });

  it('rejects a root <svg> missing the SVG namespace', () => {
    const text = '<svg><path d="M0 0"/></svg>';
    expectFatal(text, 'malformed-xml');
  });
});

describe('parseSvgDocument -- element allowlist', () => {
  it('rejects <script>', () => {
    expectFatal(svg('<script>alert(1)</script>', 'width="10" height="10"'), 'unsupported-element');
  });

  it('rejects <foreignObject>', () => {
    expectFatal(
      svg('<foreignObject width="10" height="10"></foreignObject>', 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('rejects <text>', () => {
    expectFatal(svg('<text>hi</text>', 'width="10" height="10"'), 'unsupported-element');
  });

  it('rejects <image>', () => {
    expectFatal(
      svg(`<image ${XLINK} xlink:href="#x" width="1" height="1"/>`, 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('rejects <use>', () => {
    expectFatal(
      svg(`<use ${XLINK} xlink:href="#x"/>`, 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('rejects a nested <svg>', () => {
    expectFatal(svg('<svg></svg>', 'width="10" height="10"'), 'unsupported-element');
  });

  it('rejects <linearGradient> (and any gradient/pattern/style def)', () => {
    expectFatal(
      svg('<defs><linearGradient id="g"/></defs>', 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('rejects <style>', () => {
    expectFatal(
      svg('<style>.a{fill:red}</style>', 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('rejects SMIL <animate>', () => {
    expectFatal(
      svg('<rect><animate attributeName="x" to="10"/></rect>', 'width="10" height="10"'),
      'unsupported-element',
    );
  });

  it('accepts every allowlisted element with valid geometry', () => {
    const text = svg(
      '<g><title>t</title><desc>d</desc><metadata>m</metadata>' +
        '<path d="M0 0L1 1"/><rect x="0" y="0" width="1" height="1"/>' +
        '<circle cx="0" cy="0" r="1"/><ellipse cx="0" cy="0" rx="1" ry="1"/>' +
        '<line x1="0" y1="0" x2="1" y2="1"/><polyline points="0,0 1,1"/>' +
        '<polygon points="0,0 1,1 1,0"/><defs></defs></g>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
  });

  it('rejects an unsupported element even when nested inside <defs>', () => {
    expectFatal(
      svg('<defs><filter id="f"></filter></defs>', 'width="10" height="10"'),
      'unsupported-element',
    );
  });
});

describe('parseSvgDocument -- display:none pruning', () => {
  it('prunes a hidden subtree via the display attribute before the allowlist check, with a warning', () => {
    const text = svg(
      '<g display="none"><script>alert(1)</script></g><path d="M0 0L1 1"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(
        result.diagnostics.some(
          (d) => d.level === 'warning' && d.code === 'hidden-content-skipped',
        ),
      ).toBe(true);
    }
  });

  it('prunes a hidden subtree via inline style display:none', () => {
    const text = svg(
      '<g style="display:none"><script>alert(1)</script></g><path d="M0 0L1 1"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
  });
});

describe('parseSvgDocument -- attribute tiers', () => {
  it('rejects an on* event handler attribute', () => {
    expectFatal(
      svg('<rect onclick="alert(1)" x="0" y="0" width="1" height="1"/>', 'width="10" height="10"'),
      'unsafe-attribute',
    );
  });

  it('rejects an href that is not a local #id reference', () => {
    expectFatal(
      svg(
        `<path ${XLINK} xlink:href="https://evil.example/x.svg" d="M0 0"/>`,
        'width="10" height="10"',
      ),
      'unsafe-attribute',
    );
  });

  it('accepts a local #id href reference', () => {
    const text = svg(`<path ${XLINK} xlink:href="#thing" d="M0 0L1 1"/>`, 'width="10" height="10"');
    expect(parseSvgDocument(text).status).toBe('ok');
  });

  it('rejects url(...) in a fill attribute', () => {
    expectFatal(
      svg('<rect fill="url(#grad)" x="0" y="0" width="1" height="1"/>', 'width="10" height="10"'),
      'unsafe-attribute',
    );
  });

  it('rejects url(...) inside a style attribute', () => {
    expectFatal(
      svg(
        '<rect style="fill:url(#grad)" x="0" y="0" width="1" height="1"/>',
        'width="10" height="10"',
      ),
      'unsafe-attribute',
    );
  });

  it.each([
    'filter',
    'mask',
    'clip-path',
    'marker-start',
    'marker-mid',
    'marker-end',
    'vector-effect',
    'stroke-dasharray',
  ])('rejects the %s attribute regardless of value', (attr) => {
    expectFatal(
      svg(`<rect ${attr}="none" x="0" y="0" width="1" height="1"/>`, 'width="10" height="10"'),
      'unsupported-attribute',
    );
  });

  it('rejects an unsupported semantic property set via style', () => {
    expectFatal(
      svg(
        '<rect style="mask: circle(50%)" x="0" y="0" width="1" height="1"/>',
        'width="10" height="10"',
      ),
      'unsupported-attribute',
    );
  });

  it('silences known-inert attributes without a diagnostic', () => {
    const text = svg(
      '<rect id="a" class="b" data-foo="c" aria-label="d" version="1.1" role="img" ' +
        'xml:space="preserve" x="0" y="0" width="1" height="1"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it('silences editor-metadata namespace attributes (inkscape:*, sodipodi:*)', () => {
    const text = svg(
      '<rect xmlns:inkscape="urn:inkscape" xmlns:sodipodi="urn:sodipodi" ' +
        'inkscape:label="x" sodipodi:type="y" x="0" y="0" width="1" height="1"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diagnostics.filter((d) => d.level === 'warning')).toHaveLength(0);
    }
  });

  it('warns on an unrecognized attribute instead of failing', () => {
    const text = svg(
      '<rect opacity="0.5" x="0" y="0" width="1" height="1"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(
        result.diagnostics.some(
          (d) =>
            d.level === 'warning' &&
            d.code === 'attribute-ignored' &&
            d.message.includes('opacity'),
        ),
      ).toBe(true);
    }
  });

  it('does not warn on consumed geometry/paint attributes', () => {
    const text = svg(
      '<rect x="0" y="0" width="1" height="1" fill="#ff0000" stroke="#000000" stroke-width="1" transform="translate(1,1)"/>',
      'width="10" height="10"',
    );
    const result = parseSvgDocument(text);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.diagnostics).toHaveLength(0);
    }
  });
});

describe('parseSvgDocument -- quotas', () => {
  it('rejects a tree deeper than 32 levels', () => {
    const depth = 34;
    const inner = '<g>'.repeat(depth) + '<path d="M0 0L1 1"/>' + '</g>'.repeat(depth);
    expectFatal(svg(inner, 'width="10" height="10"'), 'quota-exceeded');
  });

  it('rejects a tree with more than 5,000 elements', () => {
    const inner = '<rect x="0" y="0" width="1" height="1"/>'.repeat(5001);
    expectFatal(svg(inner, 'width="10" height="10"'), 'quota-exceeded');
  });

  it('accepts a tree within both quotas', () => {
    const inner = '<rect x="0" y="0" width="1" height="1"/>'.repeat(100);
    expect(parseSvgDocument(svg(inner, 'width="10" height="10"')).status).toBe('ok');
  });
});

describe('parseSvgDocument -- viewport resolution', () => {
  it('resolves from viewBox alone, origin preserved', () => {
    const result = parseSvgDocument(svg('<path d="M0 0L1 1"/>', 'viewBox="-20 10 100 50"'));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.viewport).toEqual({ minX: -20, minY: 10, width: 100, height: 50 });
    }
  });

  it('resolves from width/height alone, origin 0,0', () => {
    const result = parseSvgDocument(svg('<path d="M0 0L1 1"/>', 'width="200" height="80"'));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.viewport).toEqual({ minX: 0, minY: 0, width: 200, height: 80 });
    }
  });

  it('prefers viewBox when both are present, even if they mismatch', () => {
    const result = parseSvgDocument(
      svg('<path d="M0 0L1 1"/>', 'viewBox="0 0 100 50" width="500" height="200"'),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.viewport).toEqual({ minX: 0, minY: 0, width: 100, height: 50 });
    }
  });

  it('ignores a non-px root width/height unit when viewBox is present', () => {
    const result = parseSvgDocument(
      svg('<path d="M0 0L1 1"/>', 'viewBox="0 0 100 50" width="128mm" height="64mm"'),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.viewport).toEqual({ minX: 0, minY: 0, width: 100, height: 50 });
    }
  });

  it('rejects a non-px root width/height unit when there is no viewBox', () => {
    expectFatal(svg('<path d="M0 0L1 1"/>', 'width="128mm" height="64mm"'), 'unsupported-unit');
  });

  it('accepts an explicit px unit without a viewBox', () => {
    const result = parseSvgDocument(svg('<path d="M0 0L1 1"/>', 'width="128px" height="64px"'));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.viewport).toEqual({ minX: 0, minY: 0, width: 128, height: 64 });
    }
  });

  it('rejects zero dimensions', () => {
    expectFatal(svg('<path d="M0 0L1 1"/>', 'width="0" height="10"'), 'no-viewport');
  });

  it('rejects negative dimensions', () => {
    expectFatal(svg('<path d="M0 0L1 1"/>', 'viewBox="0 0 -10 10"'), 'no-viewport');
  });

  it('rejects a non-finite viewBox dimension', () => {
    expectFatal(svg('<path d="M0 0L1 1"/>', 'viewBox="0 0 NaN 10"'), 'no-viewport');
  });

  it('rejects when neither viewBox nor width/height are present', () => {
    expectFatal(svg('<path d="M0 0L1 1"/>'), 'no-viewport');
  });
});
