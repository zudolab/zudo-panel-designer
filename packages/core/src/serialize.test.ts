import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import { PALETTE } from './palette';
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { PANEL_CONFIG_VERSION, parsePanelConfig, serializePanelConfig, tryParsePanelConfig } from './serialize';
import type { DocState } from './types';

function fullFixtureDoc(): DocState {
  return {
    panelHp: 12,
    layers: [
      {
        id: 'shape-1',
        name: 'Rect',
        type: 'shape',
        shape: 'rect',
        x: 1.5,
        y: 2.25,
        width: 10,
        height: 5,
        rotation: 45,
        color: 0,
      },
      {
        id: 'shape-2',
        name: 'Ellipse (no rotation, hidden)',
        hidden: true,
        type: 'shape',
        shape: 'ellipse',
        x: 0,
        y: 0,
        width: 3,
        height: 3,
        color: 2,
      },
      {
        id: 'pattern-1',
        name: 'Dot grid',
        type: 'pattern',
        patternType: 'dot-grid',
        params: { pitch: 5, radius: 1 },
        color: 1,
      },
      {
        id: 'path-1',
        name: 'Traced blob',
        type: 'path',
        closed: true,
        fill: 1,
        stroke: null,
        strokeWidth: 0.2,
        points: [
          { x: 0, y: 0, hout: { x: 1, y: 0 } },
          { x: 10, y: 0, hin: { x: 9, y: -1 }, hout: { x: 11, y: 1 } },
          { x: 10, y: 10 },
        ],
        extraSubpaths: [
          [
            { x: 2, y: 2 },
            { x: 4, y: 2, hin: { x: 3.5, y: 2 }, hout: { x: 4.5, y: 2 } },
            { x: 4, y: 4 },
          ],
        ],
      },
      {
        id: 'text-1',
        name: 'Label',
        type: 'text',
        content: 'Line one\nLine two',
        fontFamily: 'Inter',
        sizeMm: 4,
        x: 5,
        y: 5,
        rotation: 90,
        color: 2,
      },
      {
        id: 'image-1',
        name: 'Reference photo',
        type: 'image',
        src: 'data:image/png;base64,AAAA',
        x: 0,
        y: 0,
        width: 20,
        height: 15,
      },
    ],
    guides: [
      { id: 'guide-h1', orientation: 'horizontal', position: 12.5 },
      { id: 'guide-v1', orientation: 'vertical', position: 4, hidden: true },
    ],
  };
}

describe('serializePanelConfig / parsePanelConfig round trip', () => {
  it('round-trips a document with all 5 layer types, extraSubpaths, and bezier handles', () => {
    const doc = fullFixtureDoc();
    const roundTripped = parsePanelConfig(serializePanelConfig(doc));
    expect(roundTripped).toEqual(doc);
  });

  it('round-trips through an actual JSON string (the download/upload boundary)', () => {
    const doc = fullFixtureDoc();
    const json = JSON.stringify(serializePanelConfig(doc));
    const roundTripped = parsePanelConfig(JSON.parse(json));
    expect(roundTripped).toEqual(doc);
  });

  it('emits derived panel size + palette names as advisory output', () => {
    const doc = fullFixtureDoc();
    const config = serializePanelConfig(doc);
    expect(config.version).toBe(2);
    expect(config.app).toBe('zpd');
    expect(config.panel).toEqual({
      hp: 12,
      widthMm: panelWidthMm(12),
      heightMm: PANEL_HEIGHT_MM,
    });
    expect(config.palette).toEqual(PALETTE.map((entry) => entry.name));
  });
});

