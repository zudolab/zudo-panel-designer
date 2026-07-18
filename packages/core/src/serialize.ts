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
import { MAX_PANEL_HP, PANEL_HEIGHT_MM, panelWidthMm } from './panel-sizes';
import { MAX_PATTERN_SIZE_MM, patternCoverGeometry } from './pattern-geometry';
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

// v2 added the top-level `guides` array; v3 adds pattern square geometry
// (x/y/size on pattern layers, #96). The v3 bump is a COMPATIBILITY GATE, not
// just documentation: an older app's strict version check (tryParsePanelConfig)
// must reject a v3 file, because its parser would silently drop x/y/size and
// reinterpret a MOVED pattern as a panel-wide fill. parsePanelConfig still
// does not branch on the version (every field defends itself): a v1/v2 config
// simply has no pattern geometry, and the same missing-field defense that
// covers a malformed v3 file gives it cover-default geometry — see
// parsePatternGeometry.
export const PANEL_CONFIG_VERSION = 3;

export interface PanelConfig {
  version: 3;
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

interface PanelDimsMm {
  widthMm: number;
  heightMm: number;
}

// Pattern square geometry (#96). v1/v2 configs carry no x/y/size at all, and a
// hand-edited v3 file may carry broken values — both degrade the same way:
// a missing/non-finite/non-positive `size` falls back to the cover size, then
// a missing/non-finite `x`/`y` centers the RESULTING size on the panel. A full
// v1/v2 migration is therefore exactly "cover geometry via the helper". A
// finite but absurd size is clamped to MAX_PATTERN_SIZE_MM — generators loop
// over the whole span, so an unbounded size is a freeze-on-open DoS vector.
//
// NOTE the migration contract: cover geometry preserves the panel COVERAGE and
// the pattern's CENTER (centeredStart pins one lattice tick to the draw span's
// center, which cover placement keeps at the panel center) — it does NOT
// preserve exact pixel phase. A lattice-parity/centerY-dependent generator may
// shift by a sub-pitch amount because the draw span changes from the panel
// rect to the square.
function parsePatternGeometry(
  value: Record<string, unknown>,
  panel: PanelDimsMm,
): { x: number; y: number; size: number } {
  const cover = patternCoverGeometry(panel);
  const rawSize = optionalNum(value.size);
  const size =
    rawSize !== undefined && rawSize > 0 ? Math.min(rawSize, MAX_PATTERN_SIZE_MM) : cover.size;
  return {
    x: optionalNum(value.x) ?? (panel.widthMm - size) / 2,
    y: optionalNum(value.y) ?? (panel.heightMm - size) / 2,
    size,
  };
}

function parseBase(value: Record<string, unknown>): ParsedBase {
  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : mintId('layer');
  const name = str(value.name, '');
  const hidden = optionalBool(value.hidden);
  return hidden === undefined ? { id, name } : { id, name, hidden };
}

// Invalid/non-positive hp falls back to the default; finite positive hp is
// bounded by the largest product size before any dimensions are derived.
function parseHp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_PANEL_HP)
    : DEFAULT_PANEL_HP;
}

function parseLayer(value: unknown, panel: PanelDimsMm): Layer | null {
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
        ...parsePatternGeometry(value, panel),
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
  // hp is sanitized FIRST and the panel dims the pattern-geometry defense
  // needs are DERIVED from it — the serialized panel.widthMm/heightMm are
  // advisory output (see header) and are never re-trusted on the way in.
  const hp = parseHp(input.hp ?? panel?.hp);
  const panelDims: PanelDimsMm = { widthMm: panelWidthMm(hp), heightMm: PANEL_HEIGHT_MM };

  const layers = Array.isArray(input.layers)
    ? input.layers
        .map((entry) => parseLayer(entry, panelDims))
        .filter((layer): layer is Layer => layer !== null)
    : [];

  return { panelHp: hp, layers, guides: parseGuides(input.guides) };
}

export type TryParsePanelConfigResult = { ok: true; doc: DocState } | { ok: false; reason: string };

// Oldest PANEL_CONFIG_VERSION this app has ever emitted — v1 predates the
// `guides` field but is otherwise a valid envelope.
const MIN_PANEL_CONFIG_VERSION = 1;

// STRICT envelope check, unlike parsePanelConfig above (which never fails —
// it turns garbage into a default doc). Import UX needs to tell "this is not
// a zpd panel config" apart from "this is a real config with a wonky field",
// so it checks only the three envelope markers (app, version range, layers
// shape) and, on success, delegates to parsePanelConfig for field-level
// defense. parsePanelConfig itself is unchanged and still never throws.
export function tryParsePanelConfig(input: unknown): TryParsePanelConfigResult {
  if (!isPlainObject(input)) return { ok: false, reason: 'not an object' };
  if (input.app !== 'zpd') return { ok: false, reason: 'not a zpd panel config (app mismatch)' };
  const version = input.version;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < MIN_PANEL_CONFIG_VERSION ||
    version > PANEL_CONFIG_VERSION
  ) {
    return { ok: false, reason: 'unsupported or missing version' };
  }
  if (!Array.isArray(input.layers)) return { ok: false, reason: 'missing layers array' };
  return { ok: true, doc: parsePanelConfig(input) };
}
