// Geometry + paint extraction for native SVG vector import (#139): walks the
// validated tree from the safety gate (#138) and emits IR shapes in document
// order, in SVG source/viewport space.
//
// Everything the importer cannot reproduce faithfully is either a warning
// (the artwork still imports, slightly simplified) or a fatal (the file falls
// back to raster import). Nothing is silently approximated -- a stroke under
// a nonuniform scale, an unrecognized color, or a transform this parser
// cannot read all stop the vector path rather than importing wrong artwork.
import { SVGPathData, SVGShapes } from 'svg-pathdata';
import type { PathPoint, Pt } from '@zpd/core';
import { DiagnosticSink, fatal, SvgFatalError, throwFatal } from './diagnostics';
import { INITIAL_STYLE, resolvePaint, resolveStyle, type StyleState } from './resolve-style';
import {
  applyMatrix,
  IDENTITY,
  isSingular,
  multiply,
  parseTransformList,
  uniformScale,
  type Matrix,
} from './transform-matrix';
import type { IrContour, IrShape, SvgImportDiagnostic, SvgViewport } from './types';

// Bounds on the emitted IR, so a pathological document cannot produce an
// editor document that is unusable (or a browser tab that hangs rendering
// it). The safety gate already caps element count; these cap the geometry
// those elements expand into.
const MAX_COMMANDS = 100_000;
const MAX_CONTOURS = 2_000;
const MAX_ANCHORS = 100_000;
const MAX_COLORS = 24;

// Implicit-closure coincidence threshold. Deliberately tight and applied in
// SOURCE space (before the transform is baked in): a scale(4) would otherwise
// inflate the gap between the two points being compared, so the same artwork
// would dedupe or not depending on its transform.
const CLOSE_EPSILON = 1e-9;

const NON_RENDERING = new Set(['defs', 'title', 'desc', 'metadata']);
const CONTAINERS = new Set(['svg', 'g']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

const NUMBER_TOKEN = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px)?$/;

// Unitless or "px" only: everything in this module lives in the SVG
// coordinate space, and a percentage or a physical unit would need viewport /
// DPI resolution the importer does not implement.
function parseLength(raw: string, what: string): number {
  const match = raw.trim().match(LENGTH);
  if (!match) {
    throwFatal('unsupported-unit', `${what} must be unitless or "px", got "${raw}".`);
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throwFatal('invalid-number', `${what} is not a finite number: "${raw}".`);
  }
  return value;
}

function lengthAttr(el: Element, name: string, fallback = 0): number {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === '') return fallback;
  return parseLength(raw, `<${el.localName}> "${name}"`);
}

// Tokenizes a coordinate list the way SVG does -- "1,2-3,4" is three
// separators and four numbers, not a "2-3" token.
function parseNumberList(raw: string, what: string): number[] {
  const tokens = raw.match(NUMBER_TOKEN) ?? [];
  if (/[^\s,]/.test(raw.replace(NUMBER_TOKEN, ' '))) {
    throwFatal('invalid-path-data', `${what} contains an unreadable value: "${raw}".`);
  }
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throwFatal('invalid-number', `${what} contains a non-finite number.`);
  }
  return values;
}

function pointsAttr(el: Element): number[] {
  const coords = parseNumberList(el.getAttribute('points') ?? '', `<${el.localName}> "points"`);
  if (coords.length % 2 !== 0) {
    throwFatal('invalid-path-data', `<${el.localName}> "points" has an odd coordinate count.`);
  }
  return coords;
}

// rx/ry "auto" behaviour: a missing radius mirrors the other one, and both
// missing means square corners. SVGShapes.createRect clamps to half the
// width/height from there.
function rectRadii(el: Element): { rx: number; ry: number } {
  const rxRaw = el.getAttribute('rx');
  const ryRaw = el.getAttribute('ry');
  const rx = rxRaw !== null ? Math.max(0, lengthAttr(el, 'rx')) : null;
  const ry = ryRaw !== null ? Math.max(0, lengthAttr(el, 'ry')) : null;
  return { rx: rx ?? ry ?? 0, ry: ry ?? rx ?? 0 };
}

