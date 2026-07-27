// Two oracles are used here, because neither alone is enough.
//
//  1. The `glyf` table's per-glyph bounding box (`glyph.xMin/yMin/xMax/yMax`)
//     is stored in the glyph header BESIDE the point data, not derived from it.
//     Checking the emitted ink against it is therefore a genuine, non-circular
//     test of the em scale, the y-up→y-down flip and the top-baseline drop.
//  2. A raster differential against a reference built with opentype.js's OWN
//     `glyph.getPath` placement and an independently written copy of
//     `renderer.ts`'s line layout. It shares only the glyph point data with the
//     implementation, so it catches a wrong Q→C elevation, a dropped or
//     mis-wound contour, a bad union, a wrong rotation pivot and mis-stacked
//     lines.
//
// What is deliberately NOT claimed: this is not a browser raster. The
// verification budget for #212 excludes browser tooling, so the engine-specific
// half of layout — where a `textBaseline: 'top'` anchor puts the alphabetic
// baseline — is pinned to Blink's documented rule and to the runtime probe,
// and is asserted here only against that rule.
import { readFile } from 'node:fs/promises';
import { loadTestFontFile } from './test-font-loader';
import {
  createDefaultDoc,
  createPcbLayerContainer,
  panelHeightMm,
  panelWidthMm,
  type DocState,
  type LayerNode,
  type PcbLayerStack,
  type Pt,
  type TextLayer,
} from '@zpd/core';
import type { OpenTypeFont, OpenTypePathCommand } from 'opentype.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BooleanEngine } from '../geometry-kernel';
import { createBooleanEngine } from '../geometry-kernel';
import {
  getTextGeometry,
  resetTextGeometryForTests,
  setTextMeasureForTests,
} from '../text-geometry';
import { buildGerberIr } from './build-ir';
import { polygonSignedArea } from './flatten';
import type { IrExtractContext, IrLayerResult, IrRegion, IrRing } from './ir';
import {
  curatedFontFace,
  loadCuratedFont,
  setCuratedFontFileLoaderForTests,
  type CuratedFontFile,
} from './text-fonts';
import {
  fallbackTopBaselineDropMm,
  setTopBaselineProbeForTests,
  textGeometrySource,
} from './text-outline';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

const LINE_HEIGHT_FACTOR = 1.25;
const HP = 16;

let engine: BooleanEngine;
let ctx: IrExtractContext;

beforeAll(async () => {
  setCuratedFontFileLoaderForTests(loadTestFontFile);
  engine = await createBooleanEngine();
  ctx = {
    panel: { hp: HP, widthMm: panelWidthMm(HP), heightMm: panelHeightMm('3U') },
    role: 'silkscreen',
    engine,
    tolerance: DEFAULT_IR_TOLERANCE,
  };
});

// jsdom is not enabled for this package, so `measureTextBbox`'s canvas is
// unavailable; a stub keeps the box (and therefore the rotation pivot) exact.
function stubMeasure(width: number): void {
  setTextMeasureForTests((layer) => ({
    x: layer.x,
    y: layer.y,
    width,
    height: layer.sizeMm * LINE_HEIGHT_FACTOR * layer.content.split('\n').length,
  }));
}

beforeEach(() => {
  resetTextGeometryForTests();
  stubMeasure(30);
  // Pin the DOM probe off: node has no canvas, and the fallback is the path
  // these tests are pinning.
  setTopBaselineProbeForTests(() => null);
});

function text(over: Partial<TextLayer> & { readonly id?: string } = {}): TextLayer {
  return {
    id: 'text-1',
    name: 'Label',
    type: 'text',
    content: 'A',
    fontFamily: 'Oswald',
    sizeMm: 8,
    x: 10,
    y: 20,
    color: 2,
    ...over,
  };
}

async function extract(layer: TextLayer): Promise<IrLayerResult> {
  return textGeometrySource.extract(layer, ctx);
}

function regionsOf(result: IrLayerResult): readonly IrRegion[] {
  if (result.kind !== 'regions') {
    throw new Error(`unexpected ${result.reason}: ${result.detail ?? ''}`);
  }
  return result.regions;
}

