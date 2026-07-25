/**
 * Text layers → filled glyph outlines (#212, Decisions 0.4, 6, 8, 9).
 *
 * Gerber cannot carry live text, and nothing in this repository outlined a
 * glyph before this file: `text-geometry.ts` is metrics-only (`measureText`)
 * and painting is `ctx.fillText` (`renderer.ts:440-458`). So the export has to
 * re-run the browser's text layout from the font files themselves and land the
 * result exactly where the user saw it.
 *
 * Four things this reproduces from `paintLayer`, none of them optional:
 *
 *  1. `ctx.font = \`${layer.sizeMm}px "${layer.fontFamily}"\`` — in this app one
 *     canvas font px IS one document millimetre (`types.ts:64`), so the em
 *     scale is `sizeMm / unitsPerEm` with no unit conversion anywhere.
 *  2. `textBaseline = 'top'`, so each line's ALPHABETIC baseline sits a
 *     font-dependent distance below the anchor — see `topBaselineDropMm`.
 *  3. Line height `sizeMm * 1.25`, line `i` anchored at
 *     `box.x, box.y + i * lineHeight`, with `box` from `getTextGeometry`.
 *  4. Rotation about `getTextGeometry(layer).pivot` — the CACHED, font-load
 *     dependent pivot (Decision 9). Recomputing it lands rotated text somewhere
 *     other than where the editor drew it, which is the whole reason that cache
 *     exists.
 *
 * Every glyph becomes its OWN nonzero `KernelInput`, never one merged path.
 * `fillText` composites glyphs independently, so two overlapping glyphs union;
 * merged into a single nonzero path, one glyph's stem crossing the next
 * glyph's counter would cancel to a hole that the editor never showed.
 *
 * `opentype.js` and the `.woff` registry are both reached through
 * `await import('./text-fonts')`, so neither is in the main chunk.
 */

import { rotatePoint, type Layer, type Pt, type TextLayer } from '@zpd/core';
import type { OpenTypeFont, OpenTypeGlyph, OpenTypeLigature } from 'opentype.js';
import type { KernelCubic, KernelInput, KernelPoint, KernelRing } from '../geometry-kernel';
import { getTextGeometry } from '../text-geometry';
import type {
  IrExtractContext,
  IrLayerCubicResult,
  IrLayerResult,
  LayerGeometrySource,
} from './ir';
import { ringsToRegions } from './regions';
import type { CuratedFontFace, CuratedFontFile } from './text-fonts';

/** `renderer.ts:454` / `text-geometry.ts:74` — the one line-height in the app. */
const TEXT_LINE_HEIGHT_FACTOR = 1.25;

/** Cap on how many offending characters a `missing-glyph` refusal spells out. */
const MAX_REPORTED_CODE_POINTS = 8;

function canvasFontString(layer: TextLayer): string {
  return `${layer.sizeMm}px "${layer.fontFamily}"`;
}

/**
 * The canvas "text preparation algorithm" replaces every ASCII whitespace
 * character — TAB, LF, FF, CR — with U+0020 before shaping, and both
 * `fillText` and `measureText` run it. Reproducing it here is what stops a tab
 * or a stray CR (from CRLF content) refusing as a missing glyph when the editor
 * happily painted a space: `latin` covers U+0000-00FF by range, but the subset
 * files carry no glyph at U+0009.
 *
 * LF is excluded because the caller has already split on it into lines.
 */
function prepareCanvasText(line: string): string {
  return line.replace(/[\t\f\r]/g, ' ');
}

// ─── top-baseline anchor ───────────────────────────────────────────────────

export type TopBaselineProbe = (fontCss: string) => number | null;

/**
 * Ask the engine that actually painted the text how far below the
 * `textBaseline: 'top'` anchor the alphabetic baseline sits.
 *
 * `TextMetrics.alphabeticBaseline` is "the distance from the horizontal line
 * indicated by the textBaseline attribute to the alphabetic baseline … positive
 * numbers indicating a distance going up", so with a `'top'` anchor it is
 * negative and the drop is its negation. This is the one metric in the whole
 * pipeline that is genuinely engine-defined, so measuring beats deriving.
 */
