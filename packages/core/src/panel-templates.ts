import { panelWidthMm } from './panel-sizes';

// Golden per-(format, hp) catalog of screw-hole geometry, extracted from the
// past-ordered reference boards (1U KiCad sources, 3U ordered gerbers). This
// is the single source of truth for hole placement — holes are DERIVED from
// (format, hp), never stored per document. Consumers: composer rendering, 3D
// preview, Excellon drill export, mask/copper ring injection.
//
// Coordinate contract: every cx/cy below is a canonical fabrication
// coordinate — front view, document space (mm), origin at the panel
// top-left, +y down. A consumer displaying the BACK side mirrors x as
// `width − cx` for display only; drill files and both sides' gerber
// injections use these canonical values as-is.
//
// slotLength is the finished overall length of the slot (round-ended
// stadium, long axis horizontal). The routed span between endpoint centers
// is `slotLength − drillDiameter`.
//
// opening is the solder-mask removal stadium (width × length), centered on
// the hole, long axis horizontal. It is stored per size rather than derived
// from one universal expansion — the 1U (kicad-source) and 3U
// (ordered-gerber) reference sets used different per-side clearances (+0.2mm
// vs +0.4mm) when the boards were laid out.
//
// Re-verification source (not needed to use this module): raw gerber/KiCad
// exports at $HOME/repos/circuits/zudo-blanks/panels/alumi-blanks-v1-*
// (3U dirs hold the ordered gerber/ exports; 1U dirs are KiCad sources
// only). The values below are the normalized design intent — hand-placement
// noise in the raw sources (e.g. a 3.007 y, a 0.025mm origin offset in
// 3U-4hp) has already been cleaned up.

export type PanelFormat = '1U' | '3U';

export const PANEL_FORMAT_HEIGHTS: Record<PanelFormat, number> = {
  '1U': 39.65,
  '3U': 128.5,
};

export function panelHeightMm(format: PanelFormat): number {
  return PANEL_FORMAT_HEIGHTS[format];
}

// 1U is capped at the reference set (no product beyond 10hp exists yet). 3U
// keeps its existing 20hp product size, with rule-derived holes (see the
// `derived` provenance on that entry below).
const SUPPORTED_HPS: Record<PanelFormat, readonly number[]> = {
  '1U': [1, 2, 3, 4, 5, 6, 8, 10],
  '3U': [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20],
};

export function supportedHps(format: PanelFormat): readonly number[] {
  return SUPPORTED_HPS[format];
}

// Where a (format, hp) entry's geometry came from — surfaced so a consumer
// can flag rule-derived (not board-verified) holes, e.g. with a UI badge.
export type PanelTemplateProvenance = 'ordered-gerber' | 'kicad-source' | 'derived';

export interface PanelHole {
  cx: number;
  cy: number;
  shape: 'round' | 'slot';
  drillDiameter: number;
  slotLength?: number;
  opening: { width: number; length: number };
}

// All holes sit at a fixed 3.0mm inset from the top/bottom edge, regardless
// of format or hp.
const EDGE_INSET_MM = 3.0;
const TOP_CY_MM = EDGE_INSET_MM;
const BOTTOM_CY_1U_MM = PANEL_FORMAT_HEIGHTS['1U'] - EDGE_INSET_MM; // 36.65
const BOTTOM_CY_3U_MM = PANEL_FORMAT_HEIGHTS['3U'] - EDGE_INSET_MM; // 125.5

// Drill diameter is 3.2mm everywhere in the golden catalog — round hits and
// slot end-caps alike.
const DRILL_DIAMETER_MM = 3.2;

function roundHole(cx: number, cy: number, openingSize: number): PanelHole {
  return {
    cx,
    cy,
    shape: 'round',
    drillDiameter: DRILL_DIAMETER_MM,
    opening: { width: openingSize, length: openingSize },
  };
}

function slotHole(
  cx: number,
  cy: number,
  slotLength: number,
  openingWidth: number,
  openingLength: number,
): PanelHole {
  return {
    cx,
    cy,
    shape: 'slot',
    drillDiameter: DRILL_DIAMETER_MM,
    slotLength,
    opening: { width: openingWidth, length: openingLength },
  };
}

