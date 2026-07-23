import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import { flattenLayerNodes, MAX_GROUP_DEPTH } from './layer-nodes';
import { PCB_LAYER_DEFINITIONS } from './palette';
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';
import {
  PANEL_CONFIG_VERSION,
  parseLayerNodeFragment,
  parseLegacyLayerFragment,
  parsePanelConfig,
  serializePanelConfig,
  tryParsePanelConfig,
} from './serialize';
import type { GroupNode, LayerNode, PcbLayerRole, ShapeLayer } from './types';

const shape = (id: string, color: 0 | 1 | 2, name = id): ShapeLayer => ({
  id,
  name,
  type: 'shape',
  shape: 'rect',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  color,
});

const group = (id: string, children: LayerNode[], extra: Partial<GroupNode> = {}): GroupNode => ({
  kind: 'group',
  id,
  name: id,
  children,
  ...extra,
});

function children(doc: ReturnType<typeof parsePanelConfig>, role: PcbLayerRole): LayerNode[] {
  return doc.layers.find((container) => container.role === role)!.children;
}

describe('panel config v5 fixed PCB stack', () => {
  it('serializes and round-trips the exact canonical persisted stack', () => {
    const doc = createDefaultDoc();
    doc.layers[1] = { ...doc.layers[1], hidden: true };
    const config = serializePanelConfig(doc);

    expect(config.version).toBe(5);
    expect(PANEL_CONFIG_VERSION).toBe(5);
    expect(config.layers.map(({ id, role }) => ({ id, role }))).toEqual(
      PCB_LAYER_DEFINITIONS.map(({ id, role }) => ({ id, role })),
    );
    expect(parsePanelConfig(JSON.parse(JSON.stringify(config)))).toEqual(doc);
  });

  it('keeps the strict import gate for foreign, missing, and future versions', () => {
    expect(tryParsePanelConfig({ app: 'other', version: 5, layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 6, layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 5 }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 1, layers: [] }).ok).toBe(true);
  });
});

