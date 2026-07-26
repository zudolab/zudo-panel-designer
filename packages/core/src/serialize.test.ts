import { describe, expect, it } from 'vitest';
import { createDefaultDoc } from './default-doc';
import { MAX_GROUP_DEPTH } from './layer-nodes';
import { createPcbLayerStack, PCB_LAYER_CONTAINER_IDS, PCB_LAYER_DEFINITIONS } from './palette';
import { panelHeightMm } from './panel-templates';
import { panelWidthMm } from './panel-sizes';
import { patternCoverGeometry } from './pattern-geometry';
import {
  PANEL_CONFIG_VERSION,
  parseLayerNodeFragment,
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

type ParsedDoc = ReturnType<typeof parsePanelConfig>;

function children(doc: ParsedDoc, role: PcbLayerRole): LayerNode[] {
  return doc.layers.find((container) => container.role === role)!.children;
}

function backChildren(doc: ParsedDoc, role: PcbLayerRole): LayerNode[] {
  return doc.backLayers.find((container) => container.role === role)!.children;
}

describe('panel config v6', () => {
  it('serializes and round-trips material, format, and both stacks exactly', () => {
    const doc = {
      ...createDefaultDoc(),
      format: '1U' as const,
      material: 'alumi' as const,
      backLayers: createPcbLayerStack('back', {
        copper: [shape('back-gold', 1)],
        silkscreen: [group('back-group', [shape('back-white', 2)])],
      }),
    };
    doc.layers[1] = { ...doc.layers[1], hidden: true };
    const config = serializePanelConfig(doc);

    expect(config.version).toBe(6);
    expect(PANEL_CONFIG_VERSION).toBe(6);
    expect(config.panel.format).toBe('1U');
    expect(config.panel.heightMm).toBe(panelHeightMm('1U'));
    expect(config.material).toBe('alumi');
    expect(config.layers.map(({ id, role }) => ({ id, role }))).toEqual(
      PCB_LAYER_DEFINITIONS.map(({ id, role }) => ({ id, role })),
    );
    expect(config.backLayers.map((container) => container.id)).toEqual([
      'pcb-layer-back-copper',
      'pcb-layer-back-solder-mask',
      'pcb-layer-back-silkscreen',
    ]);
    expect(parsePanelConfig(JSON.parse(JSON.stringify(config)))).toEqual(doc);
  });

  it('keeps the strict import gate: only exactly v6 zpd payloads pass', () => {
    expect(tryParsePanelConfig({ app: 'zpd', version: 6, layers: [] }).ok).toBe(true);
    expect(tryParsePanelConfig({ app: 'other', version: 6, layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 5, layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 7, layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: '6', layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', layers: [] }).ok).toBe(false);
    expect(tryParsePanelConfig({ app: 'zpd', version: 6 }).ok).toBe(false);
    const rejected = tryParsePanelConfig({ app: 'zpd', version: 4, layers: [] });
    expect(rejected).toMatchObject({ ok: false });
    if (!rejected.ok) expect(rejected.reason).toContain('version');
  });

  it('treats every pre-v6 (or versionless) payload as unusable: lenient parse falls back to the default doc', () => {
    const legacyLayers = [shape('gold', 1), shape('mask', 0)];
    for (const version of [1, 2, 3, 4, 5, undefined]) {
      const doc = parsePanelConfig({
        version,
        app: 'zpd',
        panel: { hp: 8 },
        layers: legacyLayers,
        guides: [{ id: 'g', orientation: 'vertical', position: 4 }],
      });
      expect(doc).toEqual(createDefaultDoc());
    }
    expect(parsePanelConfig(null)).toEqual(createDefaultDoc());
    expect(parsePanelConfig([])).toEqual(createDefaultDoc());
  });

  it('recovers material and format field-level within v6, defaulting invalid values', () => {
    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      panel: { hp: 4, format: '1U' },
      material: 'alumi',
      layers: [],
    });
    expect(doc.format).toBe('1U');
    expect(doc.material).toBe('alumi');
    expect(doc.backLayers.map((container) => container.id)).toEqual([
      'pcb-layer-back-copper',
      'pcb-layer-back-solder-mask',
      'pcb-layer-back-silkscreen',
    ]);

    const defaulted = parsePanelConfig({
      version: 6,
      app: 'zpd',
      panel: { hp: 4, format: '2U' },
      material: 'steel',
      layers: [],
    });
    expect(defaulted.format).toBe('3U');
    expect(defaulted.material).toBe('fr4');
  });

  it('uses the parsed format height for fallback pattern cover geometry', () => {
    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      panel: { hp: 8, format: '1U' },
      layers: [
        {
          kind: 'pcb-layer',
          role: 'copper',
          children: [
            { id: 'pattern', name: 'Pattern', type: 'pattern', patternType: 'dot-grid', color: 1 },
          ],
        },
      ],
    });
    expect(children(doc, 'copper')[0]).toMatchObject(
      patternCoverGeometry({ widthMm: panelWidthMm(8), heightMm: panelHeightMm('1U') }),
    );
  });

  it('deterministically de-duplicates explicit and generated guide ids', () => {
    const payload = {
      version: 6,
      app: 'zpd',
      layers: [],
      guides: [
        { id: 'guide-2', orientation: 'vertical', position: 1 },
        { orientation: 'horizontal', position: 2 },
      ],
    };
    const first = parsePanelConfig(payload);
    const second = parsePanelConfig(payload);
    expect(first.guides.map((guide) => guide.id)).toEqual(['guide-2', 'guide-2-2']);
    expect(JSON.stringify(second.guides)).toBe(JSON.stringify(first.guides));
  });
});