function domTopBaselineProbe(fontCss: string): number | null {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.font = fontCss;
  ctx.textBaseline = 'top';
  const alphabetic = ctx.measureText('M').alphabeticBaseline;
  return typeof alphabetic === 'number' && Number.isFinite(alphabetic) ? -alphabetic : null;
}

let topBaselineProbe: TopBaselineProbe = domTopBaselineProbe;

/** Pin (or disable, with `null`) the engine probe for deterministic tests. */
export function setTopBaselineProbeForTests(probe: TopBaselineProbe | null): void {
  topBaselineProbe = probe ?? domTopBaselineProbe;
}

/**
 * Where the alphabetic baseline sits when no engine probe is available.
 *
 * Blink resolves a `'top'` canvas baseline to `NormalizedTypoAscent`: the OS/2
 * typo ascent RESCALED so that ascent + descent equals one em, because "while
 * the OpenType specification recommends the sum of sTypoAscender and
 * sTypoDescender to equal 1em, most fonts do not follow"
 * (`simple_font_data.cc`). That is `sizeMm * asc / (asc - desc)` — NOT
 * `asc / unitsPerEm`, which for Inter differs by 0.17 em.
 *
 * HONEST LIMIT: this is Blink's rule. Gecko and WebKit resolve `'top'` from
 * their own font ascent and can land a few hundredths of an em away. The probe
 * above supersedes this in any browser that implements TextMetrics baselines,
 * which is every current engine — this path is for tests and for a runtime with
 * no canvas at all.
 */
export function fallbackTopBaselineDropMm(font: OpenTypeFont, sizeMm: number): number {
  const ascent = font.tables.os2?.sTypoAscender ?? font.ascender;
  const descent = font.tables.os2?.sTypoDescender ?? font.descender;
  const emHeight = ascent - descent;
  if (emHeight > 0 && ascent > 0 && ascent <= emHeight) return (sizeMm * ascent) / emHeight;
  return (sizeMm * font.ascender) / font.unitsPerEm;
}

function topBaselineDropMm(font: OpenTypeFont, layer: TextLayer): number {
  const probed = topBaselineProbe(canvasFontString(layer));
  // A plausibility band, not decoration: a probe that returns 0, a NaN, or the
  // wrong sign must fall back rather than shift every glyph by a whole ascent.
  if (probed !== null && Number.isFinite(probed) && probed > 0 && probed <= layer.sizeMm * 2) {
    return probed;
  }
  return fallbackTopBaselineDropMm(font, layer.sizeMm);
}

// ─── shaping ───────────────────────────────────────────────────────────────

const ligatureRulesByFont = new WeakMap<OpenTypeFont, readonly OpenTypeLigature[]>();

/**
 * The font's default `liga` substitutions, longest first so a greedy walk picks
 * the longest match (`ffi` before `ff`) the way a shaper does.
 *
 * `opentype.js`'s own `font.stringToGlyphs` is NOT usable here: its bidi/feature
 * engine applies `ccmp` unconditionally and throws
 * "substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported"
 * on Inter. Reading the GSUB ligature table directly avoids that path entirely.
 */
function ligatureRules(font: OpenTypeFont): readonly OpenTypeLigature[] {
  const cached = ligatureRulesByFont.get(font);
  if (cached) return cached;
  let rules: readonly OpenTypeLigature[] = [];
  try {
    rules = [...font.substitution.getLigatures('liga')].sort((a, b) => b.sub.length - a.sub.length);
  } catch {
    // A subset with no GSUB at all. No ligatures is the correct answer.
    rules = [];
  }
  ligatureRulesByFont.set(font, rules);
  return rules;
}

