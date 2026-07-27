// The screw-hole fabrication seam (#231 contract, #235 implementation).
//
// Template holes come from `panelHoles(panel.format, panel.hp)` (#227) —
// canonical fabrication coordinates: front view, doc space, never mirrored or
// flipped here (Decisions 11/13). This module classifies them PTH (fr4) /
// NPTH (alumi) per Decision 11, builds the mask-opening and FR-4 copper
// stadium injection regions, and fills the drill IR whose bytes excellon.ts
// emits. The SIGNATURES here are final: build-ir.ts and zip.ts are already
// wired to them, so #235 never edits either of those shared files.
import { panelHoles, type PanelHole, type PcbMaterial } from '@zpd/core';
import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';
import { ellipseToRing, ellipticalArcToCubics } from './arc';
import { excellonFileText } from './excellon';
import { flattenRingAdaptive } from './flatten';
import type {
  DrillFileIr,
  DrillHit,
  DrillIr,
  DrillPlating,
  DrillSlot,
  DrillTool,
  IrLayerRole,
  IrPanel,
  IrRegion,
} from './ir';
import { degenerateCubic } from './primitives';
import type { IrTolerance } from './tolerance';
import type { GerberEmitOptions } from './writer';

export interface HoleFabricationContext {
  readonly material: PcbMaterial;
  /** Carries format + hp, which is all `panelHoles` needs to derive the set. */
  readonly panel: IrPanel;
  /** Decision 6's error budget — the stadium/ring outlines are arcs. */
  readonly tolerance: IrTolerance;
}

export interface HoleFabrication {
  /**
   * Regions build-ir APPENDS to the named role's layer after the artwork
   * union+clip — FRONT roles only: mask openings on 'solder-mask' (both
   * materials), copper rings on 'copper' (FR-4 only, Decision 11). The back
   * roles ('b-solder-mask'/'b-copper') are NOT injected here — #236's
   * `back-extract.ts` owns them and derives the same holes from the canonical
   * `panelHoles()` coordinates itself; injecting them from both seams would
   * double every back hole. (An earlier #231-era draft of this comment named
   * the back roles here — that wording predated the #235/#236 split.)
   * Appended regions follow Decision 0's ring rules (flattened, positive
   * outers) and paint AFTER the artwork regions — for a ring region whose
   * hole is the drill barrel, the `%LPC*%` clearing artwork beneath it clears
   * copper that is drilled away regardless. An absent role means no injection.
   */
  readonly injections: Partial<Record<IrLayerRole, readonly IrRegion[]>>;
  readonly drill: DrillIr;
}

export function emptyDrillIr(): DrillIr {
  return {
    pth: { plating: 'pth', tools: [], hits: [], slots: [] },
    npth: { plating: 'npth', tools: [], hits: [], slots: [] },
  };
}

/**
 * Replace an arc chain's first start / last end with the exact tangent points
 * it targets: `ellipticalArcToCubics` computes its endpoints through cos/sin,
 * so a semicircle starting at φ = −π/2 lands ~1e-16 mm off the stadium's flat
 * edge. Snapping keeps the ring exactly closed instead of tolerance-closed.
 */
function snapArcEndpoints(
  arc: readonly KernelCubic[],
  start: KernelPoint,
  end: KernelPoint,
): KernelCubic[] {
  if (arc.length === 0) return [];
  const snapped = [...arc];
  snapped[0] = { ...snapped[0], p0: start };
  snapped[snapped.length - 1] = { ...snapped[snapped.length - 1], p3: end };
  return snapped;
}

/**
 * A stadium (round-ended slot, long axis horizontal) as a closed cubic ring:
 * top edge, right semicircular cap, bottom edge, left cap. The traversal
 * follows arc.ts's increasing-φ direction throughout, so the shoelace signed
 * area is POSITIVE in doc space — an outer ring per Decision 0.2.
 */
function stadiumCubicRing(
  cx: number,
  cy: number,
  r: number,
  halfFlat: number,
  arcToleranceMm: number,
): KernelRing {
  const topLeft = { x: cx - halfFlat, y: cy - r };
  const topRight = { x: cx + halfFlat, y: cy - r };
  const bottomRight = { x: cx + halfFlat, y: cy + r };
  const bottomLeft = { x: cx - halfFlat, y: cy + r };
  const rightCap = snapArcEndpoints(
    ellipticalArcToCubics(cx + halfFlat, cy, r, r, -Math.PI / 2, Math.PI, arcToleranceMm),
    topRight,
    bottomRight,
  );
  const leftCap = snapArcEndpoints(
    ellipticalArcToCubics(cx - halfFlat, cy, r, r, Math.PI / 2, Math.PI, arcToleranceMm),
    bottomLeft,
    topLeft,
  );
  return [
    degenerateCubic(topLeft, topRight),
    ...rightCap,
    degenerateCubic(bottomRight, bottomLeft),
    ...leftCap,
  ];
}

/**
 * A hole's `opening` stadium as a flattened region (Decision 6 budget: arcs
 * within `arcMm`, then flattened within `flattenMm`). A round hole's opening
 * has width === length and degenerates to a circle.
 */
