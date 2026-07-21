// Style cascade and paint grammar for native SVG vector import (#139).
//
// A deliberately small subset of CSS: inline `style=""` declarations beat
// presentation attributes, a fixed list of properties inherits down the tree,
// and the color grammar is a closed allowlist (an unrecognized color is fatal
// -- guessing would silently change the imported artwork's colors).
import { DiagnosticSink, throwFatal } from './diagnostics';
import { NAMED_COLORS } from './named-colors';
import { stripCssComments } from './parse-svg-document';

// Raw (uncomputed) values: `currentColor` has to stay unresolved while it is
// inherited, because CSS resolves it against the color of the element that
// finally uses it, not the one that declared it.
export interface StyleState {
  fill: string;
  stroke: string;
  strokeWidth: string;
  fillOpacity: string;
  strokeOpacity: string;
  color: string;
  fillRule: string;
  visibility: string;
  strokeLinecap: string;
  strokeLinejoin: string;
  strokeMiterlimit: string;
  // Not inherited: `display` applies to the element that sets it (its subtree
  // then never renders because the subtree is skipped outright).
  display: string;
  // Not an inherited property either: `opacity` applies to a group as a whole,
  // so it accumulates as a product down the tree instead of being overwritten.
  opacity: number;
}

// SVG's initial values -- notably fill defaults to black (not "none"), which
// is why a bare <path d="..."/> is a filled black shape.
export const INITIAL_STYLE: StyleState = {
  fill: 'black',
  stroke: 'none',
  strokeWidth: '1',
  fillOpacity: '1',
  strokeOpacity: '1',
  color: 'black',
  fillRule: 'nonzero',
  visibility: 'visible',
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: '4',
  display: 'inline',
  opacity: 1,
};

const INHERITED_PROPS: Readonly<Record<string, keyof StyleState>> = {
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  color: 'color',
  'fill-rule': 'fillRule',
  visibility: 'visibility',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
};

function parseDeclarations(style: string): [string, string][] {
  const declarations: [string, string][] = [];
  // Comments have to go first, or "/* x */ fill:red" parses as a declaration
  // for the property "/* x */ fill" and the paint is silently lost.
  for (const chunk of stripCssComments(style).split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim();
    if (prop && value) declarations.push([prop, value]);
  }
  return declarations;
}

// Accepts a number or a percentage; anything else is fatal rather than
// defaulted, because a misread opacity is exactly how a fully transparent
// element would sneak in as an opaque palette shape.
export function parseOpacity(raw: string, propertyName: string): number {
  const value = raw.trim();
  const percent = value.endsWith('%');
  const numeric = Number(percent ? value.slice(0, -1) : value);
  if (value === '' || !Number.isFinite(numeric)) {
    throwFatal('invalid-number', `"${propertyName}" is not a number: "${raw}".`);
  }
  return Math.min(1, Math.max(0, percent ? numeric / 100 : numeric));
}

// Presentation attributes first, inline `style` second (style wins). Unknown
// presentation attributes are not warned about here -- the safety gate (#138)
// already reports those as `attribute-ignored`.
export function resolveStyle(el: Element, parent: StyleState, sink: DiagnosticSink): StyleState {
  const state: StyleState = { ...parent };
  // The element's own opacity, kept apart from the inherited product so that
  // style="opacity:.2" overrides opacity=".5" instead of multiplying with it.
  let ownOpacity = 1;

  const assign = (prop: string, value: string, fromStyle: boolean): void => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'inherit') return;
    if (prop === 'opacity') {
      ownOpacity = parseOpacity(value, 'opacity');
      return;
    }
    if (prop === 'display') {
      state.display = normalized;
      return;
    }
    // `currentColor` on the `color` property itself IS the inherited color,
    // so keeping the parent's value is what resolves it -- storing the keyword
    // would later fall back to black under an ancestor that set a real color.
    if (prop === 'color' && normalized === 'currentcolor') return;
    const key = INHERITED_PROPS[prop];
    if (key) {
      // Every StyleState key in INHERITED_PROPS is a string field; the numeric
      // and non-inherited ones are handled above.
      (state as unknown as Record<string, string>)[key] = value.trim();
      return;
    }
    if (fromStyle) {
      sink.warn('style-ignored', `Style declaration "${prop}" is ignored.`);
    }
  };

  // display is not inherited: it starts from its initial value on every
  // element rather than from the parent's.
  state.display = 'inline';
  for (const prop of [...Object.keys(INHERITED_PROPS), 'opacity', 'display']) {
    const value = el.getAttribute(prop);
    if (value !== null) assign(prop, value, false);
  }

  const style = el.getAttribute('style');
  if (style) {
    for (const [prop, value] of parseDeclarations(style)) assign(prop, value, true);
  }

  state.opacity = parent.opacity * ownOpacity;
  return state;
}

export type ColorValue =
  | { kind: 'color'; hex: string; alpha: number }
  | { kind: 'none' }
  | { kind: 'current' }
  | { kind: 'invalid' };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function channel(token: string): number | null {
  const percent = token.endsWith('%');
  const body = percent ? token.slice(0, -1) : token;
  if (!NUMBER.test(body)) return null;
  const value = percent ? (Number(body) / 100) * 255 : Number(body);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.min(255, Math.max(0, value)));
}