function applyLigatures(font: OpenTypeFont, glyphIds: readonly number[]): number[] {
  const rules = ligatureRules(font);
  if (rules.length === 0) return [...glyphIds];
  const out: number[] = [];
  for (let i = 0; i < glyphIds.length;) {
    const rule = rules.find(
      (r) => r.sub.length <= glyphIds.length - i && r.sub.every((g, k) => glyphIds[i + k] === g),
    );
    if (rule) {
      out.push(rule.by);
      i += rule.sub.length;
    } else {
      out.push(glyphIds[i]);
      i += 1;
    }
  }
  return out;
}

function kerningValue(font: OpenTypeFont, left: number, right: number): number {
  try {
    return font.getKerningValue(left, right) || 0;
  } catch {
    return 0;
  }
}

interface PlacedGlyph {
  readonly glyph: OpenTypeGlyph;
  /** Pen origin of this glyph, document mm, before rotation. */
  readonly penXMm: number;
}

/**
 * One contiguous span of a line taken from a single subset file. The browser
 * segments text into runs by resolved face and shapes each run on its own, so
 * kerning does not reach across a run boundary here either.
 */
interface TextRun {
  readonly file: CuratedFontFile;
  readonly text: string;
}

function segmentRuns(line: string, fileFor: (codePoint: number) => CuratedFontFile): TextRun[] {
  const runs: TextRun[] = [];
  for (const char of line) {
    const file = fileFor(char.codePointAt(0)!);
    const last = runs[runs.length - 1];
    if (last && last.file.url === file.url) {
      runs[runs.length - 1] = { file, text: last.text + char };
    } else {
      runs.push({ file, text: char });
    }
  }
  return runs;
}

function layoutRun(
  font: OpenTypeFont,
  text: string,
  penXMm: number,
  sizeMm: number,
): { readonly glyphs: PlacedGlyph[]; readonly penXMm: number } {
  const scale = sizeMm / font.unitsPerEm;
  const glyphIds = applyLigatures(
    font,
    [...text].map((char) => font.charToGlyphIndex(char)),
  );
  const glyphs: PlacedGlyph[] = [];
  let pen = penXMm;
  for (let i = 0; i < glyphIds.length; i++) {
    const glyph = font.glyphs.get(glyphIds[i]);
    if (glyph) {
      glyphs.push({ glyph, penXMm: pen });
      pen += (glyph.advanceWidth ?? 0) * scale;
    }
    if (i < glyphIds.length - 1) pen += kerningValue(font, glyphIds[i], glyphIds[i + 1]) * scale;
  }
  return { glyphs, penXMm: pen };
}

// ─── glyph outlines → cubic rings ──────────────────────────────────────────

function lineCubic(from: KernelPoint, to: KernelPoint): KernelCubic | null {
  // opentype.js emits a redundant `L` back onto the point a contour just moved
  // to; a zero-length edge carries no geometry and only gives the boolean
  // backend a duplicate vertex to reason about.
  if (from.x === to.x && from.y === to.y) return null;
  return { p0: from, c1: from, c2: to, p3: to };
}

/**
 * Quadratic → cubic degree elevation, which is EXACT and therefore spends none
 * of Decision 6's 5 µm budget. TrueType outlines (all 10 curated families) are
 * quadratic; handing the elevated cubics to #209's adaptive flattener keeps the
 * tolerance enforced in exactly one place.
 */
