// Pure RS-274X (Gerber X2) emitter: GerberIr in, file strings out. No DOM, no
// ambient clock, no filesystem — mirroring download.ts's split of the pure
// panelConfigJson() from the DOM-bound downloadPanelConfig(), which is what
// makes the exact produced bytes assertable in a unit test.
//
// Everything here is pinned by DECISIONS.md; that document is authoritative
// wherever this comment, the issue bodies or README.md disagree with it.
import { toGerberRing } from './coordinate-frame';
import type { GerberIr, IrLayer, IrLayerRole, IrPanel, IrPoint, IrRegion, IrRing } from './ir';

/** `%TF.GenerationSoftware,<vendor>,<application>,<version>*%` (Decision 3.3). */
export const GERBER_SOFTWARE_VENDOR = 'zudolab';
export const GERBER_SOFTWARE_APPLICATION = 'zudo-panel-designer';

export interface GerberEmitOptions {
  /**
   * ISO-8601 with timezone, e.g. `2026-07-25T09:30:00+09:00`. An EXPLICIT
   * parameter, never `Date.now()` read inside the emitter (Decision 3.3) — an
   * ambient timestamp would destroy the byte-exact assertions that are the
   * entire reason for the pure/DOM split.
   */
  readonly creationDate: string;
  /** Version string for TF.GenerationSoftware. Supplied by the caller. */
  readonly softwareVersion: string;
}

export type GerberFileExtension =
  | '.GTL'
  | '.GTS'
  | '.GTO'
  | '.GBL'
  | '.GBS'
  | '.GBO'
  | '.GKO';

export interface GerberFile {
  readonly role: IrLayerRole;
  readonly extension: GerberFileExtension;
  /** `zpd-panel-<hp>hp<ext>`, matching download.ts's `zpd-panel-<hp>hp.json`. */
  readonly filename: string;
  readonly text: string;
}

interface RoleSpec {
  readonly extension: GerberFileExtension;
  /** Exact `%TF.FileFunction,…*%` payload (Decision 3.1). */
  readonly fileFunction: string;
  /** ASCII-only G04 label. User-supplied layer names are never echoed here. */
  readonly label: string;
}

const ROLE_SPEC: Record<IrLayerRole, RoleSpec> = {
  // L1/L2 declare the two-layer stackup: front copper is the top of it, back
  // copper the bottom. The layer numbers are the declaration — X2 has no
  // separate stackup attribute at this level.
  copper: { extension: '.GTL', fileFunction: 'Copper,L1,Top', label: 'top copper' },
  'solder-mask': {
    extension: '.GTS',
    fileFunction: 'Soldermask,Top',
    label: 'top solder mask',
  },
  silkscreen: { extension: '.GTO', fileFunction: 'Legend,Top', label: 'top silkscreen' },
  'b-copper': { extension: '.GBL', fileFunction: 'Copper,L2,Bot', label: 'bottom copper' },
  'b-solder-mask': {
    extension: '.GBS',
    fileFunction: 'Soldermask,Bot',
    label: 'bottom solder mask',
  },
  'b-silkscreen': { extension: '.GBO', fileFunction: 'Legend,Bot', label: 'bottom silkscreen' },
  outline: { extension: '.GKO', fileFunction: 'Profile,NP', label: 'board outline profile' },
};

// Extension/label-only views of ROLE_SPEC, for callers (zip.ts's README) that
// need a filename or a plain-English label without paying for a full
// gerberLayerText() serialization.
export const GERBER_ROLE_EXTENSION: Record<IrLayerRole, GerberFileExtension> = Object.fromEntries(
  (Object.entries(ROLE_SPEC) as [IrLayerRole, RoleSpec][]).map(([role, spec]) => [
    role,
    spec.extension,
  ]),
) as Record<IrLayerRole, GerberFileExtension>;

export const GERBER_ROLE_LABEL: Record<IrLayerRole, string> = Object.fromEntries(
  (Object.entries(ROLE_SPEC) as [IrLayerRole, RoleSpec][]).map(([role, spec]) => [
    role,
    spec.label,
  ]),
) as Record<IrLayerRole, string>;

const FILE_POLARITY_ATTRIBUTE: Record<NonNullable<IrLayer['filePolarity']>, string> = {
  positive: 'Positive',
  negative: 'Negative',
};

// %FSLAX46Y46*%: 6 decimal digits, so the on-disk integer is nanometres.
const COORDINATE_SCALE = 1e6;

/**
 * Decision 3.4. Coordinates are non-negative after the profile clip, so
 * Math.round's asymmetric half-up behaviour on negatives never applies.
 * "Leading zeros omitted" means the plain integer, unpadded.
 */
function coordinate(mm: number): string {
  return String(Math.round(mm * COORDINATE_SCALE));
}

/** Both X and Y on every operation — no modal omission (Decision 3.4). */
function operation(p: IrPoint, dCode: 'D01' | 'D02'): string {
  return `X${coordinate(p.x)}Y${coordinate(p.y)}${dCode}*`;
}

/**
 * Never `target.push(...lines)`. Decision 8's ceiling allows 2,000,000 flattened
 * vertices across the IR, so a single legal ring can be far past the ~125,000
 * arguments V8 accepts in one call — spreading it throws RangeError and aborts
 * an otherwise valid export.
 */