function openingStadiumRegion(hole: PanelHole, tolerance: IrTolerance): IrRegion {
  const r = hole.opening.width / 2;
  const halfFlat = (hole.opening.length - hole.opening.width) / 2;
  const ring =
    halfFlat > 0
      ? stadiumCubicRing(hole.cx, hole.cy, r, halfFlat, tolerance.arcMm)
      : ellipseToRing(hole.cx, hole.cy, hole.opening.length / 2, r, tolerance.arcMm);
  return {
    outer: flattenRingAdaptive(ring, tolerance.flattenMm, tolerance.minSegmentMm),
    holes: [],
  };
}

/**
 * The template holes as drill-file content, in catalog order (top row before
 * bottom row). Tool codes are 1-based over the distinct diameters, ascending —
 * one 3.2 mm tool for every catalog entry today, but grouped generically. A
 * slot's routed span runs between endpoint CENTRES: `slotLength −
 * drillDiameter` long (ir.ts); a slot no longer than its drill is already
 * covered by a single hit, so it degenerates to one.
 */
function drillContent(holes: readonly PanelHole[]): Omit<DrillFileIr, 'plating'> {
  const diameters = [...new Set(holes.map((hole) => hole.drillDiameter))].sort((a, b) => a - b);
  const tools: DrillTool[] = diameters.map((diameterMm, i) => ({ code: i + 1, diameterMm }));
  const codeByDiameter = new Map(tools.map((tool) => [tool.diameterMm, tool.code]));
  const hits: DrillHit[] = [];
  const slots: DrillSlot[] = [];
  for (const hole of holes) {
    const tool = codeByDiameter.get(hole.drillDiameter)!;
    const span = hole.shape === 'slot' ? (hole.slotLength ?? 0) - hole.drillDiameter : 0;
    if (span > 0) {
      slots.push({
        tool,
        start: { x: hole.cx - span / 2, y: hole.cy },
        end: { x: hole.cx + span / 2, y: hole.cy },
      });
    } else {
      hits.push({ tool, x: hole.cx, y: hole.cy });
    }
  }
  return { tools, hits, slots };
}

/**
 * #235's seam, filled: the screw-hole drill pair plus the FRONT injection
 * regions. Back-side hole artwork is #236's (`back-extract.ts`), which
 * derives it from the same canonical `panelHoles()` coordinates — never
 * injected from here, or the merge would double every back hole.
 *
 * - Mask openings go to the front solder-mask role for both materials, the
 *   template coordinates used as-is (Decision 13: injections never mirror).
 * - FR-4 only: a copper stadium of the SAME shape as the opening on the
 *   front copper role. The drill void pierces its centre and the plated
 *   barrel takes the HASL finish — the "gold around the hole" result. Alumi
 *   holes are non-plated bare metal: no copper ring.
 * - Plating is a per-FILE split (Decision 11): FR-4 content in `pth`, alumi
 *   in `npth`; the other side stays empty and ships header-only.
 */
export function injectHoleFabrication(ctx: HoleFabricationContext): HoleFabrication {
  const holes = panelHoles(ctx.panel.format, ctx.panel.hp);
  if (holes.length === 0) return { injections: {}, drill: emptyDrillIr() };

  const openings: readonly IrRegion[] = holes.map((hole) =>
    openingStadiumRegion(hole, ctx.tolerance),
  );
  const injections: Partial<Record<IrLayerRole, readonly IrRegion[]>> =
    ctx.material === 'fr4'
      ? { copper: openings, 'solder-mask': openings }
      : { 'solder-mask': openings };

  const content = drillContent(holes);
  const empty = emptyDrillIr();
  const drill: DrillIr =
    ctx.material === 'fr4'
      ? { pth: { plating: 'pth', ...content }, npth: empty.npth }
      : { pth: empty.pth, npth: { plating: 'npth', ...content } };

  return { injections, drill };
}

// ─── Excellon emission ──────────────────────────────────────────────────────

export interface DrillFile {
  readonly plating: DrillPlating;
  /** drillFilename(plating, hp) — shares gerberFileSet's `zpd-panel-<hp>hp` stem. */
  readonly filename: string;
  readonly text: string;
}

/** Matches the ordered reference sets' `<name>-PTH.drl` / `<name>-NPTH.drl`. */
export function drillFilename(plating: DrillPlating, hp: number): string {
  return `zpd-panel-${hp}hp-${plating === 'pth' ? 'PTH' : 'NPTH'}.drl`;
}

/**
 * Both drill files, always, PTH first — an absent drill file is another
 * ambiguity a fab has to guess at (same rule as the Gerber file set), and the
 * empty side stays header-only exactly like the ordered reference sets. Text
 * emission — header, tool table, hits, routed slots, the Y flip through
 * `coordinate-frame.ts` — is excellon.ts's. Pure: same IR and options, same
 * bytes.
 */
export function drillFileSet(
  drill: DrillIr,
  panel: IrPanel,
  options: GerberEmitOptions,
): readonly [DrillFile, DrillFile] {
  return [
    {
      plating: 'pth',
      filename: drillFilename('pth', panel.hp),
      text: excellonFileText(drill.pth, panel, options),
    },
    {
      plating: 'npth',
      filename: drillFilename('npth', panel.hp),
      text: excellonFileText(drill.npth, panel, options),
    },
  ];
}
