// Pure Excellon drill emitter: DrillFileIr in, file text out — the drill-side
// sibling of writer.ts (#235, Decision 11). No DOM, no ambient clock: the same
// IR and options always produce the same bytes, which is what makes the
// fixtures byte-exact.
//
// The whole file is byte-modelled on the ordered reference sets (KiCad-style
// Excellon 2): M48 header with `; #@! TF.*` X2 comment-attributes, FMAT,2,
// METRIC, the `T<code>C<diameter>` tool table, `%` end-of-header, G90
// (absolute) + G05 (drill mode), plain `X…Y…` hits, routed slots, T0 unload,
// M30. Coordinates are DECIMAL millimetres (the reference convention:
// absolute, metric, decimal), not the zero-suppressed integer form.
import { toGerberPoint } from './coordinate-frame';
import type { DrillFileIr, DrillPlating, IrPanel, IrPoint } from './ir';
import type { GerberEmitOptions } from './writer';
import { GERBER_SOFTWARE_APPLICATION, GERBER_SOFTWARE_VENDOR } from './writer';

/** `TF.FileFunction` payloads per the ordered reference sets (KiCad X2 form). */
const DRILL_FILE_FUNCTION: Record<DrillPlating, string> = {
  pth: 'Plated,1,2,PTH',
  npth: 'NonPlated,1,2,NPTH',
};

/**
 * Decimal-coordinate formatting at Excellon's conventional 1/1000 mm
 * resolution, useless trailing zeros stripped (`125.500` → `125.5`) — the
 * reference convention's "decimal" idiom. Also used for the tool table's `C`
 * diameter, so one formatter owns every number in the file (`T1C3.2`, not
 * `T1C3.200`).
 *
 * A whole number keeps ONE decimal digit (`3.000` → `3.0`, never a bare `3`):
 * without a decimal point the token is indistinguishable from the
 * zero-suppressed integer form, and the excellon.test.ts oracle showed
 * `gerber-parser` decoding a bare `Y3` as 0.003 or 300 mm depending on its
 * suppression guess — an ambiguity a fab's CAM could trip on identically.
 * The point pins the decimal interpretation for every reader.
 */
function excellonNumber(mm: number): string {
  const stripped = mm.toFixed(3).replace(/0+$/, '');
  return stripped.endsWith('.') ? `${stripped}0` : stripped;
}

/** Doc-space point → `X…Y…` fragment, Y-flipped through the ONE allowed boundary. */
function coordinates(p: IrPoint, panelHeightMm: number): string {
  const g = toGerberPoint(p, panelHeightMm);
  return `X${excellonNumber(g.x)}Y${excellonNumber(g.y)}`;
}

/**
 * One Excellon file. The empty case (no tools) emits the header-only form the
 * #231 stub pinned byte-for-byte — a material's unused plating side ships
 * exactly that, matching the ordered reference sets (Decision 11).
 *
 * Body layout per tool, in tool-table order: `T<code>` select, round hits as
 * `X…Y…`, then each slot as the routed `G00` (move) / `M15` (plunge) / `G01`
 * (cut) / `M16` (retract) sequence — the reference sets' idiom, NOT `G85`.
 * `T0` unloads before `M30` whenever a tool was loaded.
 *
 * A hit or slot naming a tool absent from the table refuses loudly: silently
 * dropping drill content is exactly the plausible-looking-wrong-file failure
 * Decision 8 exists to prevent.
 */
export function excellonFileText(
  file: DrillFileIr,
  panel: IrPanel,
  options: GerberEmitOptions,
): string {
  const known = new Set(file.tools.map((tool) => tool.code));
  for (const op of [...file.hits, ...file.slots]) {
    if (!known.has(op.tool)) {
      throw new Error(
        `drill ${file.plating} content references tool T${op.tool}, which is not in the tool table; refusing to drop drill content silently`,
      );
    }
  }

  const lines = [
    'M48',
    `; #@! TF.CreationDate,${options.creationDate}`,
    `; #@! TF.GenerationSoftware,${GERBER_SOFTWARE_VENDOR},${GERBER_SOFTWARE_APPLICATION},${options.softwareVersion}`,
    `; #@! TF.FileFunction,${DRILL_FILE_FUNCTION[file.plating]}`,
    'FMAT,2',
    'METRIC',
  ];
  for (const tool of file.tools) {
    lines.push(`T${tool.code}C${excellonNumber(tool.diameterMm)}`);
  }
  lines.push('%', 'G90', 'G05');
  // Drill vs route mode is MODAL in Excellon: after a G00/M15/G01/M16
  // sequence the machine stays in route mode, so a later tool's bare `X…Y…`
  // would read as another routed move, not a drill hit. Re-arm drill mode
  // with G05 before any hit block that follows routing.
  let routed = false;
  for (const tool of file.tools) {
    lines.push(`T${tool.code}`);
    for (const hit of file.hits) {
      if (hit.tool !== tool.code) continue;
      if (routed) {
        lines.push('G05');
        routed = false;
      }
      lines.push(coordinates(hit, panel.heightMm));
    }
    for (const slot of file.slots) {
      if (slot.tool !== tool.code) continue;
      routed = true;
      lines.push(
        `G00${coordinates(slot.start, panel.heightMm)}`,
        'M15',
        `G01${coordinates(slot.end, panel.heightMm)}`,
        'M16',
      );
    }
  }
  if (file.tools.length > 0) lines.push('T0');
  lines.push('M30');
  return `${lines.join('\n')}\n`;
}
