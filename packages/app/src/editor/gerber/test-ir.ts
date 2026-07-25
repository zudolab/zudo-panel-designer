// Hand-authored GerberIr fixtures, written directly against DECISIONS.md
// Decision 0 rather than against the extractor (#209). The two are implemented
// independently on purpose: a contract misunderstanding then shows up as a
// cross-check failure instead of both sides quietly agreeing on it.
//
// These are DOCUMENT-space coordinates (top-left origin, +y DOWN) and are
// deliberately NOT pre-flipped — a pre-flipped fixture would make the Y-flip
// test vacuous (Decision 0.1 / Decision 1).
import type { GerberIr, IrLayer, IrPanel, IrRegion } from './ir';

/** 12HP: panelWidthMm(12) = 60.6, PANEL_HEIGHT_MM = 128.5. */
export const FIXTURE_PANEL: IrPanel = { hp: 12, widthMm: 60.6, heightMm: 128.5 };

export const FIXTURE_OPTIONS = {
  creationDate: '2026-07-25T09:30:00+09:00',
  softwareVersion: '0.0.0',
} as const;

/**
 * An L, top-heavy and left-heavy: NOT symmetric about the panel's horizontal
 * mid-line, so a missing or doubled Y flip changes every emitted Y. Signed area
 * in doc space is +600 mm², so it must read as -600 mm² in Gerber space
 * (Decision 0.2's second Y-flip tripwire).
 */
const L_SHAPE: IrRegion = {
  outer: [
    { x: 5, y: 10 },
    { x: 35, y: 10 },
    { x: 35, y: 20 },
    { x: 15, y: 20 },
    { x: 15, y: 50 },
    { x: 5, y: 50 },
  ],
  holes: [],
};

/** 40x40 square with a 20x20 hole. Hole ring is negative-area, as required. */
const SQUARE_WITH_HOLE: IrRegion = {
  outer: [
    { x: 5, y: 70 },
    { x: 45, y: 70 },
    { x: 45, y: 110 },
    { x: 5, y: 110 },
  ],
  holes: [
    [
      { x: 15, y: 80 },
      { x: 15, y: 100 },
      { x: 35, y: 100 },
      { x: 35, y: 80 },
    ],
  ],
};

/**
 * An island sitting inside SQUARE_WITH_HOLE's hole. Per Decision 0.3 it is its
 * own region appearing LATER in the array, never a hole-of-a-hole — emitting in
 * array order is what makes it survive the `%LPC*%` that cleared its
 * surroundings. Right-triangular, so it is also asymmetric on its own.
 */
const ISLAND_TRIANGLE: IrRegion = {
  outer: [
    { x: 20, y: 85 },
    { x: 30, y: 85 },
    { x: 20, y: 95 },
  ],
  holes: [],
};

export const ASYMMETRIC_REGIONS: readonly IrRegion[] = [L_SHAPE, SQUARE_WITH_HOLE, ISLAND_TRIANGLE];

export const COPPER_LAYER: IrLayer = {
  role: 'copper',
  filePolarity: 'positive',
  renderAs: 'filled-region',
  regions: ASYMMETRIC_REGIONS,
};

export const SILKSCREEN_LAYER: IrLayer = {
  role: 'silkscreen',
  filePolarity: 'positive',
  renderAs: 'filled-region',
  regions: [L_SHAPE],
};

/** The clipped board outline as a doc-space rectangle, positive signed area. */
export const PANEL_RECTANGLE: IrRegion = {
  outer: [
    { x: 0, y: 0 },
    { x: FIXTURE_PANEL.widthMm, y: 0 },
    { x: FIXTURE_PANEL.widthMm, y: FIXTURE_PANEL.heightMm },
    { x: 0, y: FIXTURE_PANEL.heightMm },
  ],
  holes: [],
};

export const OUTLINE_LAYER: IrLayer = {
  role: 'outline',
  // null, not 'positive': the Profile file emits no TF.FilePolarity at all.
  filePolarity: null,
  renderAs: 'stroked-contour',
  regions: [PANEL_RECTANGLE],
};

// --- Decision 4, the solder-mask container matrix. All three rows. ---------
// Every row declares Negative polarity; only the geometry differs, and it is
// always uncomplemented.

function maskLayer(regions: readonly IrRegion[]): IrLayer {
  return { role: 'solder-mask', filePolarity: 'negative', renderAs: 'filled-region', regions };
}

/** Container hidden ⇒ no mask anywhere ⇒ ONE full-panel opening region. */
export const MASK_LAYER_CONTAINER_HIDDEN = maskLayer([PANEL_RECTANGLE]);

/** Container visible but empty ⇒ full mask coverage ⇒ ZERO regions. */
export const MASK_LAYER_EMPTY = maskLayer([]);

/** Container visible with leaves ⇒ those leaves are the openings, as-is. */
export const MASK_LAYER_WITH_OPENINGS = maskLayer([SQUARE_WITH_HOLE, ISLAND_TRIANGLE]);

export function fixtureIr(maskLayerOverride: IrLayer = MASK_LAYER_WITH_OPENINGS): GerberIr {
  return {
    panel: FIXTURE_PANEL,
    layers: [COPPER_LAYER, maskLayerOverride, SILKSCREEN_LAYER, OUTLINE_LAYER],
  };
}
