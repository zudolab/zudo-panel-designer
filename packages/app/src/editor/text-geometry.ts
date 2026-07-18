// Canonical render-only text geometry. Rotated text cannot use a newly
// measured fallback/loaded bbox as its transform pivot: changing font metrics
// would make the layer visibly jump. This cache captures that pivot once and
// recenters every later metric box on it, without ever mutating the document.
import { type Layer, type Pt, type Rect, type TextLayer } from '@zpd/core';
import {
  ensureFontAttempt,
  fontRequestKey,
  type FontAttemptStatus,
  type FontLoadAttempt,
} from './fonts';

export interface TextGeometry {
  readonly box: Rect;
  readonly pivot: Pt;
  readonly loading: boolean;
  readonly metricRevision: number;
  readonly documentIncarnation: number;
}

interface GeometryEntry {
  id: string;
  content: string;
  fontFamily: string;
  sizeMm: number;
  modelX: number;
  modelY: number;
  rotation: number;
  box: Rect;
  pivot: Pt;
  lastStatus: FontAttemptStatus;
  metricRevision: number;
  namespace: number;
  documentIncarnation: number;
}

interface AttemptOwner {
  attempt: FontLoadAttempt;
  requestKey: string;
  content: string;
  fontFamily: string;
  namespace: number;
  documentIncarnation: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
let measureOverride: ((layer: TextLayer) => Rect) | null = null;
let namespace = 1;
let documentIncarnation = 0;
let nextMetricRevision = 0;
let lastLayers: readonly Layer[] | null = null;
let currentLayersById = new Map<string, Layer>();
let requestRepaint: (() => void) | null = null;
const entries = new Map<string, GeometryEntry>();
const owners = new Map<string, AttemptOwner>();
let watchedAttempts = new WeakSet<FontLoadAttempt>();

function validSize(layer: TextLayer): boolean {
  return Number.isFinite(layer.sizeMm) && layer.sizeMm > 0;
}

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  return measureCtx;
}

// 1 canvas px == 1 document mm. Empty lines count toward height, including
// trailing empty lines; width is the maximum actual line width.
export function measureTextBbox(layer: TextLayer): Rect {
  if (measureOverride) return measureOverride(layer);
  const lines = layer.content.split('\n');
  const lineHeight = layer.sizeMm * 1.25;
  const ctx = getMeasureCtx();
  let width = 0;
  if (ctx) {
    ctx.font = `${layer.sizeMm}px "${layer.fontFamily}"`;
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
  } else {
    const longest = Math.max(0, ...lines.map((line) => line.length));
    width = longest * layer.sizeMm * 0.6;
  }
  return { x: layer.x, y: layer.y, width, height: lineHeight * lines.length };
}

function centeredBox(measured: Rect, pivot: Pt): Rect {
  return {
    x: pivot.x - measured.width / 2,
    y: pivot.y - measured.height / 2,
    width: measured.width,
    height: measured.height,
  };
}

function isCurrentOwner(id: string, owner: AttemptOwner): boolean {
  if (owner.namespace !== namespace || owner.documentIncarnation !== documentIncarnation) {
    return false;
  }
  const layer = currentLayersById.get(id);
  return (
    layer?.type === 'text' &&
    validSize(layer) &&
    layer.fontFamily === owner.fontFamily &&
    layer.content === owner.content &&
    fontRequestKey(layer.fontFamily, layer.content) === owner.requestKey
  );
}

function notifyAttempt(attempt: FontLoadAttempt): void {
  if (!requestRepaint) return;
  for (const [id, owner] of owners) {
    if (owner.attempt === attempt && isCurrentOwner(id, owner)) {
      // One renderer invalidation per exact attempt event, regardless of how
      // many normal/ghost frames or layers share it.
      requestRepaint();
      return;
    }
  }
}

function watchAttempt(attempt: FontLoadAttempt): void {
  if (watchedAttempts.has(attempt)) return;
  watchedAttempts.add(attempt);
  const status = attempt.getStatus();
  // A face already known ready/failed before first geometry capture needs no
  // invalidation: that first capture already used its final visual state.
  if (status === 'pending') void attempt.initial.then(() => notifyAttempt(attempt));
  if (status === 'pending' || status === 'timed-out') {
    attempt.onLateReady(() => notifyAttempt(attempt));
  }
}

function ownAttempt(layer: TextLayer, attempt: FontLoadAttempt): void {
  const owner: AttemptOwner = {
    attempt,
    requestKey: fontRequestKey(layer.fontFamily, layer.content),
    content: layer.content,
    fontFamily: layer.fontFamily,
    namespace,
    documentIncarnation,
  };
  owners.set(layer.id, owner);
  watchAttempt(attempt);
}

function createEntry(layer: TextLayer, status: FontAttemptStatus): GeometryEntry {
  const measured = measureTextBbox(layer);
  const pivot = {
    x: measured.x + measured.width / 2,
    y: measured.y + measured.height / 2,
  };
  return {
    id: layer.id,
    content: layer.content,
    fontFamily: layer.fontFamily,
    sizeMm: layer.sizeMm,
    modelX: layer.x,
    modelY: layer.y,
    rotation: layer.rotation ?? 0,
    box: measured,
    pivot,
    lastStatus: status,
    metricRevision: ++nextMetricRevision,
    namespace,
    documentIncarnation,
  };
}

function refreshLoadedMetrics(entry: GeometryEntry, layer: TextLayer): void {
  entry.box = centeredBox(measureTextBbox(layer), entry.pivot);
  entry.metricRevision = ++nextMetricRevision;
}