// Converts one element to path data. Returns null when the element renders
// nothing at all (zero-size rect, r="0" circle, empty `points`) -- that is
// valid SVG, not an error.
function shapePathData(el: Element): SVGPathData | null {
  switch (el.localName) {
    case 'path': {
      const d = el.getAttribute('d');
      if (!d || d.trim() === '') return null;
      try {
        return new SVGPathData(d);
      } catch {
        return throwFatal(
          'invalid-path-data',
          `<path> has unreadable path data: "${d.slice(0, 80)}".`,
        );
      }
    }
    case 'rect': {
      const width = lengthAttr(el, 'width');
      const height = lengthAttr(el, 'height');
      if (width <= 0 || height <= 0) return null;
      const { rx, ry } = rectRadii(el);
      return SVGShapes.createRect(lengthAttr(el, 'x'), lengthAttr(el, 'y'), width, height, rx, ry);
    }
    case 'circle': {
      const r = lengthAttr(el, 'r');
      if (r <= 0) return null;
      return SVGShapes.createEllipse(r, r, lengthAttr(el, 'cx'), lengthAttr(el, 'cy'));
    }
    case 'ellipse': {
      const rx = lengthAttr(el, 'rx');
      const ry = lengthAttr(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      return SVGShapes.createEllipse(rx, ry, lengthAttr(el, 'cx'), lengthAttr(el, 'cy'));
    }
    case 'line':
      return SVGShapes.createPolyline([
        lengthAttr(el, 'x1'),
        lengthAttr(el, 'y1'),
        lengthAttr(el, 'x2'),
        lengthAttr(el, 'y2'),
      ]);
    case 'polyline': {
      const coords = pointsAttr(el);
      return coords.length >= 4 ? SVGShapes.createPolyline(coords) : null;
    }
    case 'polygon': {
      const coords = pointsAttr(el);
      return coords.length >= 4 ? SVGShapes.createPolygon(coords) : null;
    }
    default:
      return null;
  }
}

interface Contour {
  points: PathPoint[];
  closed: boolean;
}

function assertFinite(...values: number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throwFatal('invalid-number', 'Path data contains a non-finite coordinate.');
  }
}

// Drops a closing anchor that merely repeats the start point, moving its
// incoming handle onto the start point so the curve into the join survives.
// Mirrors the dedup in svg-to-path-layers.ts, and runs in source space.
function dedupeClosingPoint(points: PathPoint[]): PathPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) >= CLOSE_EPSILON || Math.abs(first.y - last.y) >= CLOSE_EPSILON) {
    return points;
  }
  const head: PathPoint = { ...first, ...(last.hin ? { hin: last.hin } : {}) };
  return [head, ...points.slice(1, -1)];
}

// One shared normalization for every shape: arcs and quadratics become cubics,
// H/V become lines, and shorthand curves are expanded -- leaving only
// MOVE_TO/LINE_TO/CURVE_TO/CLOSE_PATH. normalizeHVZ(false) is load-bearing:
// the default rewrites Z into a line back to the start and drops CLOSE_PATH,
// which would turn every closed shape into an open one.
function toContours(data: SVGPathData): Contour[] {
  let normalized: SVGPathData;
  try {
    normalized = data.toAbs().aToC().normalizeST().qtToC().normalizeHVZ(false);
  } catch {
    // Parsing succeeded but a command could not be normalized (a degenerate
    // arc, a shorthand curve with no preceding curve, ...).
    throwFatal('invalid-path-data', 'Path data could not be normalized.');
  }
  const contours: Contour[] = [];
  let current: Contour | null = null;
  for (const cmd of normalized.commands) {
    if (cmd.type === SVGPathData.MOVE_TO) {
      assertFinite(cmd.x, cmd.y);
      current = { points: [{ x: cmd.x, y: cmd.y }], closed: false };
      contours.push(current);
    } else if (!current) {
      continue;
    } else if (cmd.type === SVGPathData.LINE_TO) {
      assertFinite(cmd.x, cmd.y);
      current.points.push({ x: cmd.x, y: cmd.y });
    } else if (cmd.type === SVGPathData.CURVE_TO) {
      assertFinite(cmd.x, cmd.y, cmd.x1, cmd.y1, cmd.x2, cmd.y2);
      current.points[current.points.length - 1].hout = { x: cmd.x1, y: cmd.y1 };
      current.points.push({ x: cmd.x, y: cmd.y, hin: { x: cmd.x2, y: cmd.y2 } });
    } else if (cmd.type === SVGPathData.CLOSE_PATH) {
      current.closed = true;
      current.points = dedupeClosingPoint(current.points);
    }
  }
  return contours.filter((contour) => contour.points.length >= 2);
}

