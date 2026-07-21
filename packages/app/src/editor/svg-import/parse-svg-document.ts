// SVG safety gate for native vector import (#138). Turns raw SVG text into
// an inert, walked-and-validated DOM tree the follow-up IR extractor
// (#139) can trust, or a fatal SvgParseResult the caller falls back from
// (see types.ts -- every fatal here is import-as-raster-image eligible).
//
// Fail-closed throughout: the element set is an ALLOWLIST (unknown elements
// reject, they are never silently dropped and kept rendering), and the
// three attribute tiers below default to "warn and keep" only for things
// that are provably inert or provably harmless -- anything not recognized
// falls through to a warning, never a silent pass.
import type { SvgImportDiagnostic, SvgViewport } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Bounds the tree walk below so a pathological (or hostile) document can't
// make the importer hang or blow the stack -- 32 levels and 5,000 elements
// comfortably cover any real hand- or tool-authored SVG.
const MAX_DEPTH = 32;
const MAX_ELEMENTS = 5000;

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
]);

// title/desc/metadata carry no geometry; defs is a non-rendering container
// (a <use> referencing into it would already be fatal, since <use> is not
// on the allowlist). None of these get attribute-tier checks, but their
// children are still walked -- an unsupported element hidden inside <defs>
// must still be caught.
const SKIP_ATTRIBUTE_CHECK = new Set(['title', 'desc', 'metadata', 'defs']);

// Attributes read downstream by the IR extractor (#139) -- recognized and
// left alone, no diagnostic. Anything not in this set and not one of the
// inert/fatal tiers below falls through to the generic "attribute-ignored"
// warning: it genuinely has no effect on the resulting import.
const CONSUMED_ATTRS = new Set([
  'd',
  'points',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'fill',
  'stroke',
  'stroke-width',
  'viewbox',
  'transform',
]);

// Fatal regardless of value: visually-significant semantics this importer
// does not implement (no filter graph, no clip/mask compositing, no marker
// rendering).
const UNSUPPORTED_SEMANTIC_ATTRS = new Set([
  'filter',
  'mask',
  'clip-path',
  'marker-start',
  'marker-mid',
  'marker-end',
  'vector-effect',
  'stroke-dasharray',
]);

// Fatal only when the value references an external resource via url(...) --
// these attributes are otherwise fine (a plain color on fill/stroke, or a
// marker shorthand naming nothing).
const URL_CHECKED_ATTRS = new Set(['fill', 'stroke', 'marker']);

const URL_VALUE = /url\(/i;
// style can set the same unsupported properties via CSS, not just the
// attribute form (e.g. style="clip-path: circle(50%)") -- checked the same
// way the attribute form is, so the CSS route isn't a bypass.
const STYLE_UNSUPPORTED_PROP = new RegExp(
  `(?:^|;)\\s*(${[...UNSUPPORTED_SEMANTIC_ATTRS].join('|')})\\s*:`,
  'i',
);

function fatal(code: string, message: string): SvgImportDiagnostic {
  return { level: 'fatal', code, message };
}

function warning(code: string, message: string): SvgImportDiagnostic {
  return { level: 'warning', code, message };
}

export type SvgParseResult =
  | { status: 'ok'; root: Element; diagnostics: SvgImportDiagnostic[]; viewport: SvgViewport }
  | { status: 'fatal'; diagnostics: SvgImportDiagnostic[] };

// Real XML parsers (and jsdom, verified) do not reject a DOCTYPE/ENTITY
// declaration on their own for image/svg+xml -- entity expansion (billion
// laughs, XXE-style file/network refs via ENTITY) has to be rejected before
// any parser touches the text at all. Any processing instruction other than
// the XML declaration is rejected the same way: fail-closed, not "if we
// happen to know it's dangerous".
function preParseReject(text: string): SvgImportDiagnostic | null {
  if (text.includes('<!DOCTYPE') || text.includes('<!ENTITY')) {
    return fatal('doctype-or-entity', 'SVG contains a DOCTYPE or ENTITY declaration.');
  }
  if (/<\?(?!xml[\s?])[\s\S]*?\?>/.test(text)) {
    return fatal(
      'doctype-or-entity',
      'SVG contains a processing instruction other than the XML declaration.',
    );
  }
  return null;
}

function isDisplayNone(el: Element): boolean {
  if (el.getAttribute('display') === 'none') return true;
  const style = el.getAttribute('style');
  return !!style && /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(style);
}

function isInertAttr(name: string): boolean {
  return (
    name === 'id' ||
    name === 'class' || // inert: <style> is already fatal, so no CSS selector can reach it
    name === 'version' ||
    name === 'role' ||
    name.startsWith('data-') ||
    name.startsWith('aria-') ||
    name === 'xmlns' ||
    name.startsWith('xmlns:') ||
    name.startsWith('xml:') ||
    name.startsWith('inkscape:') ||
    name.startsWith('sodipodi:')
  );
}

// Returns a fatal diagnostic to short-circuit the walk, or null having
// pushed zero or more warnings onto `diagnostics`.
function checkAttributes(
  el: Element,
  diagnostics: SvgImportDiagnostic[],
): SvgImportDiagnostic | null {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    if (name.startsWith('on')) {
      return fatal('unsafe-attribute', `Event handler attribute "${attr.name}" is not allowed.`);
    }
    if (name === 'href' || name === 'xlink:href') {
      if (!value.startsWith('#')) {
        return fatal(
          'unsafe-attribute',
          `"${attr.name}" must be a local "#id" reference, got "${value}".`,
        );
      }
      continue;
    }
    if (UNSUPPORTED_SEMANTIC_ATTRS.has(name)) {
      return fatal('unsupported-attribute', `Attribute "${attr.name}" is not supported.`);
    }
    if (name === 'style') {
      if (URL_VALUE.test(value)) {
        return fatal('unsafe-attribute', '"style" must not reference url(...).');
      }
      if (STYLE_UNSUPPORTED_PROP.test(value)) {
        return fatal('unsupported-attribute', '"style" sets an unsupported property.');
      }
      continue;
    }
    if (URL_CHECKED_ATTRS.has(name) && URL_VALUE.test(value)) {
      return fatal('unsafe-attribute', `"${attr.name}" must not reference url(...).`);
    }
    if (isInertAttr(name) || CONSUMED_ATTRS.has(name)) continue;

    diagnostics.push(warning('attribute-ignored', `Attribute "${attr.name}" is ignored.`));
  }
  return null;
}