function reconcileEntry(entry: GeometryEntry, layer: TextLayer): boolean {
  const rotation = layer.rotation ?? 0;
  if (
    !validSize(layer) ||
    rotation === 0 ||
    layer.content !== entry.content ||
    layer.fontFamily !== entry.fontFamily
  ) {
    entries.delete(entry.id);
    owners.delete(entry.id);
    return false;
  }

  const sizeChanged = layer.sizeMm !== entry.sizeMm;
  if (sizeChanged) {
    const factor = layer.sizeMm / entry.sizeMm;
    entry.pivot = {
      x: layer.x + factor * (entry.pivot.x - entry.modelX),
      y: layer.y + factor * (entry.pivot.y - entry.modelY),
    };
    entry.box = centeredBox(measureTextBbox(layer), entry.pivot);
    entry.metricRevision = ++nextMetricRevision;
  } else if (layer.x !== entry.modelX || layer.y !== entry.modelY) {
    const dx = layer.x - entry.modelX;
    const dy = layer.y - entry.modelY;
    entry.pivot = { x: entry.pivot.x + dx, y: entry.pivot.y + dy };
    entry.box = { ...entry.box, x: entry.box.x + dx, y: entry.box.y + dy };
  }

  entry.sizeMm = layer.sizeMm;
  entry.modelX = layer.x;
  entry.modelY = layer.y;
  entry.rotation = rotation;
  entry.namespace = namespace;
  entry.documentIncarnation = documentIncarnation;
  return true;
}

// Call at every complete document snapshot boundary. Hidden text participates:
// hiding must not discard a pending pivot, while deletion/type replacement
// must immediately revoke ownership of stale async completions.
export function reconcileTextGeometry(
  layers: readonly Layer[],
  nextRequestRepaint?: () => void,
): void {
  if (nextRequestRepaint) requestRepaint = nextRequestRepaint;
  if (layers !== lastLayers) {
    lastLayers = layers;
    documentIncarnation += 1;
  }
  currentLayersById = new Map(layers.map((layer) => [layer.id, layer]));

  for (const [id, entry] of [...entries]) {
    const layer = currentLayersById.get(id);
    if (layer?.type !== 'text' || !reconcileEntry(entry, layer)) {
      entries.delete(id);
      owners.delete(id);
    }
  }

  for (const [id, owner] of [...owners]) {
    const layer = currentLayersById.get(id);
    if (
      layer?.type !== 'text' ||
      !validSize(layer) ||
      layer.fontFamily !== owner.fontFamily ||
      layer.content !== owner.content ||
      fontRequestKey(layer.fontFamily, layer.content) !== owner.requestKey
    ) {
      owners.delete(id);
      continue;
    }
    owner.namespace = namespace;
    owner.documentIncarnation = documentIncarnation;
  }
}

export function getTextGeometry(layer: TextLayer): TextGeometry | null {
  if (!validSize(layer)) {
    entries.delete(layer.id);
    owners.delete(layer.id);
    return null;
  }

  const attempt = ensureFontAttempt(layer.fontFamily, layer.content);
  ownAttempt(layer, attempt);
  const status = attempt.getStatus();
  const rotation = layer.rotation ?? 0;

  // Unrotated text has no persistent pivot to preserve. It still uses this
  // canonical result so painting, chrome, hit testing and panel culling agree.
  if (rotation === 0) {
    entries.delete(layer.id);
    const box = measureTextBbox(layer);
    return {
      box,
      pivot: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      loading: status === 'pending',
      metricRevision: ++nextMetricRevision,
      documentIncarnation,
    };
  }

  let entry = entries.get(layer.id);
  if (entry && !reconcileEntry(entry, layer)) entry = undefined;
  if (!entry) {
    entry = createEntry(layer, status);
    entries.set(layer.id, entry);
  }

  // Only a genuinely usable face changes metrics. Failure/timeout merely
  // removes the provisional alpha; a timed-out attempt can still later make
  // this one transition through late-ready.
  if (
    (status === 'ready' || status === 'late-ready') &&
    entry.lastStatus !== 'ready' &&
    entry.lastStatus !== 'late-ready'
  ) {
    refreshLoadedMetrics(entry, layer);
  }
  entry.lastStatus = status;
  entry.documentIncarnation = documentIncarnation;

  return {
    box: { ...entry.box },
    pivot: { ...entry.pivot },
    loading: status === 'pending',
    metricRevision: entry.metricRevision,
    documentIncarnation,
  };
}

export function resetTextGeometryNamespace(): void {
  namespace += 1;
  documentIncarnation = 0;
  nextMetricRevision = 0;
  lastLayers = null;
  currentLayersById.clear();
  entries.clear();
  owners.clear();
  requestRepaint = null;
}

// Read-only test/debug snapshot. Unlike getTextGeometry this never measures,
// starts a font request, or changes ownership; the browser bridge can observe
// exactly what the renderer already captured.
export function peekTextGeometry(id: string): TextGeometry | null {
  const entry = entries.get(id);
  if (!entry || entry.namespace !== namespace) return null;
  return {
    box: { ...entry.box },
    pivot: { ...entry.pivot },
    loading: entry.lastStatus === 'pending',
    metricRevision: entry.metricRevision,
    documentIncarnation: entry.documentIncarnation,
  };
}

/** Deterministic metric injection for unit tests; never used by production. */
export function setTextMeasureForTests(measure: ((layer: TextLayer) => Rect) | null): void {
  measureOverride = measure;
  measureCtx = null;
}

export function resetTextGeometryForTests(): void {
  resetTextGeometryNamespace();
  measureOverride = null;
  measureCtx = null;
  watchedAttempts = new WeakSet();
}