// SVG fill implicitly closes an open subpath; stroke does not. Running the
// same dedup an explicit Z gets is what makes "...d" and "...dZ" produce
// identical IR.
function closeForFill(contour: Contour): Contour {
  if (contour.closed) return contour;
  return { points: dedupeClosingPoint(contour.points), closed: true };
}

function transformPoint(m: Matrix, point: PathPoint): PathPoint {
  const moved: PathPoint = applyMatrix(m, point);
  if (point.hin) moved.hin = applyMatrix(m, point.hin) as Pt;
  if (point.hout) moved.hout = applyMatrix(m, point.hout) as Pt;
  return moved;
}

// Handles are absolute coordinates in zpd's PathPoint, so they go through the
// full affine exactly like the anchors do -- baking a transform into the
// anchors alone would shear every curve.
function toIrContours(contours: Contour[], m: Matrix): IrContour[] {
  return contours
    .filter((contour) => contour.points.length >= 2)
    .map((contour) => ({
      points: contour.points.map((point) => transformPoint(m, point)),
      closed: contour.closed,
    }));
}

interface ExtractState {
  sink: DiagnosticSink;
  shapes: IrShape[];
  sourceColors: string[];
  ordinals: Map<string, number>;
  commands: number;
  contours: number;
  anchors: number;
}

function chargeQuota(state: ExtractState, commands: number, contours: Contour[]): void {
  state.commands += commands;
  state.contours += contours.length;
  state.anchors += contours.reduce((sum, contour) => sum + contour.points.length, 0);
  if (
    state.commands > MAX_COMMANDS ||
    state.contours > MAX_CONTOURS ||
    state.anchors > MAX_ANCHORS
  ) {
    throwFatal(
      'quota-exceeded',
      `SVG geometry exceeds the import quota (max ${MAX_COMMANDS} commands, ${MAX_CONTOURS} contours, ${MAX_ANCHORS} anchors).`,
    );
  }
}

function registerColor(state: ExtractState, hex: string): void {
  if (state.sourceColors.includes(hex)) return;
  if (state.sourceColors.length >= MAX_COLORS) {
    throwFatal('too-many-colors', `SVG uses more than ${MAX_COLORS} colors.`);
  }
  state.sourceColors.push(hex);
}