function append(target: string[], lines: readonly string[]): void {
  for (const line of lines) target.push(line);
}

/**
 * One implicitly-closed IR ring as an explicitly-closed Gerber contour. The
 * closing segment is emitted even though the spec auto-closes a region: it
 * removes any chance of the two closure conventions disagreeing (Decision 3.5).
 */
function contourLines(ring: IrRing, panelHeightMm: number): string[] {
  const gerberRing = toGerberRing(ring, panelHeightMm);
  const first = gerberRing[0];
  const lines = [operation(first, 'D02')];
  for (let i = 1; i < gerberRing.length; i += 1) lines.push(operation(gerberRing[i], 'D01'));
  lines.push(operation(first, 'D01'));
  return lines;
}

function filledRegionLines(region: IrRegion, panelHeightMm: number): string[] {
  const lines = ['G36*'];
  append(lines, contourLines(region.outer, panelHeightMm));
  lines.push('G37*');
  // Even-odd holes are expressed as per-region polarity, not as winding: clear
  // each hole, then restore dark so the next region paints (Decision 3.5).
  for (const hole of region.holes) {
    lines.push('%LPC*%', 'G36*');
    append(lines, contourLines(hole, panelHeightMm));
    lines.push('G37*', '%LPD*%');
  }
  return lines;
}

/**
 * Decision 2.3: the profile is a cut path, not a fill — a filled region on a
 * profile layer is ambiguous about which side of the boundary is board. Holes
 * are emitted as further closed contours at the same polarity; `%LPC*%` has no
 * fabrication meaning on a Profile file.
 */
function strokedContourLines(region: IrRegion, panelHeightMm: number): string[] {
  const lines = contourLines(region.outer, panelHeightMm);
  for (const hole of region.holes) append(lines, contourLines(hole, panelHeightMm));
  return lines;
}

function headerLines(layer: IrLayer, panel: IrPanel, options: GerberEmitOptions): string[] {
  const spec = ROLE_SPEC[layer.role];
  const lines = [
    `G04 ${GERBER_SOFTWARE_APPLICATION} ${panel.format} ${panel.hp}HP panel - ${spec.label}*`,
    '%FSLAX46Y46*%',
    '%MOMM*%',
    `%TF.FileFunction,${spec.fileFunction}*%`,
  ];
  // null for the 'outline' role: file polarity is not meaningful for a Profile
  // and an unasked-for attribute there breaks the byte-exact fixtures.
  if (layer.filePolarity !== null) {
    lines.push(`%TF.FilePolarity,${FILE_POLARITY_ATTRIBUTE[layer.filePolarity]}*%`);
  }
  lines.push(
    `%TF.GenerationSoftware,${GERBER_SOFTWARE_VENDOR},${GERBER_SOFTWARE_APPLICATION},${options.softwareVersion}*%`,
    `%TF.CreationDate,${options.creationDate}*%`,
    // Carries the decorative-copper caveat INSIDE every file, so it survives
    // the file being separated from both the zip README and the export UI.
    // The old "no drill data" wording retired with #231: the export ships
    // Excellon drill files now, but the copper is still artwork, not nets.
    '%TF.Part,Other,Decorative front panel - copper is artwork not a circuit*%',
    // Asserts all emitted files share one origin. Decision 3.3 says to drop this
    // if an independent validator rejects the no-identifier form; neither
    // third-party parser in writer-oracle.test.ts does — both treat it as a
    // well-formed extended command they simply do not interpret — so it stays.
    '%TF.SameCoordinates*%',
    // Region mode ignores the current aperture, but some parsers reject a file
    // that never defines one, and the profile contour genuinely strokes with it.
    '%ADD10C,0.010*%',
    'D10*',
    'G01*',
    '%LPD*%',
  );
  return lines;
}

/**
 * One layer as a complete RS-274X file. Pure: the same IR and options always
 * produce the same bytes. LF-terminated, ASCII only (Decision 3.4).
 */
export function gerberLayerText(
  layer: IrLayer,
  panel: IrPanel,
  options: GerberEmitOptions,
): string {
  const emitRegion = layer.renderAs === 'filled-region' ? filledRegionLines : strokedContourLines;
  const lines = headerLines(layer, panel, options);
  // Emitted in IR order: regions are disjoint and ordered outer-before-contained
  // upstream, so this is a plain painter's-algorithm stream with no containment
  // analysis here (Decision 0.3).
  for (const region of layer.regions) append(lines, emitRegion(region, panel.heightMm));
  lines.push('M02*');
  return `${lines.join('\n')}\n`;
}

/**
 * Every file in the material's role list (MATERIAL_LAYER_ROLES order), always
 * — an absent file is another ambiguity a fab has to guess at, and an empty
 * `.GTS` is meaningful rather than neutral (Decision 4).
 */
export function gerberFileSet(ir: GerberIr, options: GerberEmitOptions): readonly GerberFile[] {
  return ir.layers.map((layer): GerberFile => {
    const { extension } = ROLE_SPEC[layer.role];
    return {
      role: layer.role,
      extension,
      filename: `zpd-panel-${ir.panel.hp}hp${extension}`,
      text: gerberLayerText(layer, ir.panel, options),
    };
  });
}
