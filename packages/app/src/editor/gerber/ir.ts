// The geometry IR the Gerber writer consumes. Transcribed verbatim from
// DECISIONS.md Decision 0, which is the authoritative contract — the extractor
// (#209) and this writer (#210) are built independently against it so that a
// contract misunderstanding surfaces as a cross-check failure rather than as
// two implementations quietly agreeing on the same mistake. The extractor-side
// additions of Decision 0.4 (IrLayerResult, LayerGeometrySource) live with the
// extractor; only the types the writer needs are declared here.

/**
 * A point in DOCUMENT millimetres: origin at the panel's TOP-LEFT, +x right,
 * +y DOWN. This is zpd document space (core/src/types.ts:1), NOT Gerber space.
 * The Y flip to Gerber's bottom-left/+y-up frame happens exactly once, in the
 * writer — see coordinate-frame.ts and DECISIONS.md Decision 1.
 */
export interface IrPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A closed polygon ring, ALREADY FLATTENED to straight segments (Decision 6).
 * There are no curves in the IR — Gerber region contours interpolate linearly.
 *
 * - Implicitly closed: the last point is NOT a repeat of the first.
 * - At least 3 points.
 * - Not self-intersecting.
 * - Winding per Decision 0.2.
 */
export type IrRing = readonly IrPoint[];

/** One filled area: an outer boundary plus its immediate holes. */
export interface IrRegion {
  /** Positive signed area in doc space (Decision 0.2). */
  readonly outer: IrRing;
  /**
   * Negative signed area. Each hole lies strictly inside `outer` and does not
   * intersect it or any sibling hole. Geometry nested INSIDE a hole is not a
   * hole-of-a-hole — it is promoted to its own later IrRegion (Decision 0.3).
   */
  readonly holes: readonly IrRing[];
}

export type IrLayerRole = 'copper' | 'solder-mask' | 'silkscreen' | 'outline';

export interface IrLayer {
  readonly role: IrLayerRole;
  /**
   * DECLARATIVE ONLY — copied verbatim into the file's `%TF.FilePolarity,…*%`
   * attribute (Decision 3). It NEVER causes a geometric operation. Solder mask
   * is 'negative' and its geometry is still emitted uncomplemented, exactly as
   * it arrives (Decision 3.2).
   *
   * `null` means the attribute is NOT emitted for this file. The 'outline'
   * role is `null`: file polarity is not meaningful for a Profile.
   */
  readonly filePolarity: 'positive' | 'negative' | null;
  /**
   * How the writer renders `regions`. 'filled-region' → G36/G37 contours.
   * 'stroked-contour' → D02/D01 moves with the profile aperture, used only by
   * the 'outline' role (Decision 2.3).
   */
  readonly renderAs: 'filled-region' | 'stroked-contour';
  /**
   * Disjoint and ordered outer-before-contained (Decision 0.3), so the writer
   * emits them as a plain painter's-algorithm stream with no containment
   * analysis of its own. An empty array is legal and meaningful — see
   * Decision 4 for what an empty solder-mask layer means.
   */
  readonly regions: readonly IrRegion[];
}

export interface IrPanel {
  readonly hp: number;
  /** panelWidthMm(hp) — always a PANEL_SIZES table value (Decision 8). */
  readonly widthMm: number;
  /** PANEL_HEIGHT_MM = 128.5, the Y-flip constant. */
  readonly heightMm: number;
}

export interface GerberIr {
  readonly panel: IrPanel;
  /** Exactly 4 entries, in this order: copper, solder-mask, silkscreen, outline. */
  readonly layers: readonly [IrLayer, IrLayer, IrLayer, IrLayer];
}