// Layer name: the element's own id when it has a usable one (authoring tools
// and hand-written SVG both name meaningful shapes), else a per-element-type
// ordinal so the layer list stays readable.
function shapeName(el: Element, state: ExtractState): string {
  const ordinal = (state.ordinals.get(el.localName) ?? 0) + 1;
  state.ordinals.set(el.localName, ordinal);
  const id = (el.getAttribute('id') ?? '')
    .replace(/\p{C}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return id || `${el.localName} ${ordinal}`;
}

// A resolved, renderable paint: null once the paint is absent (`none`) or
// disabled (alpha 0).
function paintHex(
  state: ExtractState,
  value: string,
  style: StyleState,
  opacityValue: string,
  opacityProperty: string,
): string | null {
  const paint = resolvePaint(value, style, opacityValue, opacityProperty);
  if (!paint || paint.alpha === 0) return null;
  if (paint.alpha < 1) {
    state.sink.warn(
      'opacity-ignored',
      'Partially transparent paint was imported as its fully opaque color.',
    );
  }
  registerColor(state, paint.hex);
  return paint.hex;
}

const DEFAULT_STROKE_STYLE: Readonly<Record<string, string>> = {
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: '4',
};

function warnStrokeStyle(state: ExtractState, style: StyleState): void {
  for (const [key, initial] of Object.entries(DEFAULT_STROKE_STYLE)) {
    if ((style as unknown as Record<string, string>)[key].toLowerCase() !== initial) {
      state.sink.warn(
        'stroke-style-ignored',
        'Stroke cap/join/miter settings are ignored; strokes import with the editor defaults.',
      );
      return;
    }
  }
}

function pushShape(
  state: ExtractState,
  name: string,
  contours: IrContour[],
  fillHex: string | null,
  strokeHex: string | null,
  strokeWidth: number,
): void {
  state.shapes.push({ name, contours, fillHex, strokeHex, strokeWidth });
}

function emitShape(el: Element, style: StyleState, matrix: Matrix, state: ExtractState): void {
  const name = shapeName(el, state);
  const data = shapePathData(el);
  if (!data) {
    state.sink.warn('empty-geometry-skipped', `An empty <${el.localName}> was skipped.`);
    return;
  }
  const commandCount = data.commands.length;
  const contours = toContours(data);
  if (contours.length === 0) {
    state.sink.warn('empty-geometry-skipped', `An empty <${el.localName}> was skipped.`);
    return;
  }
  chargeQuota(state, commandCount, contours);
  // Checked before the paints are resolved, so an invisible shape does not
  // contribute its colors to sourceColors.
  if (isSingular(matrix)) {
    state.sink.warn(
      'degenerate-transform-skipped',
      `A <${el.localName}> collapsed to zero size by its transform was skipped.`,
    );
    return;
  }

  // SVG rule: <line> has no interior, so it is never filled regardless of the
  // cascaded fill.
  let fillHex =
    el.localName === 'line'
      ? null
      : paintHex(state, style.fill, style, style.fillOpacity, 'fill-opacity');
  let strokeHex = paintHex(state, style.stroke, style, style.strokeOpacity, 'stroke-opacity');
  // Only read when a stroke is actually painted: an unused stroke-width (a
  // leftover "0.5mm" on an unstroked shape) must not fail the whole import.
  let sourceStrokeWidth = 0;
  if (strokeHex) {
    sourceStrokeWidth = parseLength(style.strokeWidth, `<${el.localName}> "stroke-width"`);
    if (sourceStrokeWidth <= 0) strokeHex = null;
  }

  if (!fillHex && !strokeHex) {
    state.sink.warn(
      'unpainted-shape-skipped',
      `A <${el.localName}> with neither fill nor stroke was skipped.`,
    );
    return;
  }

  let strokeWidth = 0;
  if (strokeHex) {
    // zpd carries one scalar stroke width, so only a similarity transform can
    // be baked into a stroked shape -- under a nonuniform scale or a skew the
    // stroke would have to vary along the outline.
    const scale = uniformScale(matrix);
    if (scale === null) {
      throwFatal(
        'nonuniform-stroke',
        `A stroked <${el.localName}> is under a nonuniform scale or skew, which cannot be represented by a single stroke width.`,
      );
    }
    strokeWidth = sourceStrokeWidth * scale;
    warnStrokeStyle(state, style);
  }

  const strokeContours = toIrContours(contours, matrix);
  const fillContours = fillHex ? toIrContours(contours.map(closeForFill), matrix) : [];
  if (fillHex && fillContours.length === 0) fillHex = null;

  if (fillHex && fillContours.length > 1 && style.fillRule.trim().toLowerCase() !== 'evenodd') {
    // zpd renders paths evenodd. Holes still come out as holes (opposite
    // winding), but same-winding overlaps differ from a nonzero renderer --
    // the import dialog's preview shows what the user will actually get.
    state.sink.warn(
      'nonzero-compound',
      'A compound shape using fill-rule "nonzero" was imported as "evenodd"; overlapping areas may differ.',
    );
  }

  const allClosed = contours.every((contour) => contour.closed);
  if (fillHex && strokeHex && !allClosed) {
    // SVG paints fill under stroke; keeping that order matters because the
    // fill copy is closed while the stroke copy keeps the authored open ends.
    pushShape(state, `${name} fill`, fillContours, fillHex, null, 0);
    pushShape(state, `${name} stroke`, strokeContours, null, strokeHex, strokeWidth);
    return;
  }
  if (fillHex) {
    pushShape(state, name, fillContours, fillHex, strokeHex, strokeHex ? strokeWidth : 0);
    return;
  }
  pushShape(state, name, strokeContours, null, strokeHex, strokeWidth);
}

function isHidden(style: StyleState): boolean {
  const visibility = style.visibility.trim().toLowerCase();
  return visibility === 'hidden' || visibility === 'collapse';
}

function walk(el: Element, parentStyle: StyleState, parentMatrix: Matrix, state: ExtractState) {
  if (NON_RENDERING.has(el.localName)) return;
  if (!CONTAINERS.has(el.localName) && !SHAPES.has(el.localName)) return;

  const style = resolveStyle(el, parentStyle, state.sink);
  // v1 simplification: a hidden subtree is skipped outright, so a descendant
  // cannot re-show itself with visibility="visible".
  if (isHidden(style)) {
    state.sink.warn(
      'invisible-content-skipped',
      `A hidden (visibility) <${el.localName}> was skipped.`,
    );
    return;
  }
  if (style.opacity === 0) {
    state.sink.warn(
      'invisible-content-skipped',
      `A fully transparent <${el.localName}> was skipped.`,
    );
    return;
  }

  const transform = el.getAttribute('transform');
  let matrix = parentMatrix;
  if (transform !== null && transform.trim() !== '') {
    const own = parseTransformList(transform);
    if (!own) {
      throwFatal('invalid-transform', `Unreadable transform: "${transform}".`);
    }
    matrix = multiply(parentMatrix, own);
  }

  if (CONTAINERS.has(el.localName)) {
    for (const child of Array.from(el.children)) walk(child, style, matrix, state);
    return;
  }
  emitShape(el, style, matrix, state);
}

export interface ExtractResult {
  shapes: IrShape[];
  sourceColors: string[];
}

// Walks the validated tree and emits IR shapes in document order. Diagnostics
// are appended to `diagnostics`; a fatal one means the caller must discard the
// result and fall back to raster import (see analyze-svg.ts). No exception
// escapes -- an unexpected one becomes a fatal diagnostic too, because a
// thrown error here would take down the whole import dialog.
export function extractShapes(
  root: Element,
  // Part of the analyzer contract, deliberately unused: extraction stays in
  // raw source coordinates (the layer builder is what maps them into the
  // document), and the one thing a viewport would be needed for -- resolving
  // percentage lengths -- is a fatal here instead.
  _viewport: SvgViewport,
  diagnostics: SvgImportDiagnostic[],
): ExtractResult {
  const state: ExtractState = {
    sink: new DiagnosticSink(diagnostics),
    shapes: [],
    sourceColors: [],
    ordinals: new Map(),
    commands: 0,
    contours: 0,
    anchors: 0,
  };

  try {
    walk(root, INITIAL_STYLE, IDENTITY, state);
  } catch (error) {
    diagnostics.push(
      error instanceof SvgFatalError
        ? error.diagnostic
        : fatal('extract-failed', `SVG geometry could not be read: ${String(error)}`),
    );
    return { shapes: [], sourceColors: [] };
  }
  return { shapes: state.shapes, sourceColors: state.sourceColors };
}
