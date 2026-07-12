// OKLab-distance color matching, ported from pgen's
// packages/pattern-gen-viewer/src/utils/nearest-palette-color.ts. Plain RGB
// distance is a bad proxy for perceived closeness (a dark muted gold reads as
// "nearest black" under raw RGB just because both are dark) — OKLab distance
// is what pgen's own tracer pipeline uses to pick a palette index, so the
// traced fills here match what pgen would have chosen for the same source.
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToOklab(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  // linear sRGB -> XYZ (D65)
  const x = 0.4124 * lr + 0.3576 * lg + 0.1805 * lb;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = 0.0193 * lr + 0.1192 * lg + 0.9505 * lb;

  // XYZ -> LMS -> OKLab (Björn Ottosson's OKLab matrices)
  const l = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
  const m = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
  const s = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// A few CSS named colors in case a tracer ever emits one; the fill format we
// actually see from @image-tracer-ts is rgb()/hex (see trace-pipeline.ts).
// "none" is deliberately absent — it falls through to the null return below.
const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
};

// Parses #rgb / #rrggbb / rgb()/rgba() / a couple of named colors into a
// canonical 6-digit hex string. Returns null for anything unparseable
// (notably fill="none").
export function parseColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, s)) {
    return NAMED_COLORS[s]!;
  }
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (/^[0-9a-f]{6}$/.test(h)) return `#${h}`;
    return null;
  }
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*[\d.%]+)?\s*\)$/);
  if (rgbMatch) {
    const [r, g, b] = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map((n) =>
      Math.min(255, Math.max(0, Number(n))),
    );
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return null;
}

// Nearest index into `palette` (hex strings) to `fillColor` (any
// parseColor()-recognized format) by OKLab distance. Null when fillColor or
// every palette entry fails to parse.
export function nearestPaletteIndex(fillColor: string, palette: readonly string[]): number | null {
  const fillHex = parseColor(fillColor);
  if (!fillHex || palette.length === 0) return null;
  const fillLab = hexToOklab(fillHex);

  let bestIndex: number | null = null;
  let bestDist = Infinity;
  palette.forEach((hex, i) => {
    const parsed = parseColor(hex);
    if (!parsed) return;
    const [l, a, b] = hexToOklab(parsed);
    const dist = (fillLab[0] - l) ** 2 + (fillLab[1] - a) ** 2 + (fillLab[2] - b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  });
  return bestIndex;
}