describe('serialize v2 — guides migration', () => {
  it('emits version 2 with the guides array', () => {
    const doc = fullFixtureDoc();
    const config = serializePanelConfig(doc);
    expect(config.version).toBe(2);
    expect(config.guides).toEqual(doc.guides);
  });

  it('v2 round-trip preserves guides (including a hidden one)', () => {
    const doc = fullFixtureDoc();
    const roundTripped = parsePanelConfig(JSON.parse(JSON.stringify(serializePanelConfig(doc))));
    expect(roundTripped.guides).toEqual(doc.guides);
  });

  it('a v1 / missing-guides config parses to guides: []', () => {
    // shape of an old v1 export: version 1, no `guides` key at all
    const v1 = {
      version: 1,
      app: 'zpd',
      panel: { hp: 12, widthMm: 60.96, heightMm: 128.5 },
      palette: ['black', 'gold', 'white'],
      layers: [],
    };
    expect(parsePanelConfig(v1).guides).toEqual([]);
  });

  it('defaults a non-array guides field to []', () => {
    expect(parsePanelConfig({ guides: 'nope' }).guides).toEqual([]);
    expect(parsePanelConfig({ guides: 42 }).guides).toEqual([]);
    expect(parsePanelConfig({ guides: { position: 5 } }).guides).toEqual([]);
  });

  it('drops malformed guide entries safely', () => {
    const doc = parsePanelConfig({
      guides: [
        null,
        42,
        'nope',
        {}, // no orientation
        { orientation: 'diagonal', position: 5 }, // bad orientation
        { orientation: 'horizontal' }, // no position
        { orientation: 'horizontal', position: 'x' }, // non-numeric position
        { orientation: 'vertical', position: Infinity }, // non-finite position
        { orientation: 'horizontal', position: 7 }, // the one good entry
      ],
    });
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides[0]).toMatchObject({ orientation: 'horizontal', position: 7 });
    expect(typeof doc.guides[0].id).toBe('string');
    expect(doc.guides[0].id.length).toBeGreaterThan(0);
  });

  it('id-stamps a guide that is missing an id and preserves hidden', () => {
    const doc = parsePanelConfig({
      guides: [{ orientation: 'vertical', position: 3, hidden: true }],
    });
    expect(doc.guides[0].hidden).toBe(true);
    expect(doc.guides[0].id.length).toBeGreaterThan(0);
  });
});

describe('parsePanelConfig — never throws on bad input', () => {
  const garbageInputs: unknown[] = [null, undefined, 42, 'not json', true, [], [1, 2, 3], () => {}];

  it.each(garbageInputs)('falls back to the default document for garbage input %#', (input) => {
    expect(() => parsePanelConfig(input)).not.toThrow();
    expect(parsePanelConfig(input)).toEqual(createDefaultDoc());
  });

  it('fills in missing fields with safe defaults rather than throwing', () => {
    expect(() => parsePanelConfig({})).not.toThrow();
    const doc = parsePanelConfig({});
    expect(doc.panelHp).toBeGreaterThan(0);
    expect(doc.layers).toEqual([]);
  });

  it('ignores extra unknown top-level and per-layer fields', () => {
    const input = {
      hp: 6,
      somethingWeird: 'ignored',
      layers: [
        {
          type: 'shape',
          shape: 'rect',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          color: 0,
          extra: 'nope',
        },
      ],
    };
    const doc = parsePanelConfig(input);
    expect(doc.panelHp).toBe(6);
    expect(doc.layers[0]).not.toHaveProperty('extra');
    expect(doc).not.toHaveProperty('somethingWeird');
  });

  it.each([-5, 0, NaN, Infinity, '12', null, undefined])(
    'clamps out-of-range hp (%s) to the default HP',
    (hp) => {
      const doc = parsePanelConfig({ hp });
      expect(doc.panelHp).toBe(12);
    },
  );

  it('reads hp from panel.hp when the top-level hp is absent', () => {
    const doc = parsePanelConfig({ panel: { hp: 8 } });
    expect(doc.panelHp).toBe(8);
  });

  it('ignores a hand-edited panel.widthMm/heightMm that disagrees with hp', () => {
    const doc = parsePanelConfig({ hp: 12, panel: { hp: 12, widthMm: 999, heightMm: 999 } });
    expect(doc.panelHp).toBe(12);
    const config = serializePanelConfig(doc);
    expect(config.panel.widthMm).toBe(panelWidthMm(12));
    expect(config.panel.heightMm).toBe(PANEL_HEIGHT_MM);
  });

  it('keeps an unrecognized patternType as opaque data (patterns registry is not a core dependency)', () => {
    const doc = parsePanelConfig({
      layers: [{ type: 'pattern', patternType: 'totally-unknown-xyz', color: 1, params: { a: 1 } }],
    });
    expect(doc.layers).toHaveLength(1);
    const [layer] = doc.layers;
    expect(layer.type).toBe('pattern');
    if (layer.type !== 'pattern') throw new Error('unreachable');
    expect(layer.patternType).toBe('totally-unknown-xyz');
    expect(layer.params).toEqual({ a: 1 });
  });

  it.each([99, -1, 'gold', null, undefined, 3.5])(
    'clamps an out-of-range color index (%s) to 0',
    (color) => {
      const doc = parsePanelConfig({
        layers: [{ type: 'shape', shape: 'rect', x: 0, y: 0, width: 1, height: 1, color }],
      });
      expect(doc.layers[0]).toMatchObject({ color: 0 });
    },
  );

  it('drops layers with an unrecognized type', () => {
    const doc = parsePanelConfig({ layers: [{ type: 'sticker', x: 0, y: 0 }] });
    expect(doc.layers).toEqual([]);
  });

  it('drops non-object entries inside the layers array', () => {
    const doc = parsePanelConfig({
      layers: [
        null,
        42,
        'nope',
        { type: 'shape', shape: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 },
      ],
    });
    expect(doc.layers).toHaveLength(1);
  });

  it('id-stamps layers that are missing an id', () => {
    const doc = parsePanelConfig({
      layers: [{ type: 'shape', shape: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 }],
    });
    expect(typeof doc.layers[0].id).toBe('string');
    expect(doc.layers[0].id.length).toBeGreaterThan(0);
  });

  it('drops non-numeric entries from pattern params instead of throwing', () => {
    const doc = parsePanelConfig({
      layers: [
        {
          type: 'pattern',
          patternType: 'dot-grid',
          color: 1,
          params: { pitch: 5, bogus: 'nope', nested: { a: 1 } },
        },
      ],
    });
    const [layer] = doc.layers;
    expect(layer.type).toBe('pattern');
    if (layer.type !== 'pattern') throw new Error('unreachable');
    expect(layer.params).toEqual({ pitch: 5 });
  });
});

