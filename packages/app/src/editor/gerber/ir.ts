/**
 * Gerber geometry IR — the canonical contract (epic #204, sub #209; revised
 * for fabrication output by the material-holes epic #226, sub #231).
 *
 * This file IS the contract pinned by `DECISIONS.md` Decision 0. The RS-274X
 * writer (#210) builds against hand-authored fixtures of these types and must
 * never need to read the extractor's implementation, so the shapes below are
 * copied from that decision record field-for-field. Changing one is a
 * cross-sub-issue break, not a refactor. The #231 revision extends the same
 * contract with back-side roles, a per-material layer list, and the Excellon
 * drill IR that #235 (drill + hole/ring injection) and #236 (back-side
 * extraction) fill in parallel — neither may need to change a shape here.
 */

import type { Layer, PanelFormat, PcbMaterial } from '@zpd/core';
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

/**
 * Front roles, back roles (`b-` prefix), and the profile. Back-role geometry
 * is ALREADY X-mirrored into canonical fabrication coordinates (front view,
 * doc space) when it reaches an `IrLayer` — the mirror happens exactly once,
 * at the build-IR boundary, never in the writer (Decision 13).
 */
export type IrLayerRole =
  | 'copper'
  | 'solder-mask'
  | 'silkscreen'
  | 'b-copper'
  | 'b-solder-mask'
  | 'b-silkscreen'
  | 'outline';

export type BackLayerRole = Extract<IrLayerRole, `b-${string}`>;

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
  readonly format: PanelFormat;
  readonly hp: number;
  /** panelWidthMm(hp) — always a PANEL_SIZES table value (Decision 8). */
  readonly widthMm: number;
  /** panelHeightMm(doc.format) — the format-derived Y-flip constant (39.65 for 1U, 128.5 for 3U). */
  readonly heightMm: number;
}

/**
 * Declarative role metadata, pinned by Decision 3.1's attribute table. The
 * writer copies `filePolarity` from the layer, but every builder of an
 * `IrLayer` (build-ir, #235's injections, #236's back extraction, fixtures)
 * reads the value from here so the table has one owner.
 */
export const ROLE_FILE_POLARITY: Record<IrLayerRole, IrLayer['filePolarity']> = {
  copper: 'positive',
  // Negative polarity is DECLARATIVE. The geometry stays uncomplemented.
  'solder-mask': 'negative',
  silkscreen: 'positive',
  'b-copper': 'positive',
  'b-solder-mask': 'negative',
  'b-silkscreen': 'positive',
  outline: null,
};

const FRONT_ROLES = ['copper', 'solder-mask', 'silkscreen'] as const;

/**
 * Which back files a material ships (Decision 12): FR-4 has a real editable
 * back; alumi replicates the ordered-reference convention — a B.Mask carrying
 * ONLY the screw-hole openings (that exact data produced bare-metal backs on
 * the real orders), no B.Cu and no B.Silk.
 */
export const MATERIAL_BACK_ROLES: Record<PcbMaterial, readonly BackLayerRole[]> = {
  fr4: ['b-copper', 'b-solder-mask', 'b-silkscreen'],
  alumi: ['b-solder-mask'],
};

/**
 * The exact `GerberIr.layers` role list per material, in emission order:
 * front, back, outline. `buildGerberIr` produces layers in this order and the
 * zip's per-material manifest follows it entry for entry (Decision 2.1).
 */
export const MATERIAL_LAYER_ROLES: Record<PcbMaterial, readonly IrLayerRole[]> = {
  fr4: [...FRONT_ROLES, ...MATERIAL_BACK_ROLES.fr4, 'outline'],
  alumi: [...FRONT_ROLES, ...MATERIAL_BACK_ROLES.alumi, 'outline'],
};

export interface GerberIr {
  readonly material: PcbMaterial;
  readonly panel: IrPanel;
  /** One entry per MATERIAL_LAYER_ROLES[material], in that order. */
  readonly layers: readonly IrLayer[];
  /** Both drill files, always — one side is empty per material (Decision 11). */
  readonly drill: DrillIr;
}