function quadraticCubic(from: KernelPoint, control: KernelPoint, to: KernelPoint): KernelCubic {
  return {
    p0: from,
    c1: { x: from.x + (2 / 3) * (control.x - from.x), y: from.y + (2 / 3) * (control.y - from.y) },
    c2: { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
    p3: to,
  };
}

/**
 * One glyph's contours as cubic rings, each `place`d into document space.
 *
 * Contour winding is passed through UNCHANGED. TrueType mandates a consistent
 * non-zero winding — outer and counter wound oppositely — so a nonzero fill of
 * the untouched contours is the glyph's true ink, including composite glyphs
 * (an accented letter's base and accent overlap and must union, which evenodd
 * would punch into a hole). The Decision 0.2 outer-positive / hole-negative
 * normalisation is applied later, by measured area, in `ringsToRegions`.
 */
function glyphContours(
  glyph: OpenTypeGlyph,
  place: (x: number, y: number) => KernelPoint,
): KernelRing[] {
  const rings: KernelRing[] = [];
  let ring: KernelCubic[] = [];
  let start: KernelPoint | null = null;
  let current: KernelPoint | null = null;

  const flush = (): void => {
    if (start && current) {
      const closing = lineCubic(current, start);
      if (closing) ring.push(closing);
    }
    if (ring.length >= 2) rings.push(ring);
    ring = [];
    start = null;
    current = null;
  };

  for (const command of glyph.path.commands) {
    switch (command.type) {
      case 'M': {
        flush();
        start = place(command.x!, command.y!);
        current = start;
        break;
      }
      case 'L': {
        if (!current) break;
        const to = place(command.x!, command.y!);
        const segment = lineCubic(current, to);
        if (segment) ring.push(segment);
        current = to;
        break;
      }
      case 'Q': {
        if (!current) break;
        const to = place(command.x!, command.y!);
        ring.push(quadraticCubic(current, place(command.x1!, command.y1!), to));
        current = to;
        break;
      }
      case 'C': {
        if (!current) break;
        const to = place(command.x!, command.y!);
        ring.push({
          p0: current,
          c1: place(command.x1!, command.y1!),
          c2: place(command.x2!, command.y2!),
          p3: to,
        });
        current = to;
        break;
      }
      case 'Z':
        flush();
        break;
    }
  }
  flush();
  return rings;
}

// ─── assembly ──────────────────────────────────────────────────────────────

export type TextOutlineResult =
  | { readonly ok: true; readonly groups: KernelInput[] }
  | {
      readonly ok: false;
      readonly reason: 'non-curated-font' | 'missing-glyph';
      readonly detail: string;
    };

function describeCodePoints(codePoints: readonly number[]): string {
  const shown = codePoints
    .slice(0, MAX_REPORTED_CODE_POINTS)
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(cp)}`);
  const rest = codePoints.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} (+${rest} more)` : shown.join(', ');
}

interface ResolvedFonts {
  readonly fileByCodePoint: ReadonlyMap<number, CuratedFontFile>;
  readonly fontByUrl: ReadonlyMap<string, OpenTypeFont>;
  /** Highest-CSS-priority file actually used, i.e. the metric source. */
  readonly primaryFont: OpenTypeFont | null;
  readonly missing: readonly number[];
}

async function resolveFonts(
  face: CuratedFontFace,
  lines: readonly string[],
  fonts: typeof import('./text-fonts'),
): Promise<ResolvedFonts> {
  const fileByCodePoint = new Map<number, CuratedFontFile>();
  const missing = new Set<number>();
  for (const line of lines) {
    for (const char of line) {
      const codePoint = char.codePointAt(0)!;
      if (fileByCodePoint.has(codePoint) || missing.has(codePoint)) continue;
      const file = fonts.subsetFileForCodePoint(face, codePoint);
      // Outside every shipped subset's unicode-range: the canvas silently used
      // a system fallback face, which `opentype.js` cannot see (Decision 8).
      if (file) fileByCodePoint.set(codePoint, file);
      else missing.add(codePoint);
    }
  }

  const usedFiles = new Map<string, CuratedFontFile>();
  for (const file of fileByCodePoint.values()) usedFiles.set(file.url, file);
  const fontByUrl = new Map(
    await Promise.all(
      [...usedFiles.values()].map(
        async (file) => [file.url, await fonts.loadCuratedFont(file)] as const,
      ),
    ),
  );

  for (const [codePoint, file] of fileByCodePoint) {
    if (!fontByUrl.get(file.url)!.hasChar(String.fromCodePoint(codePoint))) missing.add(codePoint);
  }

  // Metrics are identical across a family's subsets (they are cuts of one
  // source font); picking by CSS priority just makes the choice deterministic.
  const primaryFile = face.files.find((file) => usedFiles.has(file.url));
  return {
    fileByCodePoint,
    fontByUrl,
    primaryFont: primaryFile ? fontByUrl.get(primaryFile.url)! : null,
    missing: [...missing].sort((a, b) => a - b),
  };
}

