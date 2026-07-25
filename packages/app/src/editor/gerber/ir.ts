/**
 * Gerber geometry IR — the canonical contract (epic #204, sub #209).
 *
 * This file IS the contract pinned by `DECISIONS.md` Decision 0. The RS-274X
 * writer (#210) builds against hand-authored fixtures of these types and must
 * never need to read the extractor's implementation, so the shapes below are
 * copied from that decision record field-for-field. Changing one is a
 * cross-sub-issue break, not a refactor.
 */

import type { Layer } from '@zpd/core';
import type { BooleanEngine, KernelInput } from '../geometry-kernel';
import type { IrTolerance } from './tolerance';

/**
 * A point in DOCUMENT millimetres: origin at the panel's TOP-LEFT, +x right,
 * +y DOWN. This is zpd document space (core/src/types.ts:1), NOT Gerber space.
 * The Y flip to Gerber's bottom-left/+y-up frame happens exactly once, in the
 * writer — see Decision 1.
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
 * - Not self-intersecting (guaranteed by the #206 kernel's arrangement).
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
   * it arrives (Decision 3).
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
   * Disjoint (Decision 0.3), ordered outer-before-contained (Decision 0.3).
   * An empty array is legal and meaningful — see Decision 4 for what an empty
   * solder-mask layer means.
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

// ─── Per-layer extraction hand-off (Decision 0.4) ───────────────────────────

export type IrUnsupportedReason =
  // handed off to another extractor — not an error
  | 'pattern-layer' // #211 owns it
  | 'text-layer' // #212 owns it
  // terminal — becomes a refusal (Decision 8)
  | 'image-layer'
  | 'unknown-pattern-id'
  | 'non-curated-font'
  | 'missing-glyph'
  | 'complexity-overrun';

export type IrLayerResult =
  | {
      readonly kind: 'regions';
      readonly layerId: string;
      readonly regions: readonly IrRegion[]; // may be empty
    }
  | {
      readonly kind: 'unsupported';
      readonly layerId: string;
      readonly layerName: string; // for the refusal dialog (#215)
      readonly reason: IrUnsupportedReason;
      readonly detail?: string; // e.g. the pattern id, the font family
    };

/**
 * What an extractor is handed alongside the layer. Decision 0.4 pins the
 * `LayerGeometrySource` shape but leaves this type to #209, so it carries only
 * what every extractor needs and nothing role-specific: #211 reaches for the
 * pattern registry itself, #212 for the font tables.
 */
export interface IrExtractContext {
  readonly panel: IrPanel;
  /** The material the layer was projected into (never 'outline'). */
  readonly role: Exclude<IrLayerRole, 'outline'>;
  /** The shared kernel engine (#206), already constructed. */
  readonly engine: BooleanEngine;
  /** The Decision 6 error budget, split arc→cubic / cubic→polyline. */
  readonly tolerance: IrTolerance;
}

/**
 * The pre-flatten hand-off, in the kernel's own compound-input form: cubic
 * contours plus the fill rule they are evaluated under. One layer may produce
 * more than one group — a `PathLayer` that is both filled and stroked yields
 * an evenodd fill group and a nonzero stroke-outline group, which cannot share
 * a fill rule.
 */
export type IrLayerCubicResult =
  | {
      readonly kind: 'cubics';
      readonly layerId: string;
      readonly groups: readonly KernelInput[];
    }
  | Extract<IrLayerResult, { kind: 'unsupported' }>;

/**
 * A registered extractor for one `Layer['type']`.
 *
 * `extract` is the surface Decision 0.4 pins, and every source must implement
 * it. `extractCubics` is an ADDITIVE refinement #209 introduces to reconcile
 * Decision 0.4 with Decision 5: the pinned pipeline puts adaptive flattening
 * LAST, after stroke expansion, the union and the profile clip, "so precision
 * is not spent twice and the kernel's exact cubicSignedArea still applies to
 * the real curves" — but `IrLayerResult.regions` is already-flattened
 * `IrRing`s, so a source that only implements `extract` has necessarily
 * flattened before the booleans run.
 *
 * The orchestrator therefore PREFERS `extractCubics` when a source offers it
 * and falls back to `extract` otherwise (a flattened ring is still a valid
 * cubic ring — every edge is a degenerate cubic — so the fallback composes,
 * it just spends the flattening budget one stage early). #209's own `shape`
 * and `path` sources implement both.
 */
export interface LayerGeometrySource {
  readonly handles: Layer['type'];
  extract(layer: Layer, ctx: IrExtractContext): Promise<IrLayerResult>;
  extractCubics?(layer: Layer, ctx: IrExtractContext): Promise<IrLayerCubicResult>;
}

// ─── Refusals (Decision 8) ─────────────────────────────────────────────────

export type GerberRefusalCode =
  | 'unlisted-panel-hp'
  | 'image-layer-present'
  | 'non-curated-font'
  | 'missing-glyph'
  | 'unknown-pattern-id'
  | 'complexity-overrun'
  /**
   * ADDITIVE to Decision 8's list, and deliberately so. Decision 0.4 rules
   * that "anything still unsupported after every registered source has been
   * consulted is a refusal", but a `'pattern-layer'` / `'text-layer'` hand-off
   * with no source registered has no code in Decision 8's table — it is the
   * one unsupported reason that cannot map onto an existing one. Silently
   * dropping the layer is the outcome Decision 8 exists to prevent, so it
   * refuses under its own code instead.
   *
   * Transitional: once #211 and #212 register their sources this becomes
   * unreachable for pattern/text layers. It is a union member rather than a
   * separate result field so #215 still renders ONE collected refusal list,
   * and so an exhaustive switch fails to compile rather than silently skipping.
   */
  | 'unsupported-layer-type';

export interface GerberRefusal {
  readonly code: GerberRefusalCode;
  readonly message: string;
  /** Empty for document-level refusals such as 'unlisted-panel-hp'. */
  readonly layers: readonly { readonly id: string; readonly name: string }[];
}
