// The screw-hole fabrication seam (#231 contract, #235 implementation).
//
// #235 fills THIS file — deriving the template holes from
// `panelHoles(panel.format, panel.hp)`, classifying them PTH (fr4) / NPTH
// (alumi) per Decision 11, building the mask-opening and FR-4 copper-ring
// injection regions, and emitting the tool table / hits / slots into the drill
// bodies below. The SIGNATURES here are final: build-ir.ts and zip.ts are
// already wired to them, so #235 never edits either of those shared files.
import type { PcbMaterial } from '@zpd/core';
import type {
  DrillFileIr,
  DrillIr,
  DrillPlating,
  IrLayerRole,
  IrPanel,
  IrRegion,
} from './ir';
import type { IrTolerance } from './tolerance';
import type { GerberEmitOptions } from './writer';
import {
  GERBER_SOFTWARE_APPLICATION,
  GERBER_SOFTWARE_VENDOR,
} from './writer';

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
   * union+clip: mask openings on 'solder-mask'/'b-solder-mask' (both
   * materials), copper rings on 'copper'/'b-copper' (FR-4 only, Decision 11).
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
 * #235's seam. Stub: no injections, both drill files empty — the zip already
 * ships the full per-material file set with this stub content.
 */
export function injectHoleFabrication(ctx: HoleFabricationContext): HoleFabrication {
  void ctx;
  return { injections: {}, drill: emptyDrillIr() };
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

/** `TF.FileFunction` payloads per the ordered reference sets (KiCad X2 form). */
const DRILL_FILE_FUNCTION: Record<DrillPlating, string> = {
  pth: 'Plated,1,2,PTH',
  npth: 'NonPlated,1,2,NPTH',
};

/**
 * One Excellon file. The header below is byte-modelled on the ordered
 * reference sets (M48, `; #@! TF.*` X2 comment-attributes, FMAT,2, METRIC,
 * `%`, G90, G05 … M30) and is FINAL for the empty case. Body emission — tool
 * table, `X…Y…` hits, G00/M15/G01/M16 slot routing, the Y flip through
 * `coordinate-frame.ts` — is #235's, which extends this function in place.
 * Until then a non-empty DrillFileIr refuses loudly: silently emitting a
 * header-only file for real holes is exactly the plausible-looking-wrong-file
 * Decision 8 exists to prevent.
 */
function drillFileText(file: DrillFileIr, options: GerberEmitOptions): string {
  if (file.tools.length > 0 || file.hits.length > 0 || file.slots.length > 0) {
    throw new Error(
      'Excellon body emission is not implemented yet (#235 fills drillFileText); refusing to drop drill content silently',
    );
  }
  const lines = [
    'M48',
    `; #@! TF.CreationDate,${options.creationDate}`,
    `; #@! TF.GenerationSoftware,${GERBER_SOFTWARE_VENDOR},${GERBER_SOFTWARE_APPLICATION},${options.softwareVersion}`,
    `; #@! TF.FileFunction,${DRILL_FILE_FUNCTION[file.plating]}`,
    'FMAT,2',
    'METRIC',
    '%',
    'G90',
    'G05',
    'M30',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Both drill files, always, PTH first — an absent drill file is another
 * ambiguity a fab has to guess at (same rule as the Gerber file set), and the
 * empty side stays header-only exactly like the ordered reference sets. Pure:
 * same IR and options, same bytes.
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
      text: drillFileText(drill.pth, options),
    },
    {
      plating: 'npth',
      filename: drillFilename('npth', panel.hp),
      text: drillFileText(drill.npth, options),
    },
  ];
}