describe('v1-v4 deterministic material migration', () => {
  const legacy = {
    version: 4,
    app: 'zpd',
    panel: { hp: 12 },
    layers: [
      group(
        'mixed',
        [
          shape('black', 0, 'Mask'),
          {
            id: 'split',
            name: 'Split path',
            type: 'path' as const,
            points: [],
            closed: true,
            fill: 1 as const,
            stroke: 2 as const,
            strokeWidth: 1,
          },
          group('nested', [shape('white', 2)], { hidden: true, name: 'Nested name' }),
          {
            id: 'nested-image',
            name: 'Nested reference',
            type: 'image' as const,
            src: 'data:',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        ],
        { hidden: true, name: 'Mixed name' },
      ),
      group('empty', [], { hidden: true, name: 'Empty name' }),
      {
        id: 'paintless',
        name: 'No paint',
        type: 'path',
        points: [],
        closed: false,
        fill: null,
        stroke: null,
        strokeWidth: 0,
      },
      {
        id: 'image',
        name: 'Reference',
        type: 'image',
        src: 'data:',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
    ],
    guides: [],
  };

  it.each([1, 2, 3, 4] as const)(
    'migrates the exact v%s legacy fixture into the canonical material roots',
    (version) => {
      const doc = parsePanelConfig({
        version,
        app: 'zpd',
        panel: { hp: 8 },
        layers: [
          shape(`gold-v${version}`, 1),
          shape(`mask-v${version}`, 0),
          shape(`silk-v${version}`, 2),
        ],
        guides:
          version === 1
            ? undefined
            : [{ id: `guide-v${version}`, orientation: 'vertical', position: 4 }],
      });
      expect(
        doc.layers.map((container) => ({ role: container.role, hidden: container.hidden })),
      ).toEqual([
        { role: 'copper', hidden: undefined },
        { role: 'solder-mask', hidden: undefined },
        { role: 'silkscreen', hidden: undefined },
      ]);
      expect(children(doc, 'copper')).toMatchObject([{ id: `gold-v${version}`, color: 1 }]);
      expect(children(doc, 'solder-mask')).toMatchObject([{ id: `mask-v${version}`, color: 0 }]);
      expect(children(doc, 'silkscreen')).toMatchObject([{ id: `silk-v${version}`, color: 2 }]);
      expect(serializePanelConfig(doc).version).toBe(5);
      expect(doc.guides).toHaveLength(version === 1 ? 0 : 1);
    },
  );

  it('partitions mixed groups, splits fill/stroke, preserves shells/order/state, and routes colorless nodes', () => {
    const doc = parsePanelConfig(legacy);
    expect(doc.layers.map((container) => container.role)).toEqual([
      'copper',
      'solder-mask',
      'silkscreen',
    ]);

    const copper = children(doc, 'copper');
    expect(copper.map((node) => node.id)).toEqual(['mixed-copper', 'empty', 'paintless', 'image']);
    const copperGroup = copper[0] as GroupNode;
    expect(copperGroup).toMatchObject({ name: 'Mixed name', hidden: true });
    expect(copperGroup.children).toHaveLength(2);
    expect(copperGroup.children[0]).toMatchObject({
      id: 'split',
      fill: 1,
      stroke: null,
    });
    expect(copperGroup.children[1]).toMatchObject({ id: 'nested-image', type: 'image' });
    expect(copper[1]).toMatchObject({
      kind: 'group',
      name: 'Empty name',
      hidden: true,
      children: [],
    });

    const maskGroup = children(doc, 'solder-mask')[0] as GroupNode;
    expect(maskGroup.id).toBe('mixed'); // first painted descendant is black
    expect(maskGroup.children.map((node) => node.id)).toEqual(['black']);

    const silkGroup = children(doc, 'silkscreen')[0] as GroupNode;
    expect(silkGroup.id).toBe('mixed-silkscreen');
    expect(silkGroup.children[0]).toMatchObject({
      id: 'split-silkscreen',
      fill: null,
      stroke: 2,
    });
    expect(silkGroup.children[1]).toMatchObject({
      kind: 'group',
      id: 'nested',
      name: 'Nested name',
      hidden: true,
    });
  });

  it('is byte-identical across repeated parses and deterministically resolves duplicates/fixed collisions', () => {
    const payload = {
      version: 4,
      app: 'zpd',
      layers: [
        shape('duplicate', 1),
        shape('duplicate', 1),
        shape('pcb-layer-copper', 2),
        shape('duplicate-2', 0),
      ],
    };
    const first = parsePanelConfig(payload);
    const second = parsePanelConfig(payload);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(children(first, 'copper').map((node) => node.id)).toEqual(['duplicate', 'duplicate-3']);
    expect(children(first, 'silkscreen')[0].id).toBe('pcb-layer-copper-2');
    expect(children(first, 'solder-mask')[0].id).toBe('duplicate-2');
  });

  it('gives source ids priority when a generated role suffix would collide with a later node', () => {
    const doc = parsePanelConfig({
      version: 4,
      app: 'zpd',
      layers: [group('g', [shape('black', 0), shape('gold', 1)]), shape('g-copper', 1)],
    });
    expect(children(doc, 'copper').map((node) => node.id)).toEqual(['g-copper-2', 'g-copper']);
  });
});

describe('malformed v5 recovery', () => {
  it('rebuilds metadata/order, merges duplicate roles, synthesizes missing roles, and recovers illegal/unknown roots', () => {
    const payload = {
      version: 5,
      app: 'zpd',
      layers: [
        {
          kind: 'pcb-layer',
          id: 'renamed',
          role: 'silkscreen',
          name: 'Wrong',
          children: [shape('a', 0)], // membership forces white
        },
        shape('illegal', 0),
        {
          kind: 'pcb-layer',
          role: 'silkscreen',
          hidden: true,
          children: [shape('a', 1)],
        },
        {
          kind: 'future-wrapper',
          role: 'future',
          children: [shape('recovered', 1)],
        },
      ],
    };
    const doc = parsePanelConfig(payload);

    expect(doc.layers.map(({ id, role }) => ({ id, role }))).toEqual(
      PCB_LAYER_DEFINITIONS.map(({ id, role }) => ({ id, role })),
    );
    expect(children(doc, 'copper').map((node) => node.id)).toEqual(['recovered']);
    expect(children(doc, 'solder-mask').map((node) => node.id)).toEqual(['illegal']);
    expect(children(doc, 'silkscreen').map((node) => node.id)).toEqual(['a', 'a-2']);
    expect((children(doc, 'silkscreen')[0] as ShapeLayer).color).toBe(2);
    expect((children(doc, 'silkscreen')[1] as ShapeLayer).color).toBe(2);
    expect(doc.layers[2].hidden).toBe(true);
  });

  it('recovers parseable children from malformed metadata and never admits fixed-id collisions', () => {
    const doc = parsePanelConfig({
      version: 5,
      app: 'zpd',
      layers: [
        {
          children: [
            shape('pcb-layer-solder-mask', 0),
            { nope: true },
            group('g', [shape('g', 1)]),
          ],
        },
      ],
    });
    expect(children(doc, 'solder-mask')[0].id).toBe('pcb-layer-solder-mask-2');
    const recoveredGroup = children(doc, 'copper')[0] as GroupNode;
    expect(recoveredGroup.id).toBe('g');
    expect(recoveredGroup.children[0].id).toBe('g-2');
  });
});

describe('ordinary fragment parsing contracts', () => {
  it('defensively parses an ordinary fragment without performing full-document partitioning', () => {
    const parsed = parseLayerNodeFragment([
      group('g', [shape('same', 0), shape('same', 2)]),
      { type: 'unknown' },
    ]);
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as GroupNode).children.map((node) => node.id)).toEqual(['same', 'same-2']);
  });

  it('offers the same legacy partitioner for clipboard compatibility', () => {
    const parsed = parseLegacyLayerFragment([
      group('g', [shape('black', 0), shape('gold', 1), shape('white', 2)]),
    ]);
    expect(parsed.map(({ material, node }) => [material, node.id])).toEqual([
      ['copper', 'g-copper'],
      ['solder-mask', 'g'],
      ['silkscreen', 'g-silkscreen'],
    ]);
    expect(parsed.flatMap(({ node }) => flattenLayerNodes([node]).map((leaf) => leaf.id))).toEqual([
      'gold',
      'black',
      'white',
    ]);
  });

  it('retains legacy pattern geometry migration and rich leaf data through v5 round-trip', () => {
    const migrated = parsePanelConfig({
      version: 1,
      app: 'zpd',
      panel: { hp: 8, widthMm: 999, heightMm: 999 },
      layers: [
        {
          id: 'pattern',
          name: 'Pattern',
          type: 'pattern',
          patternType: 'dot-grid',
          params: { pitch: 5, invalid: 'drop' },
          color: 1,
        },
        {
          id: 'path',
          name: 'Path',
          type: 'path',
          closed: true,
          fill: 2,
          stroke: null,
          strokeWidth: 0.5,
          points: [{ x: 1, y: 2, hin: { x: 0, y: 2 }, hout: { x: 2, y: 2 } }],
          extraSubpaths: [[{ x: 3, y: 4 }]],
        },
        {
          id: 'text',
          name: 'Text',
          type: 'text',
          content: 'hello',
          fontFamily: 'Inter',
          sizeMm: 4,
          x: 5,
          y: 6,
          rotation: 45,
          color: 2,
        },
      ],
      guides: [{ orientation: 'vertical', position: 3, hidden: true }],
    });
    const pattern = children(migrated, 'copper')[0];
    expect(pattern).toMatchObject({
      id: 'pattern',
      params: { pitch: 5 },
      ...patternCoverGeometry({ widthMm: panelWidthMm(8), heightMm: PANEL_HEIGHT_MM }),
    });
    expect(migrated.guides).toEqual([
      { id: 'guide-1', orientation: 'vertical', position: 3, hidden: true },
    ]);
    expect(parsePanelConfig(JSON.parse(JSON.stringify(serializePanelConfig(migrated))))).toEqual(
      migrated,
    );
  });

  it('caps hostile group nesting while retaining legal leaves and sibling content', () => {
    let legal: LayerNode = shape('deep-leaf', 1);
    for (let depth = MAX_GROUP_DEPTH; depth >= 0; depth -= 1) {
      legal = group(`legal-${depth}`, [legal]);
    }
    const tooDeep = group('extra-root', [legal]);
    const doc = parsePanelConfig({
      version: 4,
      app: 'zpd',
      layers: [tooDeep, shape('survivor', 2)],
    });
    const parsedRoot = children(doc, 'copper')[0] as GroupNode;
    let cursor: LayerNode | undefined = parsedRoot;
    let groups = 0;
    while (cursor && 'kind' in cursor) {
      groups += 1;
      cursor = cursor.children[0];
    }
    expect(groups).toBe(MAX_GROUP_DEPTH + 1);
    expect(cursor).toBeUndefined();
    expect(children(doc, 'silkscreen')[0].id).toBe('survivor');
  });
});