interface WalkState {
  elementCount: number;
}

// Depth-first walk enforcing, in order: the depth/element quota, the
// display:none prune (before any unsafe-feature check runs on a subtree
// that will never render), the element allowlist, then the attribute
// tiers. Returns a fatal diagnostic to short-circuit the whole parse, or
// null having pushed zero or more warnings.
function walkElement(
  el: Element,
  depth: number,
  state: WalkState,
  diagnostics: SvgImportDiagnostic[],
): SvgImportDiagnostic | null {
  state.elementCount += 1;
  if (depth > MAX_DEPTH || state.elementCount > MAX_ELEMENTS) {
    return fatal(
      'quota-exceeded',
      `SVG exceeds the import quota (max depth ${MAX_DEPTH}, max ${MAX_ELEMENTS} elements).`,
    );
  }

  if (isDisplayNone(el)) {
    diagnostics.push(
      warning('hidden-content-skipped', `Hidden <${el.localName}> subtree was skipped.`),
    );
    return null;
  }

  if (el.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(el.localName)) {
    return fatal('unsupported-element', `Unsupported element: <${el.localName}>.`);
  }
  // 'svg' is only valid as the (already-validated) document root -- a
  // nested <svg> establishes its own viewport/coordinate system, which this
  // importer does not resolve.
  if (depth > 1 && el.localName === 'svg') {
    return fatal('unsupported-element', 'Nested <svg> is not supported.');
  }

  if (!SKIP_ATTRIBUTE_CHECK.has(el.localName)) {
    const attrFatal = checkAttributes(el, diagnostics);
    if (attrFatal) return attrFatal;
  }

  for (const child of Array.from(el.children)) {
    const childFatal = walkElement(child, depth + 1, state, diagnostics);
    if (childFatal) return childFatal;
  }
  return null;
}

// Accepts unitless or "px" (e.g. "128", "128px"); any other unit (mm, cm,
// in, pt, pc, em, ex, %, ...) is rejected -- returns 'bad-unit' rather than
// throwing so the caller can turn it into the right diagnostic code.
function parseUnitlessOrPx(raw: string): number | 'bad-unit' {
  const match = raw.trim().match(/^(-?[\d.]+(?:e-?\d+)?)(px)?$/i);
  if (!match) return 'bad-unit';
  return Number(match[1]);
}

function resolveViewport(
  root: Element,
): { viewport: SvgViewport } | { diagnostic: SvgImportDiagnostic } {
  const viewBoxAttr = root.getAttribute('viewBox');
  if (viewBoxAttr !== null) {
    const nums = viewBoxAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const [minX, minY, width, height] = nums;
    if (nums.length === 4 && nums.every(Number.isFinite) && width > 0 && height > 0) {
      return { viewport: { minX, minY, width, height } };
    }
    return { diagnostic: fatal('no-viewport', `Invalid viewBox: "${viewBoxAttr}".`) };
  }

  const widthAttr = root.getAttribute('width');
  const heightAttr = root.getAttribute('height');
  if (widthAttr === null || heightAttr === null) {
    return { diagnostic: fatal('no-viewport', 'SVG has neither viewBox nor width/height.') };
  }

  const width = parseUnitlessOrPx(widthAttr);
  const height = parseUnitlessOrPx(heightAttr);
  if (width === 'bad-unit' || height === 'bad-unit') {
    return {
      diagnostic: fatal(
        'unsupported-unit',
        `width/height must be unitless or "px" without a viewBox, got "${widthAttr}" / "${heightAttr}".`,
      ),
    };
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { diagnostic: fatal('no-viewport', 'width/height must be positive finite numbers.') };
  }
  return { viewport: { minX: 0, minY: 0, width, height } };
}

export function parseSvgDocument(svgText: string): SvgParseResult {
  const preParseDiag = preParseReject(svgText);
  if (preParseDiag) return { status: 'fatal', diagnostics: [preParseDiag] };

  // Parsed as an inert Document, never adopted into the live DOM -- no
  // script executes, no image/font loads, no CSSOM is built for it.
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return {
      status: 'fatal',
      diagnostics: [fatal('malformed-xml', 'SVG is not well-formed XML.')],
    };
  }

  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    return { status: 'fatal', diagnostics: [fatal('malformed-xml', 'Root element is not <svg>.')] };
  }

  const diagnostics: SvgImportDiagnostic[] = [];
  const walkFatal = walkElement(root, 1, { elementCount: 0 }, diagnostics);
  if (walkFatal) return { status: 'fatal', diagnostics: [...diagnostics, walkFatal] };

  const viewportResult = resolveViewport(root);
  if ('diagnostic' in viewportResult) {
    return { status: 'fatal', diagnostics: [...diagnostics, viewportResult.diagnostic] };
  }

  return { status: 'ok', root, diagnostics, viewport: viewportResult.viewport };
}