// Four-slot pattern used by every 3U size at hp >= 12: a mirrored pair of
// slots on both the top and bottom row.
function fourSlots(
  leftCx: number,
  rightCx: number,
  topCy: number,
  bottomCy: number,
  slotLength: number,
  openingWidth: number,
  openingLength: number,
): readonly PanelHole[] {
  return [
    slotHole(leftCx, topCy, slotLength, openingWidth, openingLength),
    slotHole(rightCx, topCy, slotLength, openingWidth, openingLength),
    slotHole(leftCx, bottomCy, slotLength, openingWidth, openingLength),
    slotHole(rightCx, bottomCy, slotLength, openingWidth, openingLength),
  ];
}

interface PanelTemplateEntry {
  readonly provenance: PanelTemplateProvenance;
  readonly holes: readonly PanelHole[];
}

// 1U opening: kicad-source drills, +0.2mm/side mask clearance (opening =
// drill/slotLength + 0.4). Source drills: round at 1hp, oval 3.2x8.0 at
// 2hp, oval 3.2x10.3 at >=3hp.
const ONE_U_OPENING_WIDTH_MM = 3.6;

// 3U opening: ordered-gerber drills, +0.4mm/side mask clearance (opening =
// drill/slotLength + 0.8). Oval 3.2x5.2 at 2hp, oval 3.2x10.28 at >=3hp.
const THREE_U_OPENING_WIDTH_MM = 4.0;