describe('malformed v6 recovery', () => {
  it('rebuilds metadata/order, merges duplicate roles, synthesizes missing roles, and recovers illegal/unknown roots', () => {
    const payload = {
      version: 6,
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

  it('routes an illegal mixed group WHOLE to its first painted role with materials forced', () => {
    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      layers: [
        group('mixed', [shape('black', 0), shape('gold', 1)], { hidden: true }),
        group('empty', []),
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
      ],
    });
    // first painted descendant is black -> the whole group lands in the mask
    // container; no per-color splitting (the v1-v4 partitioner is gone).
    const mask = children(doc, 'solder-mask');
    expect(mask.map((node) => node.id)).toEqual(['mixed']);
    expect((mask[0] as GroupNode).hidden).toBe(true);
    expect((mask[0] as GroupNode).children).toMatchObject([
      { id: 'black', color: 0 },
      { id: 'gold', color: 0 },
    ]);
    // paint-free nodes fall back to copper, keeping their shell/data intact
    expect(children(doc, 'copper').map((node) => node.id)).toEqual(['empty', 'paintless']);
  });

  it('recovers parseable children from malformed metadata and never admits fixed-id collisions', () => {
    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      layers: [
        {
          children: [shape('pcb-layer-solder-mask', 0), { nope: true }, group('g', [shape('g', 1)])],
        },
      ],
    });
    expect(children(doc, 'solder-mask')[0].id).toBe('pcb-layer-solder-mask-2');
    const recoveredGroup = children(doc, 'copper')[0] as GroupNode;
    expect(recoveredGroup.id).toBe('g');
    expect(recoveredGroup.children[0].id).toBe('g-2');
  });

  it('caps hostile group nesting while retaining legal leaves and sibling content', () => {
    let legal: LayerNode = shape('deep-leaf', 1);
    for (let depth = MAX_GROUP_DEPTH; depth >= 0; depth -= 1) {
      legal = group(`legal-${depth}`, [legal]);
    }
    const tooDeep = group('extra-root', [legal]);
    const doc = parsePanelConfig({
      version: 6,
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

describe('back stack parsing and the shared six-id allocator', () => {
  it('parses backLayers with the same recovery rules and back structural ids', () => {
    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      layers: [],
      backLayers: [
        {
          kind: 'pcb-layer',
          role: 'copper',
          hidden: true,
          children: [shape('back-a', 0)], // membership forces gold
        },
        shape('back-illegal', 2),
      ],
    });
    expect(doc.backLayers.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: 'pcb-layer-back-copper', role: 'copper' },
      { id: 'pcb-layer-back-solder-mask', role: 'solder-mask' },
      { id: 'pcb-layer-back-silkscreen', role: 'silkscreen' },
    ]);
    expect(doc.backLayers[0].hidden).toBe(true);
    expect(backChildren(doc, 'copper')).toMatchObject([{ id: 'back-a', color: 1 }]);
    expect(backChildren(doc, 'silkscreen')).toMatchObject([{ id: 'back-illegal', color: 2 }]);
  });

  it('a missing/invalid backLayers field recovers as an empty canonical back stack', () => {
    for (const backLayers of [undefined, null, 'nope', {}]) {
      const doc = parsePanelConfig({ version: 6, app: 'zpd', layers: [], backLayers });
      expect(doc.backLayers).toEqual(createPcbLayerStack('back'));
    }
  });

  it('reserves all SIX structural ids so ordinary nodes can never take a container id on either side', () => {
    expect(PCB_LAYER_CONTAINER_IDS).toHaveLength(6);
    expect(new Set(PCB_LAYER_CONTAINER_IDS).size).toBe(6);

    const doc = parsePanelConfig({
      version: 6,
      app: 'zpd',
      layers: [
        { kind: 'pcb-layer', role: 'copper', children: PCB_LAYER_CONTAINER_IDS.map((id) => shape(id, 1)) },
      ],
    });
    const parsedIds = children(doc, 'copper').map((node) => node.id);
    expect(parsedIds).toEqual(PCB_LAYER_CONTAINER_IDS.map((id) => `${id}-2`));
  });

  it('de-duplicates ids ACROSS stacks deterministically (one shared allocator, front first)', () => {
    const payload = {
      version: 6,
      app: 'zpd',
      layers: [{ kind: 'pcb-layer', role: 'copper', children: [shape('dup', 1)] }],
      backLayers: [
        { kind: 'pcb-layer', role: 'copper', children: [shape('dup', 1), shape('dup-2', 1)] },
      ],
    };
    const first = parsePanelConfig(payload);
    const second = parsePanelConfig(payload);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(children(first, 'copper').map((node) => node.id)).toEqual(['dup']);
    expect(backChildren(first, 'copper').map((node) => node.id)).toEqual(['dup-3', 'dup-2']);
  });
});

describe('ordinary fragment parsing contracts', () => {
  it('defensively parses an ordinary fragment without role partitioning', () => {
    const parsed = parseLayerNodeFragment([
      group('g', [shape('same', 0), shape('same', 2)]),
      { type: 'unknown' },
    ]);
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as GroupNode).children.map((node) => node.id)).toEqual(['same', 'same-2']);
  });

  it('never lets a fragment node claim a structural id from either side', () => {
    const parsed = parseLayerNodeFragment([
      shape('pcb-layer-copper', 1),
      shape('pcb-layer-back-copper', 1),
    ]);
    expect(parsed.map((node) => node.id)).toEqual([
      'pcb-layer-copper-2',
      'pcb-layer-back-copper-2',
    ]);
  });

  it('retains rich leaf data and fallback pattern geometry through a v6 round-trip', () => {
    const parsed = parsePanelConfig({
      version: 6,
      app: 'zpd',
      panel: { hp: 8, widthMm: 999, heightMm: 999 },
      layers: [
        {
          kind: 'pcb-layer',
          role: 'copper',
          children: [
            {
              id: 'pattern',
              name: 'Pattern',
              type: 'pattern',
              patternType: 'dot-grid',
              params: { pitch: 5, invalid: 'drop' },
              color: 1,
            },
          ],
        },
        {
          kind: 'pcb-layer',
          role: 'silkscreen',
          children: [
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
        },
      ],
      guides: [{ orientation: 'vertical', position: 3, hidden: true }],
    });
    const pattern = children(parsed, 'copper')[0];
    expect(pattern).toMatchObject({
      id: 'pattern',
      params: { pitch: 5 },
      ...patternCoverGeometry({ widthMm: panelWidthMm(8), heightMm: panelHeightMm('3U') }),
    });
    expect(children(parsed, 'silkscreen')[0]).toMatchObject({
      id: 'path',
      points: [{ x: 1, y: 2, hin: { x: 0, y: 2 }, hout: { x: 2, y: 2 } }],
      extraSubpaths: [[{ x: 3, y: 4 }]],
    });
    expect(parsed.guides).toEqual([
      { id: 'guide-1', orientation: 'vertical', position: 3, hidden: true },
    ]);
    expect(parsePanelConfig(JSON.parse(JSON.stringify(serializePanelConfig(parsed))))).toEqual(
      parsed,
    );
  });
});
