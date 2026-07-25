// FABRICATION-CRITICAL (DECISIONS.md Decision 1).
//
// zpd document space is top-left origin, +y DOWN. Gerber is a top view of the
// board with +y UP, origin at the panel's bottom-left. This module is the ONLY
// file in the repository permitted to compute `panelHeightMm - y`; it is
// grep-able on purpose. No extractor, no recorder, no fixture may pre-flip.
//
// Every emitted coordinate passes through here exactly once. Skipping the flip
// mirrors the whole panel — text reads backwards and the boards are scrap.
// Applying it twice is exactly as wrong, and looks identical to not applying
// it at all, so both failure modes are pinned by tests on an asymmetric ring.
import type { IrPoint, IrRing } from './ir';

export function toGerberPoint(p: IrPoint, panelHeightMm: number): IrPoint {
  return { x: p.x, y: panelHeightMm - p.y };
}

/**
 * Ring-level convenience so the writer never performs Y arithmetic itself.
 * Vertex order is preserved: Gerber region polarity is `%LPD*%`/`%LPC*%`,
 * never traversal direction, so rings are never re-wound (Decision 0.2).
 */
export function toGerberRing(ring: IrRing, panelHeightMm: number): IrRing {
  return ring.map((p) => toGerberPoint(p, panelHeightMm));
}