describe('tryParsePanelConfig — strict envelope validator', () => {
  it('accepts a real serializePanelConfig round-trip', () => {
    const doc = fullFixtureDoc();
    const result = tryParsePanelConfig(JSON.parse(JSON.stringify(serializePanelConfig(doc))));
    expect(result).toEqual({ ok: true, doc });
  });

  it('rejects an empty object (missing app/version/layers)', () => {
    const result = tryParsePanelConfig({});
    expect(result.ok).toBe(false);
  });

  it.each([null, undefined, 42, 'not json', true, [], () => {}])(
    'rejects non-object input %#',
    (input) => {
      expect(tryParsePanelConfig(input)).toEqual({ ok: false, reason: expect.any(String) });
    },
  );

  it('rejects a wrong `app` field', () => {
    const result = tryParsePanelConfig({ app: 'some-other-app', version: PANEL_CONFIG_VERSION, layers: [] });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('app') });
  });

  it('rejects a missing `layers` array even with a valid envelope', () => {
    const result = tryParsePanelConfig({ app: 'zpd', version: PANEL_CONFIG_VERSION });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('layers') });
  });

  it('rejects a non-array `layers`', () => {
    const result = tryParsePanelConfig({ app: 'zpd', version: PANEL_CONFIG_VERSION, layers: 'nope' });
    expect(result.ok).toBe(false);
  });

  it.each([0, -1, 999, 1.5, NaN, Infinity, '2', null, undefined])(
    'rejects an out-of-range, fractional, or non-numeric version (%s)',
    (version) => {
      const result = tryParsePanelConfig({ app: 'zpd', version, layers: [] });
      expect(result).toEqual({ ok: false, reason: expect.any(String) });
    },
  );

  it('accepts a v1 envelope (predates the guides field)', () => {
    const result = tryParsePanelConfig({
      version: 1,
      app: 'zpd',
      panel: { hp: 12, widthMm: 60.96, heightMm: 128.5 },
      palette: ['black', 'gold', 'white'],
      layers: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.guides).toEqual([]);
  });

  it('on success, delegates field-level defense to parsePanelConfig (garbage layer entries are dropped, not rejected)', () => {
    const result = tryParsePanelConfig({
      app: 'zpd',
      version: PANEL_CONFIG_VERSION,
      layers: [null, { type: 'sticker' }, { type: 'shape', shape: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.layers).toHaveLength(1);
  });
});