function alphaChannel(token: string): number | null {
  const percent = token.endsWith('%');
  const body = percent ? token.slice(0, -1) : token;
  if (!NUMBER.test(body)) return null;
  const value = percent ? Number(body) / 100 : Number(body);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function toHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sectors: [number, number, number][] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = sectors[Math.floor(hue / 60) % 6];
  return toHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

// Splits `rgb(...)`/`hsl(...)` arguments; accepts both the legacy comma
// syntax and the modern space syntax (`rgb(0 0 0 / 50%)`).
function functionArgs(body: string): string[] {
  return body
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean);
}

function parseHslArgs(args: string[]): ColorValue {
  if (args.length !== 3 && args.length !== 4) return { kind: 'invalid' };
  const hueToken = args[0].replace(/deg$/i, '');
  if (!NUMBER.test(hueToken)) return { kind: 'invalid' };
  const percents = args.slice(1, 3).map((token) => {
    const body = token.endsWith('%') ? token.slice(0, -1) : token;
    return NUMBER.test(body) ? Math.min(100, Math.max(0, Number(body))) / 100 : null;
  });
  if (percents.some((p) => p === null)) return { kind: 'invalid' };
  const alpha = args.length === 4 ? alphaChannel(args[3]) : 1;
  if (alpha === null) return { kind: 'invalid' };
  return {
    kind: 'color',
    hex: hslToHex(Number(hueToken), percents[0]!, percents[1]!),
    alpha,
  };
}

function parseHex(body: string): ColorValue {
  const expand = (c: string) => `${c}${c}`;
  if (/^[0-9a-f]{3}$/.test(body)) {
    return { kind: 'color', hex: `#${[...body].map(expand).join('')}`, alpha: 1 };
  }
  if (/^[0-9a-f]{4}$/.test(body)) {
    return {
      kind: 'color',
      hex: `#${[...body.slice(0, 3)].map(expand).join('')}`,
      alpha: parseInt(expand(body[3]), 16) / 255,
    };
  }
  if (/^[0-9a-f]{6}$/.test(body)) return { kind: 'color', hex: `#${body}`, alpha: 1 };
  if (/^[0-9a-f]{8}$/.test(body)) {
    return {
      kind: 'color',
      hex: `#${body.slice(0, 6)}`,
      alpha: parseInt(body.slice(6), 16) / 255,
    };
  }
  return { kind: 'invalid' };
}

// The locked color grammar: hex (3/4/6/8 digits), rgb()/rgba(), hsl()/hsla(),
// the named-color table, `currentColor`, `none`, `transparent`. Canonicalized
// to lowercase #rrggbb plus a separate alpha in [0,1].
export function parseColorValue(raw: string): ColorValue {
  const value = raw.trim().toLowerCase();
  if (value === '') return { kind: 'invalid' };
  if (value === 'none') return { kind: 'none' };
  if (value === 'currentcolor') return { kind: 'current' };
  // Alpha 0 rather than a "no paint" -- `transparent` is a real color that
  // happens to be invisible, and the alpha rules below already disable it.
  if (value === 'transparent') return { kind: 'color', hex: '#000000', alpha: 0 };
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, value)) {
    return { kind: 'color', hex: NAMED_COLORS[value]!, alpha: 1 };
  }
  if (value.startsWith('#')) return parseHex(value.slice(1));

  const fn = value.match(/^(rgba?|hsla?)\(([^()]*)\)$/);
  if (!fn) return { kind: 'invalid' };
  const args = functionArgs(fn[2]);
  if (fn[1].startsWith('hsl')) return parseHslArgs(args);
  if (args.length !== 3 && args.length !== 4) return { kind: 'invalid' };
  const rgb = args.slice(0, 3).map(channel);
  if (rgb.some((c) => c === null)) return { kind: 'invalid' };
  const alpha = args.length === 4 ? alphaChannel(args[3]) : 1;
  if (alpha === null) return { kind: 'invalid' };
  return { kind: 'color', hex: toHex(rgb[0]!, rgb[1]!, rgb[2]!), alpha };
}

export interface ResolvedPaint {
  hex: string;
  alpha: number;
}

// Resolves one paint (fill or stroke) against the cascade. Returns null when
// the element is not painted with it (`fill="none"`). An alpha of 0 is
// returned as-is: the caller disables that paint, so a fully transparent
// element never becomes an opaque palette shape.
export function resolvePaint(
  value: string,
  style: StyleState,
  paintOpacity: string,
  opacityProperty: string,
): ResolvedPaint | null {
  let color = parseColorValue(value);
  if (color.kind === 'current') {
    // `currentColor` resolving to another `currentColor` (or to `none`) has
    // no color to fall back on but the initial `color`, which is black.
    const inherited = parseColorValue(style.color);
    color = inherited.kind === 'color' ? inherited : { kind: 'color', hex: '#000000', alpha: 1 };
  }
  if (color.kind === 'none') return null;
  if (color.kind === 'invalid') {
    throwFatal('unsupported-color', `Unsupported color value: "${value}".`);
  }
  const alpha = color.alpha * parseOpacity(paintOpacity, opacityProperty) * style.opacity;
  return { hex: color.hex, alpha };
}
