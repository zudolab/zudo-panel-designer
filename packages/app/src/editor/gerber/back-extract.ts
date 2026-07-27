// The back-side extraction seam (#231 contract, #236 implementation).
//
// #236 fills THIS file — projecting `doc.backLayers` through the same
// extract → union → clip pipeline the front runs, applying Decision 4's mask
// matrix to the back mask container, and X-MIRRORING every extracted ring
// into canonical fabrication coordinates (front view, doc space:
// `x → panel.widthMm − x`) HERE, at the build-IR boundary. That mirror
// happens exactly once and never in the writer (Decision 13) — the writer
// treats a `b-*` layer byte-for-byte like its front counterpart.
//
// The SIGNATURE here is final: build-ir.ts is already wired to it, so #236
// never edits that shared file.
import type { DocState } from '@zpd/core';
import type { BooleanEngine } from '../geometry-kernel';
import type { IrLayer, IrPanel, LayerGeometrySource, RefusalSink } from './ir';
import { MATERIAL_BACK_ROLES, ROLE_FILE_POLARITY } from './ir';
import type { IrComplexityLimits, IrTolerance } from './tolerance';

export interface BackExtractContext {
  /** Carries `backLayers` and `material` — the two doc facts the seam reads. */
  readonly doc: DocState;
  readonly panel: IrPanel;
  /** The shared kernel engine, already constructed — same instance as the front. */
  readonly engine: BooleanEngine;
  /** Every registered source, in front-extraction consultation order. */
  readonly sources: readonly LayerGeometrySource[];
  readonly tolerance: IrTolerance;
  readonly limits: IrComplexityLimits;
}

/**
 * #236's seam: the material's back layers (MATERIAL_BACK_ROLES order),
 * regions already X-mirrored into front-view doc space. Refusals from back
 * extraction go through `refusals` so Decision 8's single collected dialog
 * holds front and back problems together.
 *
 * Stub: every back layer with zero regions. For the FR-4 back mask that
 * deliberately reads as FULL back coverage (Decision 4 row 2) — the correct
 * physical default for an untouched back. The alumi `b-solder-mask` stays
 * empty here permanently; its screw-hole openings are #235's injections, not
 * extraction (Decision 12).
 */
export async function extractBackLayers(
  ctx: BackExtractContext,
  refusals: RefusalSink,
): Promise<readonly IrLayer[]> {
  void refusals;
  return MATERIAL_BACK_ROLES[ctx.doc.material].map((role) => ({
    role,
    filePolarity: ROLE_FILE_POLARITY[role],
    renderAs: 'filled-region',
    regions: [],
  }));
}
