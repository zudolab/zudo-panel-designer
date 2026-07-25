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
import { ensureFont } from '../fonts';
import type { KernelCubic, KernelInput, KernelPoint, KernelRing } from '../geometry-kernel';
import { getTextGeometry } from '../text-geometry';
import type {
  IrExtractContext,
  IrLayerCubicResult,
  IrLayerResult,
  LayerGeometrySource,
} from './ir';
import { groupsToRegions, unsupportedLayer } from './layer-result';
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
 *
 * `document.fonts.check` gates the whole thing. An unloaded `@font-face` does
 * not make `measureText` fail — it silently reports the FALLBACK face's
 * metrics, which no plausibility band can distinguish from the real answer. The
 * caller awaits `ensureFont` first; this is the guard for the load having
 * failed or timed out anyway.
 */
function domTopBaselineProbe(fontCss: string): number | null {
  if (typeof document === 'undefined') return null;
  try {
    if (!document.fonts?.check(fontCss)) return null;
  } catch {
    return null; // `check` throws on a font shorthand it cannot parse.
  }
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

/**
 * The GSUB features a shaper turns on by default for horizontal Latin text.
 * The canvas applies these whether or not anyone asked for them, so an exporter
 * that ignores one paints something the editor did not.
 */
const DEFAULT_ON_GSUB_FEATURES = ['ccmp', 'locl', 'rlig', 'liga', 'clig', 'calt'] as const;

/**
 * Script tables to consult. `opentype.js` defaults an omitted script to
 * `'DFLT'` (`getScriptTable`), which silently returns NOTHING for a font whose
 * GSUB carries only a `latn` table — Audiowide is exactly that, and its
 * `fi`/`fl` ligatures were invisible until this list existed.
 */
const GSUB_SCRIPTS = ['DFLT', 'latn'] as const;

/** GSUB LigatureSubst. The only lookup type this module can evaluate. */
const LIGATURE_LOOKUP_TYPE = 4;
const MAX_GSUB_LOOKUP_TYPE = 8;

interface FontShaping {
  /** Rules from features built ONLY from ligature lookups; longest first. */
  readonly applied: readonly OpenTypeLigature[];
  /** Rules from features this module cannot evaluate in full (see below). */
  readonly unreproducible: readonly OpenTypeLigature[];
}

const shapingByFont = new WeakMap<OpenTypeFont, FontShaping>();

function ligatureKey(rule: OpenTypeLigature): string {
  return `${rule.sub.join(',')}>${rule.by}`;
}

/**
 * Split each default-on feature into "we can reproduce this exactly" and "we
 * cannot".
 *
 * A feature made only of type-4 lookups is a plain ligature substitution and is
 * applied verbatim — that is every curated family's `liga`.
 *
 * A feature that ALSO carries contextual lookups (types 5/6) is not applied at
 * all, and its ligature rules become refusal triggers instead. Applying half of
 * it is worse than applying none: Inter's `calt` is `[4, 6]`, where the type-6
 * half rewrites `hyphen`/`greater` into their `.case` variants next to capitals
 * and the type-4 half then ligates whichever variant survived. Running only the
 * type-4 half turns `IN -> OUT` from the arrow the editor drew into a
 * DIFFERENT arrow — a plausible-looking wrong board, which is precisely what
 * Decision 8 exists to prevent.
 *
 * `opentype.js`'s own `font.stringToGlyphs` is not an option either: its
 * bidi/feature engine applies `ccmp` unconditionally and throws
 * "substitutionType : 62 lookupType: 6 - substFormat: 2 is not yet supported"
 * on Inter.
 */
function shapingFor(font: OpenTypeFont): FontShaping {
  const cached = shapingByFont.get(font);
  if (cached) return cached;

  const applied: OpenTypeLigature[] = [];
  const unreproducible: OpenTypeLigature[] = [];
  for (const feature of DEFAULT_ON_GSUB_FEATURES) {
    const lookupTypes = new Set<number>();
    const rules = new Map<string, OpenTypeLigature>();
    for (const script of GSUB_SCRIPTS) {
      for (let type = 1; type <= MAX_GSUB_LOOKUP_TYPE; type++) {
        if (font.substitution.getLookupTables(script, undefined, feature, type).length > 0) {
          lookupTypes.add(type);
        }
      }
      for (const rule of font.substitution.getLigatures(feature, script)) {
        rules.set(ligatureKey(rule), rule);
      }
    }
    if (lookupTypes.size === 0) continue;
    const reproducible = [...lookupTypes].every((type) => type === LIGATURE_LOOKUP_TYPE);
    for (const rule of rules.values()) (reproducible ? applied : unreproducible).push(rule);
  }

  const shaping: FontShaping = {
    // Longest first, so a greedy walk picks `ffi` over `ff` the way a shaper does.
    applied: applied.sort((a, b) => b.sub.length - a.sub.length),
    unreproducible,
  };
  shapingByFont.set(font, shaping);
  return shaping;
}

function matchesAt(rule: OpenTypeLigature, glyphIds: readonly number[], at: number): boolean {
  return (
    rule.sub.length <= glyphIds.length - at && rule.sub.every((g, k) => glyphIds[at + k] === g)
  );
}

function applyLigatures(rules: readonly OpenTypeLigature[], glyphIds: readonly number[]): number[] {
  if (rules.length === 0) return [...glyphIds];
  const out: number[] = [];
  for (let i = 0; i < glyphIds.length;) {
    const rule = rules.find((r) => matchesAt(r, glyphIds, i));
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

interface PlacedGlyph {
  readonly glyph: OpenTypeGlyph;
  /** Pen origin of this glyph, document mm, before rotation. */
  readonly penXMm: number;
}

/**
 * One contiguous span of a line taken from a single subset file, already mapped
 * to glyph ids. The browser segments text into runs by resolved face and shapes
 * each run on its own, so kerning does not reach across a run boundary here
 * either.
 */
interface ShapedRun {
  readonly font: OpenTypeFont;
  readonly glyphIds: readonly number[];
}

interface RunSegment {
  readonly file: CuratedFontFile;
  readonly text: string;
}

function segmentRuns(line: string, fileFor: (codePoint: number) => CuratedFontFile): RunSegment[] {
  const runs: RunSegment[] = [];
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

/**
 * Map one run to glyph ids, or report the substring whose shaping this module
 * cannot reproduce.
 *
 * The unreproducible check runs on the RAW cmap output, before any ligature is
 * applied, so the reported span still aligns 1:1 with the source characters —
 * and so the check cannot be defeated by an applied ligature consuming its
 * input first.
 */
function shapeRun(
  font: OpenTypeFont,
  text: string,
): { readonly run: ShapedRun; readonly blocked: string | null } {
  const chars = [...text];
  const raw = chars.map((char) => font.charToGlyphIndex(char));
  const shaping = shapingFor(font);
  for (let i = 0; i < raw.length; i++) {
    const rule = shaping.unreproducible.find((r) => matchesAt(r, raw, i));
    if (rule) {
      return {
        run: { font, glyphIds: raw },
        blocked: chars.slice(i, i + rule.sub.length).join(''),
      };
    }
  }
  return { run: { font, glyphIds: applyLigatures(shaping.applied, raw) }, blocked: null };
}

function layoutRun(
  run: ShapedRun,
  penXMm: number,
  sizeMm: number,
): { readonly glyphs: PlacedGlyph[]; readonly penXMm: number } {
  const { font, glyphIds } = run;
  const scale = sizeMm / font.unitsPerEm;
  const glyphs: PlacedGlyph[] = [];
  let pen = penXMm;
  for (let i = 0; i < glyphIds.length; i++) {
    const glyph = font.glyphs.get(glyphIds[i]);
    // Every id here came from the font's own cmap or GSUB and was already
    // proven present by the missing-glyph check. A miss means the file is
    // internally inconsistent — throwing is the only honest response, because
    // skipping the glyph would also skip its advance and silently slide the
    // rest of the line left.
    if (!glyph) {
      throw new Error(`Font has no glyph for index ${glyphIds[i]} it claims to define`);
    }
    glyphs.push({ glyph, penXMm: pen });
    pen += (glyph.advanceWidth ?? 0) * scale;
    // No swallowed failure: a kerning lookup that throws means the GPOS table
    // is beyond what opentype.js parses, and silently substituting 0 would
    // shift every following glyph.
    if (i < glyphIds.length - 1) {
      pen += font.getKerningValue(glyphIds[i], glyphIds[i + 1]) * scale;
    }
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

/**
 * Subsets whose script needs reordering, conjunct formation and mark
 * attachment — none of which this module does. Rajdhani ships a `devanagari`
 * subset, so the codepoints resolve and no missing-glyph fires; the outlines
 * would simply be laid out left-to-right in cmap order, which is not the word
 * the editor drew.
 */
const COMPLEX_SCRIPT_SUBSETS: ReadonlySet<string> = new Set(['devanagari']);

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
  readonly complexScript: readonly string[];
}

async function resolveFonts(
  face: CuratedFontFace,
  lines: readonly string[],
  fonts: typeof import('./text-fonts'),
): Promise<ResolvedFonts> {
  const fileByCodePoint = new Map<number, CuratedFontFile>();
  const missing = new Set<number>();
  const complexScript = new Set<string>();
  for (const line of lines) {
    for (const char of line) {
      const codePoint = char.codePointAt(0)!;
      if (fileByCodePoint.has(codePoint) || missing.has(codePoint)) continue;
      const file = fonts.subsetFileForCodePoint(face, codePoint);
      // Outside every shipped subset's unicode-range: the canvas silently used
      // a system fallback face, which `opentype.js` cannot see (Decision 8).
      if (!file) {
        missing.add(codePoint);
        continue;
      }
      if (COMPLEX_SCRIPT_SUBSETS.has(file.subset)) complexScript.add(file.subset);
      fileByCodePoint.set(codePoint, file);
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
    complexScript: [...complexScript],
  };
}

/**
 * A combining mark is positioned by GPOS `mark`/`mkmk` attachment, which this
 * module does not evaluate — laid out on its own advance it would land beside
 * its base letter instead of over it. Precomposed characters (é as U+00E9) are
 * unaffected and are the normal case; a DECOMPOSED sequence refuses.
 */
function combiningMarks(lines: readonly string[]): number[] {
  const marks = new Set<number>();
  for (const line of lines) {
    for (const char of line) {
      if (/\p{M}/u.test(char)) marks.add(char.codePointAt(0)!);
    }
  }
  return [...marks].sort((a, b) => a - b);
}

export async function textLayerToGroups(layer: TextLayer): Promise<TextOutlineResult> {
  const geometry = getTextGeometry(layer);
  // An invalid size has no render geometry and never reaches fillText
  // (`renderer.ts:352-353`), so it contributes nothing and is not a refusal.
  if (!geometry) return { ok: true, groups: [] };

  const fonts = await import('./text-fonts');
  const face = fonts.curatedFontFace(layer.fontFamily);
  if (!face) return { ok: false, reason: 'non-curated-font', detail: layer.fontFamily };

  // Only after the curated check — `ensureFont` on an unknown family would fire
  // a real Google Fonts request. Resolves (never rejects) once the face is
  // usable or the loader has given up, so the baseline probe below measures the
  // same face the renderer painted with rather than a fallback.
  await ensureFont(layer.fontFamily, layer.content);

  const lines = layer.content.split('\n').map(prepareCanvasText);
  const resolved = await resolveFonts(face, lines, fonts);
  if (resolved.missing.length > 0) {
    return { ok: false, reason: 'missing-glyph', detail: describeCodePoints(resolved.missing) };
  }
  if (resolved.complexScript.length > 0) {
    return {
      ok: false,
      reason: 'missing-glyph',
      detail: `${resolved.complexScript.join(', ')} text needs complex shaping this export cannot reproduce`,
    };
  }
  const marks = combiningMarks(lines);
  if (marks.length > 0) {
    return {
      ok: false,
      reason: 'missing-glyph',
      detail: `combining marks are positioned by the font's GPOS tables, which this export does not evaluate: ${describeCodePoints(marks)}`,
    };
  }
  if (!resolved.primaryFont) return { ok: true, groups: [] };

  // Shape everything before laying anything out, so an unreproducible sequence
  // refuses instead of emitting a partly-correct line.
  const shapedLines: ShapedRun[][] = [];
  for (const line of lines) {
    const shapedRuns: ShapedRun[] = [];
    for (const segment of segmentRuns(line, (cp) => resolved.fileByCodePoint.get(cp)!)) {
      const { run, blocked } = shapeRun(resolved.fontByUrl.get(segment.file.url)!, segment.text);
      if (blocked !== null) {
        return {
          ok: false,
          reason: 'missing-glyph',
          detail: `${layer.fontFamily} renders "${blocked}" through a contextual feature this export cannot reproduce`,
        };
      }
      shapedRuns.push(run);
    }
    shapedLines.push(shapedRuns);
  }

  const drop = topBaselineDropMm(resolved.primaryFont, layer);
  const lineHeight = layer.sizeMm * TEXT_LINE_HEIGHT_FACTOR;
  const rotation = layer.rotation ?? 0;
  const pivot: Pt = geometry.pivot;
  const place = rotation
    ? (point: KernelPoint): KernelPoint => rotatePoint(point, pivot, rotation)
    : (point: KernelPoint): KernelPoint => point;

  const groups: KernelInput[] = [];
  shapedLines.forEach((runs, index) => {
    const baselineY = geometry.box.y + index * lineHeight + drop;
    let penXMm = geometry.box.x;
    for (const run of runs) {
      const scale = layer.sizeMm / run.font.unitsPerEm;
      const laid = layoutRun(run, penXMm, layer.sizeMm);
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

export const textGeometrySource: LayerGeometrySource = {
  handles: 'text',
  async extract(layer: Layer, ctx: IrExtractContext): Promise<IrLayerResult> {
    const result = await textLayerToGroups(layer as TextLayer);
    if (!result.ok) return unsupportedLayer(layer, result.reason, result.detail);
    // Overlapping glyph outlines must be unioned before emission — regions in
    // one layer are required to be pairwise disjoint (Decision 0.3).
    return {
      kind: 'regions',
      layerId: layer.id,
      regions: await groupsToRegions(result.groups, ctx),
    };
  },
  async extractCubics(layer: Layer): Promise<IrLayerCubicResult> {
    const result = await textLayerToGroups(layer as TextLayer);
    return result.ok
      ? { kind: 'cubics', layerId: layer.id, groups: result.groups }
      : unsupportedLayer(layer, result.reason, result.detail);
  },
};
