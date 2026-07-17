// Versioned config export — the stage-1 deliverable: the user downloads this
// JSON and orders a panel with it. hp + layer data are authoritative; the
// panel.widthMm/heightMm and palette name fields are derived/advisory OUTPUT
// for the human/order reader, not re-trusted on the way back in.
//
// parsePanelConfig NEVER throws: it is fed whatever JSON a user hand-edited
// or an old/foreign tool produced, so every field is defended individually
// (clamped, defaulted, or dropped) rather than letting one bad field fail
// the whole document.
import { createDefaultDoc, DEFAULT_PANEL_HP } from './default-doc';
import { PALETTE } from './palette';
import { PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { mintId } from './types';
import type {
  ColorIndex,
  DocState,
  Guide,
  ImageLayer,
  Layer,
  PathLayer,
  PathPoint,
  PatternLayer,
  ShapeLayer,
  TextLayer,
} from './types';

// v2 adds the top-level `guides` array. v1 configs (and any config missing
// `guides`) still parse cleanly — parsePanelConfig defaults them to []. The
// version is emitted for the human/order reader; parsePanelConfig does not
// branch on it (every field defends itself), so old files load without a
// dedicated migration path.
export const PANEL_CONFIG_VERSION = 2;

export interface PanelConfig {
  version: 2;
  app: 'zpd';
  panel: { hp: number; widthMm: number; heightMm: number };
  palette: string[];
  layers: Layer[];
  guides: Guide[];
}

export function serializePanelConfig(doc: DocState): PanelConfig {
  return {
    version: PANEL_CONFIG_VERSION,
    app: 'zpd',
    panel: {
      hp: doc.panelHp,
      widthMm: panelWidthMm(doc.panelHp),
      heightMm: PANEL_HEIGHT_MM,
    },
    palette: PALETTE.map((entry) => entry.name),
    layers: doc.layers,
    guides: doc.guides,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// Out-of-range/invalid color indexes clamp to 0 (black) rather than reject.
function colorIndex(value: unknown): ColorIndex {
  return value === 0 || value === 1 || value === 2 ? value : 0;
}

function handle(value: unknown): { x: number; y: number } | undefined {
  if (!isPlainObject(value)) return undefined;
  const x = optionalNum(value.x);
  const y = optionalNum(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function point(value: unknown): PathPoint | null {
  if (!isPlainObject(value)) return null;
  const parsed: PathPoint = { x: num(value.x, 0), y: num(value.y, 0) };
  const hin = handle(value.hin);
  if (hin) parsed.hin = hin;
  const hout = handle(value.hout);
  if (hout) parsed.hout = hout;
  return parsed;
}

function subpath(value: unknown): PathPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map(point).filter((p): p is PathPoint => p !== null);
}

function parseParams(value: unknown): Record<string, number> {
  if (!isPlainObject(value)) return {};
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isFinite(v)) params[key] = v;
  }
  return params;
}

interface ParsedBase {
  id: string;
  name: string;
  hidden?: boolean;
}

function parseBase(value: Record<string, unknown>): ParsedBase {
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : mintId('layer');
  const name = str(value.name, '');
  const hidden = optionalBool(value.hidden);
  return hidden === undefined ? { id, name } : { id, name, hidden };
}

// Out-of-range hp (missing, non-numeric, non-finite, <= 0) falls back to the
// default doc's panel size rather than propagating a nonsensical dimension.
function parseHp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_PANEL_HP;
}

function parseLayer(value: unknown): Layer | null {
  if (!isPlainObject(value)) return null;
  const base = parseBase(value);

  switch (value.type) {
    case 'shape': {
      const layer: ShapeLayer = {
        ...base,
        type: 'shape',
        shape: value.shape === 'ellipse' ? 'ellipse' : 'rect',
        x: num(value.x, 0),
        y: num(value.y, 0),
        width: num(value.width, 0),
        height: num(value.height, 0),
        color: colorIndex(value.color),
      };
      const rotation = optionalNum(value.rotation);
      return rotation === undefined ? layer : { ...layer, rotation };
    }
    case 'pattern': {
      // patternType is kept verbatim even when unrecognized — core has no
      // dependency on the patterns registry that would validate it.
      const layer: PatternLayer = {
        ...base,
        type: 'pattern',
        patternType: str(value.patternType, 'unknown'),
        params: parseParams(value.params),
        color: colorIndex(value.color),
      };
      return layer;
    }
    case 'path': {
      const points = subpath(value.points);
      // Preserve presence/absence of extraSubpaths (even an empty array)
      // rather than normalizing it away, so round-tripping stays exact.
      const extraSubpaths = Array.isArray(value.extraSubpaths)
        ? value.extraSubpaths.map(subpath)
        : undefined;
      const layer: PathLayer = {
        ...base,
        type: 'path',
        points,
        closed: value.closed === true,
        fill: value.fill === null ? null : colorIndex(value.fill),
        stroke: value.stroke === null ? null : colorIndex(value.stroke),
        strokeWidth: num(value.strokeWidth, 0),
      };
      return extraSubpaths === undefined ? layer : { ...layer, extraSubpaths };
    }
    case 'text': {
      const layer: TextLayer = {
        ...base,
        type: 'text',
        content: str(value.content, ''),
        fontFamily: str(value.fontFamily, ''),
        sizeMm: num(value.sizeMm, 0),
        x: num(value.x, 0),
        y: num(value.y, 0),
        color: colorIndex(value.color),
      };
      const rotation = optionalNum(value.rotation);
      return rotation === undefined ? layer : { ...layer, rotation };
    }
    case 'image': {
      const layer: ImageLayer = {
        ...base,
        type: 'image',
        src: str(value.src, ''),
        x: num(value.x, 0),
        y: num(value.y, 0),
        width: num(value.width, 0),
        height: num(value.height, 0),
      };
      return layer;
    }
    default:
      // Unrecognized layer `type` — drop it rather than guess its shape.
      return null;
  }
}

// A guide needs a valid orientation and a finite numeric position; anything
// else is dropped rather than defaulted, so a malformed `guides` entry can't
// silently plant a bogus 0mm line. A missing id is stamped (same policy as
// layers) so downstream UI can key on it.
function parseGuide(value: unknown): Guide | null {
  if (!isPlainObject(value)) return null;
  const orientation =
    value.orientation === 'horizontal' || value.orientation === 'vertical'
      ? value.orientation
      : null;
  if (orientation === null) return null;
  const position = optionalNum(value.position);
  if (position === undefined) return null;
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : mintId('guide');
  const hidden = optionalBool(value.hidden);
  const guide: Guide = { id, orientation, position };
  return hidden === undefined ? guide : { ...guide, hidden };
}

// Missing or non-array `guides` (v1 / hand-edited configs) -> []. Malformed
// entries are individually dropped.
function parseGuides(value: unknown): Guide[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseGuide).filter((guide): guide is Guide => guide !== null);
}

// Never throws: garbage/non-object input yields the safe default document;
// every field below is defended individually so one bad value can't sink
// the rest of the document.
export function parsePanelConfig(input: unknown): DocState {
  if (!isPlainObject(input)) return createDefaultDoc();

  const panel = isPlainObject(input.panel) ? input.panel : undefined;
  const hp = parseHp(input.hp ?? panel?.hp);

  const layers = Array.isArray(input.layers)
    ? input.layers.map(parseLayer).filter((layer): layer is Layer => layer !== null)
    : [];

  return { panelHp: hp, layers, guides: parseGuides(input.guides) };
}