// ─── Excellon drill IR (Decision 11) ────────────────────────────────────────
//
// The drill-side sibling of the polygon IR above: what `PTH.drl` / `NPTH.drl`
// carry, kept in the same DOCUMENT-space millimetres as every other IR
// coordinate. The Excellon writer flips to the shared bottom-left origin via
// `coordinate-frame.ts` exactly like the Gerber writer — never here.

/**
 * Plated vs non-plated, which is a per-FILE split in Excellon (two files, two
 * `TF.FileFunction` headers), not a per-hit flag. FR-4 screw holes are PTH,
 * alumi screw holes are NPTH (Decision 11) — so exactly one of a document's
 * two drill files ever has content.
 */
export type DrillPlating = 'pth' | 'npth';

export interface DrillTool {
  /** Excellon tool number: `T<code>` in the tool table and the body. 1-based. */
  readonly code: number;
  /** Drill diameter in mm — the `C` parameter, e.g. `T1C3.200`. */
  readonly diameterMm: number;
}

/** One round hole: a plain `X…Y…` stroke of the selected tool. */
export interface DrillHit {
  /** References DrillTool.code within the same file. */
  readonly tool: number;
  /** Hole centre, doc space mm. */
  readonly x: number;
  readonly y: number;
}

/**
 * One routed slot (`G00` to start, `M15` plunge, `G01` to end, `M16` retract
 * — the ordered reference sets' exact idiom). `start`/`end` are the endpoint
 * CENTRES of the routed span: for a template slot that span is
 * `slotLength − drillDiameter` long (panel-templates.ts), NOT the finished
 * overall stadium length.
 */
export interface DrillSlot {
  readonly tool: number;
  readonly start: IrPoint;
  readonly end: IrPoint;
}

export interface DrillFileIr {
  readonly plating: DrillPlating;
  /** Tool table in `code` order. Empty ⇒ the file is emitted header-only. */
  readonly tools: readonly DrillTool[];
  readonly hits: readonly DrillHit[];
  readonly slots: readonly DrillSlot[];
}

/**
 * Both files, always present (an absent drill file is an ambiguity a fab has
 * to guess at, same rule as the Gerber file set). The empty side is emitted
 * header-only, matching the ordered reference sets.
 */
export interface DrillIr {
  readonly pth: DrillFileIr;
  readonly npth: DrillFileIr;
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
  | 'unsupported-layer-type'
  /**
   * ADDITIVE to Decision 8's closed list, and deliberately so (#215/#218).
   * `path-bool`, the #206 kernel's boolean backend, corrupts the union for a
   * measured subset of the 62 registered pattern generators — not a tolerance
   * quibble, but the wrong shape entirely on some (`seigaiha` unions to 100%
   * wrong) and a near-total area loss on others (`via-grid-array` retains
   * 0.5%). Decision 8's binding rule is "a refusal aborts the export; no file
   * is produced" — silently shipping known-corrupted fabrication geometry is
   * exactly what that rule exists to prevent, so a pattern layer naming one
   * of these ids refuses instead.
   *
   * The affected set is `pattern-union-unreliable.generated.ts`, a GENERATED
   * constant (not hand-maintained) measured by the same end-to-end sweep
   * `pattern-parity.test.ts` ratchets against — see that file's header. When
   * #218 fixes the union backend, regenerating collapses the set to empty and
   * this code stops firing for every pattern, with no code change here.
   */
  | 'pattern-union-unreliable';

export interface GerberRefusal {
  readonly code: GerberRefusalCode;
  readonly message: string;
  /** Empty for document-level refusals such as 'unlisted-panel-hp'. */
  readonly layers: readonly { readonly id: string; readonly name: string }[];
}

/**
 * What a build-IR seam (#236's back extraction) is handed to report refusals
 * INTO the one shared collection — Decision 8 requires every refusal in a
 * single dialog, so a seam never builds its own `GerberRefusal[]`.
 * `buildGerberIr`'s internal collector satisfies this structurally.
 */
export interface RefusalSink {
  add(code: GerberRefusalCode, layer?: { readonly id: string; readonly name: string }): void;
}