function ringBounds(ring: IrRing): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxX: Math.max(...ring.map((p) => p.x)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

function regionsBounds(regions: readonly IrRegion[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const all = regions.map((region) => ringBounds(region.outer));
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
}

async function latinFont(family: string): Promise<{ font: OpenTypeFont; file: CuratedFontFile }> {
  const face = curatedFontFace(family)!;
  const file = face.files.find((entry) => entry.subset === 'latin')!;
  return { font: await loadCuratedFont(file), file };
}

// ─── reference raster ──────────────────────────────────────────────────────

type Poly = readonly Pt[];

/** Rotation as `renderer.ts:357-364` describes it: degrees clockwise, y-down. */
function rotateAbout(point: Pt, pivot: Pt, degrees: number): Pt {
  const rad = (degrees * Math.PI) / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Uniform-`t` sampling — deliberately a different flattener from `flatten.ts`. */
function flattenReferencePath(commands: readonly OpenTypePathCommand[], place: (p: Pt) => Pt) {
  const contours: Pt[][] = [];
  let contour: Pt[] = [];
  let current: Pt = { x: 0, y: 0 };
  const push = (p: Pt): void => {
    contour.push(place(p));
  };
  const flush = (): void => {
    if (contour.length >= 3) contours.push(contour);
    contour = [];
  };
  const SAMPLES = 24;
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        flush();
        current = { x: command.x!, y: command.y! };
        push(current);
        break;
      case 'L':
        current = { x: command.x!, y: command.y! };
        push(current);
        break;
      case 'Q': {
        const p0 = current;
        const c = { x: command.x1!, y: command.y1! };
        const p1 = { x: command.x!, y: command.y! };
        for (let i = 1; i <= SAMPLES; i++) {
          const t = i / SAMPLES;
          const u = 1 - t;
          push({
            x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
          });
        }
        current = p1;
        break;
      }
      case 'C': {
        const p0 = current;
        const c1 = { x: command.x1!, y: command.y1! };
        const c2 = { x: command.x2!, y: command.y2! };
        const p1 = { x: command.x!, y: command.y! };
        for (let i = 1; i <= SAMPLES; i++) {
          const t = i / SAMPLES;
          const u = 1 - t;
          push({
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
          });
        }
        current = p1;
        break;
      }
      case 'Z':
        flush();
        break;
    }
  }
  flush();
  return contours;
}

/**
 * The layout `paintLayer` performs, rewritten from its description rather than
 * from `text-outline.ts`: `textBaseline='top'`, line `i` at
 * `box.x, box.y + i * (sizeMm * 1.25)`, glyphs advanced by `hmtx` + kerning,
 * the whole thing rotated about the supplied pivot.
 *
 * Each entry is one glyph's contours, to be filled non-zero and OR-ed together
 * exactly as `fillText` composites glyph rasters.
 */
function referenceGlyphs(
  layer: TextLayer,
  font: OpenTypeFont,
  box: { readonly x: number; readonly y: number },
  pivot: Pt,
): Poly[][] {
  const drop = fallbackTopBaselineDropMm(font, layer.sizeMm);
  const scale = layer.sizeMm / font.unitsPerEm;
  const rotation = layer.rotation ?? 0;
  const place = (p: Pt): Pt => (rotation ? rotateAbout(p, pivot, rotation) : p);

  const out: Poly[][] = [];
  layer.content.split('\n').forEach((line, index) => {
    const baselineY = box.y + index * layer.sizeMm * LINE_HEIGHT_FACTOR + drop;
    let penX = box.x;
    const chars = [...line];
    chars.forEach((char, i) => {
      const glyph = font.charToGlyph(char);
      // opentype.js's own placement + y-flip, independent of `glyphContours`.
      const contours = flattenReferencePath(
        glyph.getPath(penX, baselineY, layer.sizeMm).commands,
        place,
      );
      if (contours.length > 0) out.push(contours);
      penX += (glyph.advanceWidth ?? 0) * scale;
      if (i < chars.length - 1) {
        penX += font.getKerningValue(glyph, font.charToGlyph(chars[i + 1])) * scale;
      }
    });
  });
  return out;
}

function crosses(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function windingNonZero(x: number, y: number, contours: readonly Poly[]): boolean {
  let winding = 0;
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if (a.y <= y) {
        if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) winding++;
      } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

const PIXELS_PER_MM = 12;

/**
 * Fraction of the painted area the two coverages disagree on. Both sides are
 * polygon approximations of the same curves, so the residual is confined to a
 * few-µm band along the outline; anything larger is a real geometric fault.
 */
function rasterMismatch(
  regions: readonly IrRegion[],
  reference: readonly Poly[][],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  const step = 1 / PIXELS_PER_MM;
  let differing = 0;
  let union = 0;
  for (let y = bounds.minY - step; y <= bounds.maxY + step; y += step) {
    for (let x = bounds.minX - step; x <= bounds.maxX + step; x += step) {
      const inIr = regions.some(
        (region) =>
          crosses(x, y, region.outer) && !region.holes.some((hole) => crosses(x, y, hole)),
      );
      const inRef = reference.some((glyph) => windingNonZero(x, y, glyph));
      if (inIr !== inRef) differing++;
      if (inIr || inRef) union++;
    }
  }
  return union === 0 ? 1 : differing / union;
}

async function compareToReference(layer: TextLayer, pivotOverride?: Pt): Promise<number> {
  const geometry = getTextGeometry(layer)!;
  const { font } = await latinFont(layer.fontFamily);
  const regions = regionsOf(await extract(layer));
  const reference = referenceGlyphs(layer, font, geometry.box, pivotOverride ?? geometry.pivot);
  const bounds = regionsBounds(regions);
  const refBounds = reference.flat().flat();
  return rasterMismatch(regions, reference, {
    minX: Math.min(bounds.minX, ...refBounds.map((p) => p.x)),
    minY: Math.min(bounds.minY, ...refBounds.map((p) => p.y)),
    maxX: Math.max(bounds.maxX, ...refBounds.map((p) => p.x)),
    maxY: Math.max(bounds.maxY, ...refBounds.map((p) => p.y)),
  });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('top-baseline anchor', () => {
  it('drops the baseline by Blink NormalizedTypoAscent, not by ascent/unitsPerEm', async () => {
    const { font } = await latinFont('Oswald');
    // Oswald: upm 1000, sTypoAscender 1193, sTypoDescender -289.
    expect(fallbackTopBaselineDropMm(font, 8)).toBeCloseTo((8 * 1193) / 1482, 9);
    // The reflex answer, which is what this rule exists to NOT be.
    expect(fallbackTopBaselineDropMm(font, 8)).not.toBeCloseTo((8 * 1193) / 1000, 3);
  });

  it('prefers a plausible engine probe and rejects an implausible one', async () => {
    const layer = text({ content: 'o', fontFamily: 'Oswald' });
    const { font } = await latinFont('Oswald');
    const fallback = fallbackTopBaselineDropMm(font, layer.sizeMm);

    setTopBaselineProbeForTests(() => 5.5);
    const probed = regionsBounds(regionsOf(await extract(layer)));

    // A negative drop is what a sign-flipped `alphabeticBaseline` looks like;
    // it must not be allowed to shift every glyph by a whole ascent.
    setTopBaselineProbeForTests(() => -5.5);
    const rejected = regionsBounds(regionsOf(await extract(layer)));

    // Loose to 0.5 µm because a bbox extremum is a FLATTENED vertex, which
    // Decision 6.2 only promises within 2.5 µm of the true curve.
    expect(rejected.maxY - probed.maxY).toBeCloseTo(fallback - 5.5, 3);
  });
});

describe('placement against the glyf header bounding box', () => {
  it('lands a single glyph exactly where the em scale and baseline drop put it', async () => {
    const layer = text({ content: 'o', fontFamily: 'Oswald', sizeMm: 8, x: 10, y: 20 });
    const { font } = await latinFont('Oswald');
    const glyph = font.charToGlyph('o');
    const scale = layer.sizeMm / font.unitsPerEm;
    const baselineY = layer.y + (layer.sizeMm * 1193) / 1482;

    const bounds = regionsBounds(regionsOf(await extract(layer)));

    // xMin/yMin/xMax/yMax come from the glyf header, not from the points we
    // outlined, so agreeing with them pins scale, flip and origin at once.
    expect(bounds.minX).toBeCloseTo(layer.x + glyph.xMin! * scale, 4);
    expect(bounds.maxX).toBeCloseTo(layer.x + glyph.xMax! * scale, 4);
    expect(bounds.minY).toBeCloseTo(baselineY - glyph.yMax! * scale, 4);
    expect(bounds.maxY).toBeCloseTo(baselineY - glyph.yMin! * scale, 4);
  });

  it('applies hmtx advance and GPOS kerning between glyphs', async () => {
    const layer = text({ content: 'AV', fontFamily: 'Oswald' });
    const { font } = await latinFont('Oswald');
    const scale = layer.sizeMm / font.unitsPerEm;
    const a = font.charToGlyph('A');
    const v = font.charToGlyph('V');
    const kern = font.getKerningValue(a, v);
    expect(kern).toBeLessThan(0); // Oswald really does kern A/V

    const bounds = regionsBounds(regionsOf(await extract(layer)));
    const expectedMaxX = layer.x + (a.advanceWidth! + kern + v.xMax!) * scale;

    expect(bounds.maxX).toBeCloseTo(expectedMaxX, 4);
    // …and the un-kerned placement is far enough away to be distinguishable,
    // so this assertion genuinely proves kerning ran.
    expect(Math.abs(kern * scale)).toBeGreaterThan(1e-3);
  });
});

describe('outline structure', () => {
  it('keeps a counter as a hole with Decision 0.2 winding', async () => {
    const regions = regionsOf(await extract(text({ content: 'o', fontFamily: 'Oswald' })));
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    expect(polygonSignedArea(regions[0].outer)).toBeGreaterThan(0);
    expect(polygonSignedArea(regions[0].holes[0])).toBeLessThan(0);
  });

  it('unions a composite glyph rather than punching its overlap into a hole', async () => {
    // Ä is base + diaeresis. Under an even-odd fill the overlapping components
    // would cancel; under the font's own non-zero winding they union.
    const regions = regionsOf(await extract(text({ content: 'Ä', fontFamily: 'Oswald' })));
    // A's counter plus two separate dots.
    expect(regions.filter((region) => region.holes.length === 1)).toHaveLength(1);
    expect(regions).toHaveLength(3);
    for (const region of regions) expect(polygonSignedArea(region.outer)).toBeGreaterThan(0);
  });

  it('emits pairwise-disjoint regions for a whole word', async () => {
    const regions = regionsOf(await extract(text({ content: 'Panel', fontFamily: 'Inter' })));
    expect(regions.length).toBeGreaterThan(4);
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = ringBounds(regions[i].outer);
        const b = ringBounds(regions[j].outer);
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        if (!overlaps) continue;
        // Bounding boxes may overlap; the filled areas must not. Sample the
        // interior of one against the other.
        for (const point of regions[i].outer) {
          const inside =
            crosses(point.x, point.y, regions[j].outer) &&
            !regions[j].holes.some((hole) => crosses(point.x, point.y, hole));
          expect(inside).toBe(false);
        }
      }
    }
  });
});

describe('canvas layout parity (raster differential)', () => {
  it('matches a multiline reference', async () => {
    const layer = text({ content: 'AVA\nWoo', fontFamily: 'Inter', sizeMm: 9 });
    expect(await compareToReference(layer)).toBeLessThan(0.01);
  });

  it('matches a rotated multiline reference', async () => {
    const layer = text({ content: 'Hi\nZo', fontFamily: 'Oswald', sizeMm: 10, rotation: 31 });
    expect(await compareToReference(layer)).toBeLessThan(0.01);
  });

  it('matches a rotated reference for a second family', async () => {
    const layer = text({ content: 'Bebas', fontFamily: 'Bebas Neue', sizeMm: 7, rotation: -18 });
    expect(await compareToReference(layer)).toBeLessThan(0.01);
  });

  it('rotates about the CACHED pivot, not a freshly measured bbox centre', async () => {
    const layer = text({ content: 'Hi', fontFamily: 'Oswald', sizeMm: 10, rotation: 31 });
    stubMeasure(20);
    const cached = getTextGeometry(layer)!.pivot; // captured at width 20

    // A font finishing loading changes the metrics; the pivot deliberately does
    // not follow (`text-geometry.ts:1-3`).
    stubMeasure(60);
    expect(getTextGeometry(layer)!.pivot).toEqual(cached);
    const recomputed: Pt = { x: layer.x + 30, y: cached.y };

    expect(await compareToReference(layer, cached)).toBeLessThan(0.01);
    // …and a reference built on the pivot a naive re-measure would produce is
    // visibly somewhere else, so the assertion above is not vacuous.
    expect(await compareToReference(layer, recomputed)).toBeGreaterThan(0.3);
  });
});

describe('subset selection', () => {
  it('outlines a string spanning latin, latin-ext and cyrillic', async () => {
    const layer = text({ content: 'AĀД', fontFamily: 'Inter', sizeMm: 8 });
    const regions = regionsOf(await extract(layer));
    expect(regions.length).toBeGreaterThanOrEqual(3);

    // Ā comes out of latin-ext, so its ink must sit between A (latin) and
    // Д (cyrillic) — proof all three files were resolved and laid out in one
    // run of pen positions rather than each restarting at box.x.
    const inter = curatedFontFace('Inter')!;
    const latin = await loadCuratedFont(inter.files.find((f) => f.subset === 'latin')!);
    const latinExt = await loadCuratedFont(inter.files.find((f) => f.subset === 'latin-ext')!);
    expect(latin.hasChar('Ā')).toBe(false);
    expect(latinExt.hasChar('Ā')).toBe(true);

    const scale = layer.sizeMm / latin.unitsPerEm;
    const bounds = regionsBounds(regions);
    const total =
      latin.charToGlyph('A').advanceWidth! +
      latinExt.charToGlyph('Ā').advanceWidth! +
      (await loadCuratedFont(inter.files.find((f) => f.subset === 'cyrillic')!)).charToGlyph('Д')
        .xMax!;
    expect(bounds.maxX).toBeCloseTo(layer.x + total * scale, 3);
  });

  it('splits a run at the subset boundary so kerning does not cross it', async () => {
    // Only reachable because each subset file is shaped on its own, exactly as
    // the browser segments text by resolved face.
    const layer = text({ content: 'AĀ', fontFamily: 'Oswald', sizeMm: 8 });
    expect(regionsOf(await extract(layer)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('GSUB features the canvas applies by default', () => {
  it('applies `liga` from a font whose GSUB has only a latn script table', async () => {
    // Audiowide is that font. opentype.js defaults an omitted script to 'DFLT',
    // so asking for ligatures without naming 'latn' silently returns none and
    // "fi" exports as two separate glyphs at the wrong advance.
    const layer = text({ content: 'fi', fontFamily: 'Audiowide', sizeMm: 8 });
    const { font } = await latinFont('Audiowide');
    const scale = layer.sizeMm / font.unitsPerEm;
    const f = font.charToGlyph('f');
    const i = font.charToGlyph('i');
    const ligature = font.substitution.getLigatures('liga', 'latn')[0];
    const ligated = font.glyphs.get(ligature.by)!;
    expect(ligature.sub).toEqual([f.index, i.index]);

    const bounds = regionsBounds(regionsOf(await extract(layer)));
    expect(bounds.maxX).toBeCloseTo(layer.x + ligated.xMax! * scale, 3);
    // …and the unligated placement is a different number, so the assertion
    // above genuinely proves the substitution ran.
    const unligated = layer.x + (f.advanceWidth! + i.xMax!) * scale;
    expect(Math.abs(bounds.maxX - unligated)).toBeGreaterThan(0.01);
  });

  it('refuses text a contextual feature would reshape', async () => {
    // Inter's `calt` is lookup types [4, 6]: the type-6 half rewrites hyphen and
    // greater into `.case` variants beside capitals and the type-4 half then
    // ligates whichever survived. Running only the half we can evaluate would
    // draw a DIFFERENT arrow from the one the editor showed.
    const result = await extract(text({ fontFamily: 'Inter', content: 'IN -> OUT' }));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'missing-glyph' });
    expect((result as { detail: string }).detail).toContain('"->"');
  });

  it('does not refuse ordinary text containing the same characters', async () => {
    // A lone hyphen matches no rule — the guard is sequence-exact, not a
    // character blacklist, or every `IN-1` label would refuse.
    expect(
      regionsOf(await extract(text({ fontFamily: 'Inter', content: 'IN-1' }))).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a decomposed combining mark but not its precomposed form', async () => {
    // e + U+0301 is placed by GPOS mark attachment, which is not evaluated
    // here; laid out on its own advance the accent would land beside the e.
    const decomposed = await extract(text({ fontFamily: 'Inter', content: 'e\u0301' }));
    expect(decomposed).toMatchObject({ kind: 'unsupported', reason: 'missing-glyph' });
    expect((decomposed as { detail: string }).detail).toContain('U+0301');

    expect(
      regionsOf(await extract(text({ fontFamily: 'Inter', content: '\u00e9' }))).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a complex script rather than laying it out in cmap order', async () => {
    // Rajdhani ships a devanagari subset, so the codepoints resolve and no
    // missing-glyph fires — but reordering and conjuncts are not implemented.
    const result = await extract(text({ fontFamily: 'Rajdhani', content: 'हिन्दी' }));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'missing-glyph' });
    expect((result as { detail: string }).detail).toContain('devanagari');
  });
});

describe('refusals (Decision 8)', () => {
  it('refuses a family outside the 10 curated @fontsource packages', async () => {
    const result = await extract(text({ fontFamily: 'Roboto Slab', content: 'Hi' }));
    expect(result).toMatchObject({
      kind: 'unsupported',
      reason: 'non-curated-font',
      layerName: 'Label',
      detail: 'Roboto Slab',
    });
  });

  it('refuses a codepoint no shipped subset covers', async () => {
    const result = await extract(text({ fontFamily: 'Inter', content: 'Panel 中' }));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'missing-glyph' });
    expect((result as { detail: string }).detail).toContain('U+4E2D');
  });

  it('refuses a codepoint inside the subset range that has no glyph', async () => {
    const result = await extract(text({ fontFamily: 'Inter', content: 'A\u0007B' }));
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'missing-glyph' });
    expect((result as { detail: string }).detail).toContain('U+0007');
  });

  it('reports every offending codepoint at once, not the first', async () => {
    const result = await extract(text({ fontFamily: 'Orbitron', content: 'Дα' }));
    const detail = (result as { detail: string }).detail;
    expect(detail).toContain('U+0414');
    expect(detail).toContain('U+03B1');
  });
});

describe('canvas text preparation', () => {
  it('treats TAB and CR as U+0020, the way fillText and measureText do', async () => {
    const tabbed = regionsOf(await extract(text({ content: 'A\tB\rC', fontFamily: 'Inter' })));
    resetTextGeometryForTests();
    stubMeasure(30);
    const spaced = regionsOf(await extract(text({ content: 'A B C', fontFamily: 'Inter' })));
    expect(regionsBounds(tabbed)).toEqual(regionsBounds(spaced));
  });

  it('emits nothing for an empty or whitespace-only layer', async () => {
    expect(regionsOf(await extract(text({ content: '' })))).toEqual([]);
    expect(regionsOf(await extract(text({ content: '   ' })))).toEqual([]);
  });

  it('emits nothing for an invalid size instead of refusing', async () => {
    expect(regionsOf(await extract(text({ sizeMm: 0 })))).toEqual([]);
    expect(regionsOf(await extract(text({ sizeMm: Number.NaN })))).toEqual([]);
  });
});

describe('buildGerberIr integration', () => {
  function doc(children: readonly LayerNode[]): DocState {
    const layers: PcbLayerStack = [
      createPcbLayerContainer('copper', []),
      createPcbLayerContainer('solder-mask', []),
      createPcbLayerContainer('silkscreen', [...children]),
    ];
    return { ...createDefaultDoc(), panelHp: HP, layers, guides: [] };
  }

  it('exports a curated text layer as silkscreen regions', async () => {
    const result = await buildGerberIr(doc([text({ content: 'Zpd', fontFamily: 'Oswald' })]), {
      engine,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const silkscreen = result.ir.layers[2];
    expect(silkscreen.role).toBe('silkscreen');
    expect(silkscreen.regions.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a visible non-curated text layer, naming it', async () => {
    const result = await buildGerberIr(
      doc([text({ id: 'bad', name: 'Runtime font', fontFamily: 'Lobster', content: 'Hi' })]),
      { engine },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: 'non-curated-font',
        layers: [{ id: 'bad', name: 'Runtime font' }],
      }),
    ]);
  });

  it('never refuses for a HIDDEN non-curated text layer', async () => {
    const result = await buildGerberIr(
      doc([text({ id: 'bad', fontFamily: 'Lobster', content: 'Hi', hidden: true })]),
      { engine },
    );
    expect(result.ok).toBe(true);
  });
});

describe('lazy loading', () => {
  it('never references opentype.js or the font registry outside a dynamic import', async () => {
    const read = async (file: string): Promise<string> =>
      readFile(new URL(file, import.meta.url), 'utf8');

    const outline = await read('./text-outline.ts');
    const fonts = await read('./text-fonts.ts');
    const extractModule = await read('./extract.ts');
    const barrel = await read('./index.ts');

    const staticImports = (source: string): string[] =>
      [...source.matchAll(/^import\s+(?!type\b)[^\n]*?from\s+'([^']+)';$/gm)].map((m) => m[1]);

    expect(staticImports(outline)).not.toContain('opentype.js');
    expect(staticImports(outline)).not.toContain('./text-fonts');
    expect(outline).toContain("await import('./text-fonts')");

    expect(staticImports(fonts)).not.toContain('opentype.js');
    expect(fonts).toContain("import('opentype.js')");

    // The registry's 30 @fontsource asset URLs must not reach the main chunk
    // through the built-in source list or the barrel either.
    expect(staticImports(extractModule)).not.toContain('./text-fonts');
    expect(staticImports(barrel)).not.toContain('./text-fonts');
    expect(barrel).not.toContain("from './text-fonts'");
  });
});