export async function textLayerToGroups(layer: TextLayer): Promise<TextOutlineResult> {
  const geometry = getTextGeometry(layer);
  // An invalid size has no render geometry and never reaches fillText
  // (`renderer.ts:352-353`), so it contributes nothing and is not a refusal.
  if (!geometry) return { ok: true, groups: [] };

  const fonts = await import('./text-fonts');
  const face = fonts.curatedFontFace(layer.fontFamily);
  if (!face) return { ok: false, reason: 'non-curated-font', detail: layer.fontFamily };

  const lines = layer.content.split('\n').map(prepareCanvasText);
  const resolved = await resolveFonts(face, lines, fonts);
  if (resolved.missing.length > 0) {
    return { ok: false, reason: 'missing-glyph', detail: describeCodePoints(resolved.missing) };
  }
  if (!resolved.primaryFont) return { ok: true, groups: [] };

  const drop = topBaselineDropMm(resolved.primaryFont, layer);
  const lineHeight = layer.sizeMm * TEXT_LINE_HEIGHT_FACTOR;
  const rotation = layer.rotation ?? 0;
  const pivot: Pt = geometry.pivot;
  const place = rotation
    ? (point: KernelPoint): KernelPoint => rotatePoint(point, pivot, rotation)
    : (point: KernelPoint): KernelPoint => point;

  const groups: KernelInput[] = [];
  lines.forEach((line, index) => {
    const baselineY = geometry.box.y + index * lineHeight + drop;
    let penXMm = geometry.box.x;
    for (const run of segmentRuns(line, (cp) => resolved.fileByCodePoint.get(cp)!)) {
      const font = resolved.fontByUrl.get(run.file.url)!;
      const scale = layer.sizeMm / font.unitsPerEm;
      const laid = layoutRun(font, run.text, penXMm, layer.sizeMm);
      penXMm = laid.penXMm;
      for (const placed of laid.glyphs) {
        // The font's own em box is y-UP; the document is y-down. This is that
        // conversion, NOT the Gerber panel flip — that one belongs solely to
        // `coordinate-frame.ts` (Decision 1) and happens much later.
        const contours = glyphContours(placed.glyph, (x, y) =>
          place({ x: placed.penXMm + x * scale, y: baselineY - y * scale }),
        );
        if (contours.length > 0) groups.push({ contours, fillRule: 'nonzero' });
      }
    }
  });

  return { ok: true, groups };
}

function unsupported(
  layer: Layer,
  reason: 'non-curated-font' | 'missing-glyph',
  detail: string,
): Extract<IrLayerResult, { kind: 'unsupported' }> {
  return { kind: 'unsupported', layerId: layer.id, layerName: layer.name, reason, detail };
}

export const textGeometrySource: LayerGeometrySource = {
  handles: 'text',
  async extract(layer: Layer, ctx: IrExtractContext): Promise<IrLayerResult> {
    const result = await textLayerToGroups(layer as TextLayer);
    if (!result.ok) return unsupported(layer, result.reason, result.detail);
    if (result.groups.length === 0) return { kind: 'regions', layerId: layer.id, regions: [] };
    // Overlapping glyph outlines must be unioned before emission — regions in
    // one layer are required to be pairwise disjoint (Decision 0.3).
    const united = ctx.engine.arrange(result.groups.map((group) => ({ ...group }))).unite();
    return {
      kind: 'regions',
      layerId: layer.id,
      regions: ringsToRegions(united, ctx.tolerance),
    };
  },
  async extractCubics(layer: Layer): Promise<IrLayerCubicResult> {
    const result = await textLayerToGroups(layer as TextLayer);
    return result.ok
      ? { kind: 'cubics', layerId: layer.id, groups: result.groups }
      : unsupported(layer, result.reason, result.detail);
  },
};