const PANEL_TEMPLATE_CATALOG: Record<PanelFormat, Record<number, PanelTemplateEntry>> = {
  '1U': {
    1: {
      provenance: 'kicad-source',
      holes: [
        roundHole(2.5, TOP_CY_MM, ONE_U_OPENING_WIDTH_MM),
        roundHole(2.5, BOTTOM_CY_1U_MM, ONE_U_OPENING_WIDTH_MM),
      ],
    },
    2: {
      provenance: 'kicad-source',
      holes: [
        slotHole(4.9, TOP_CY_MM, 8.0, ONE_U_OPENING_WIDTH_MM, 8.4),
        slotHole(4.9, BOTTOM_CY_1U_MM, 8.0, ONE_U_OPENING_WIDTH_MM, 8.4),
      ],
    },
    3: {
      provenance: 'kicad-source',
      holes: [
        slotHole(6.04, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(8.85, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
    // NOTE: bottom cx is 8.8 in the kicad source, NOT width - 11.05 (= 8.95)
    // — this is a deliberate/hand-placed asymmetry. Keep the source value.
    4: {
      provenance: 'kicad-source',
      holes: [
        slotHole(11.05, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(8.8, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
    5: {
      provenance: 'kicad-source',
      holes: [
        slotHole(11.05, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(13.95, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
    6: {
      provenance: 'kicad-source',
      holes: [
        slotHole(11.05, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(18.95, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
    8: {
      provenance: 'kicad-source',
      holes: [
        slotHole(11.05, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(29.25, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
    10: {
      provenance: 'kicad-source',
      holes: [
        slotHole(11.05, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
        slotHole(39.45, BOTTOM_CY_1U_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      ],
    },
  },
  '3U': {
    1: {
      provenance: 'ordered-gerber',
      holes: [
        roundHole(2.5, TOP_CY_MM, THREE_U_OPENING_WIDTH_MM),
        roundHole(2.5, BOTTOM_CY_3U_MM, THREE_U_OPENING_WIDTH_MM),
      ],
    },
    2: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(3.505, TOP_CY_MM, 5.2, THREE_U_OPENING_WIDTH_MM, 6.0),
        slotHole(6.295, BOTTOM_CY_3U_MM, 5.2, THREE_U_OPENING_WIDTH_MM, 6.0),
      ],
    },
    3: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(6.045, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(8.855, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    4: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(6.045, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(13.955, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    // NOTE: bottom cx is 14.838 in the ordered gerber, NOT width - 10.16
    // (= 14.84) — a sub-hundredth-mm asymmetry confirmed against the ordered
    // flash coordinates. Keep the source value.
    5: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(10.16, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(14.838, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    6: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(10.16, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(19.84, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    8: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(10.16, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(30.14, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    10: {
      provenance: 'ordered-gerber',
      holes: [
        slotHole(10.16, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
        slotHole(40.34, BOTTOM_CY_3U_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      ],
    },
    12: {
      provenance: 'ordered-gerber',
      holes: fourSlots(
        10.16,
        50.44,
        TOP_CY_MM,
        BOTTOM_CY_3U_MM,
        10.28,
        THREE_U_OPENING_WIDTH_MM,
        11.08,
      ),
    },
    14: {
      provenance: 'ordered-gerber',
      holes: fourSlots(
        10.16,
        60.64,
        TOP_CY_MM,
        BOTTOM_CY_3U_MM,
        10.28,
        THREE_U_OPENING_WIDTH_MM,
        11.08,
      ),
    },
    16: {
      provenance: 'ordered-gerber',
      holes: fourSlots(
        10.16,
        70.74,
        TOP_CY_MM,
        BOTTOM_CY_3U_MM,
        10.28,
        THREE_U_OPENING_WIDTH_MM,
        11.08,
      ),
    },
    // 20hp has no ordered/kicad reference board — holes follow the
    // >=12hp four-slot rule (see deriveHoles below) rather than a real
    // measurement, hence `derived`.
    20: {
      provenance: 'derived',
      holes: fourSlots(
        10.16,
        91.14,
        TOP_CY_MM,
        BOTTOM_CY_3U_MM,
        10.28,
        THREE_U_OPENING_WIDTH_MM,
        11.08,
      ),
    },
  },
};

// Fallback geometry for an (format, hp) pair outside the golden catalog
// above (e.g. an imported document at an HP the reference boards never
// covered). Mirrors the golden catalog's own size-class boundaries instead
// of inventing a new formula:
//   - 3U at hp >= 12: 4 slots, cx = 10.16 and width - 10.16, both rows.
//   - 3U at 5 <= hp < 12: top cx = 10.16, bottom cx = width - 10.16.
//   - 3U below that / 1U: no unlisted hp is possible below these thresholds
//     given panelWidthMm's own fallback table today, so fall back to the
//     nearest listed size's pattern rather than invent geometry with no
//     reference board to check it against.
//   - 1U (any hp): top cx = 11.05, bottom cx = width - 11.05, slot 10.3.
const ONE_U_DERIVED_SLOT_CX_MM = 11.05;
const THREE_U_DERIVED_SLOT_CX_MM = 10.16;

function deriveHoles(format: PanelFormat, hp: number): readonly PanelHole[] {
  const width = panelWidthMm(hp);

  if (format === '1U') {
    return [
      slotHole(ONE_U_DERIVED_SLOT_CX_MM, TOP_CY_MM, 10.3, ONE_U_OPENING_WIDTH_MM, 10.7),
      slotHole(
        width - ONE_U_DERIVED_SLOT_CX_MM,
        BOTTOM_CY_1U_MM,
        10.3,
        ONE_U_OPENING_WIDTH_MM,
        10.7,
      ),
    ];
  }

  if (hp >= 12) {
    return fourSlots(
      THREE_U_DERIVED_SLOT_CX_MM,
      width - THREE_U_DERIVED_SLOT_CX_MM,
      TOP_CY_MM,
      BOTTOM_CY_3U_MM,
      10.28,
      THREE_U_OPENING_WIDTH_MM,
      11.08,
    );
  }

  if (hp >= 5) {
    return [
      slotHole(THREE_U_DERIVED_SLOT_CX_MM, TOP_CY_MM, 10.28, THREE_U_OPENING_WIDTH_MM, 11.08),
      slotHole(
        width - THREE_U_DERIVED_SLOT_CX_MM,
        BOTTOM_CY_3U_MM,
        10.28,
        THREE_U_OPENING_WIDTH_MM,
        11.08,
      ),
    ];
  }

  const nearestHp = nearestListedHp(format, hp);
  return PANEL_TEMPLATE_CATALOG[format][nearestHp].holes;
}

function nearestListedHp(format: PanelFormat, hp: number): number {
  const listedHps = Object.keys(PANEL_TEMPLATE_CATALOG[format]).map(Number);
  return listedHps.reduce((closest, candidate) =>
    Math.abs(candidate - hp) < Math.abs(closest - hp) ? candidate : closest,
  );
}

export function panelHoles(format: PanelFormat, hp: number): readonly PanelHole[] {
  const entry = PANEL_TEMPLATE_CATALOG[format][hp];
  if (entry) return entry.holes;
  return deriveHoles(format, hp);
}

export function panelTemplateProvenance(format: PanelFormat, hp: number): PanelTemplateProvenance {
  const entry = PANEL_TEMPLATE_CATALOG[format][hp];
  return entry ? entry.provenance : 'derived';
}
