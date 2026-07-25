/**
 * Minimal ambient types for `opentype.js` v2, which ships no declarations of
 * its own (`@types/opentype.js` tracks the 1.3 API and does not match v2's
 * `substitution` / `position` surface).
 *
 * Only the members the text outliner actually calls are declared. Anything
 * added here must be checked against
 * `packages/app/node_modules/opentype.js/dist/opentype.mjs` — a wrong shape
 * here compiles and then fails at runtime.
 */
declare module 'opentype.js' {
  export interface OpenTypePathCommand {
    readonly type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    readonly x?: number;
    readonly y?: number;
    readonly x1?: number;
    readonly y1?: number;
    readonly x2?: number;
    readonly y2?: number;
  }

  export interface OpenTypePath {
    readonly commands: readonly OpenTypePathCommand[];
  }

  export interface OpenTypeGlyph {
    readonly index: number;
    readonly name?: string;
    readonly advanceWidth?: number;
    readonly path: OpenTypePath;
    /**
     * The `glyf` table's own per-glyph bounding box, stored in the glyph header
     * ALONGSIDE the point data rather than derived from it. That independence
     * is why the tests use it as scale/orientation ground truth.
     */
    readonly xMin?: number;
    readonly yMin?: number;
    readonly xMax?: number;
    readonly yMax?: number;
    /** opentype.js's own placement + y-flip; used only as a test oracle. */
    getPath(x: number, y: number, fontSize: number): OpenTypePath;
  }

  /** One GSUB `liga` rule: `sub` INCLUDES the start glyph (see `getLigatures`). */
  export interface OpenTypeLigature {
    readonly sub: readonly number[];
    readonly by: number;
  }

  export interface OpenTypeFont {
    readonly unitsPerEm: number;
    /** hhea ascender, or sTypoAscender when OS/2 sets USE_TYPO_METRICS. */
    readonly ascender: number;
    readonly descender: number;
    readonly numGlyphs: number;
    readonly outlinesFormat: string;
    readonly tables: {
      readonly os2?: {
        readonly sTypoAscender?: number;
        readonly sTypoDescender?: number;
        readonly usWinAscent?: number;
        readonly usWinDescent?: number;
        readonly fsSelection?: number;
      };
      readonly hhea?: {
        readonly ascender?: number;
        readonly descender?: number;
      };
    };
    readonly glyphs: { get(index: number): OpenTypeGlyph | undefined };
    hasChar(c: string): boolean;
    charToGlyphIndex(c: string): number;
    charToGlyph(c: string): OpenTypeGlyph;
    getKerningValue(left: number | OpenTypeGlyph, right: number | OpenTypeGlyph): number;
    readonly substitution: {
      getLigatures(feature: string, script?: string, language?: string): OpenTypeLigature[];
    };
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): OpenTypeFont;
}
