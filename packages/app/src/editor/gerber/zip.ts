import { GERBER_EXPORT_SCOPE_STATEMENT, PCB_MATERIAL_LABEL } from './artwork-only-statement';
export { GERBER_EXPORT_SCOPE_STATEMENT } from './artwork-only-statement';
// Pure `.zip` + README assembly (#215): GerberIr in, zip bytes out. No DOM, no
// filesystem — mirroring writer.ts's own split from any DOM concern, which is
// what `download.ts`'s DOM shell for downloadGerberZip() builds on.
//
// fflate's `mtime` defaults to `Date.now()` (see its ZipAttributes doc), which
// would make the zip bytes non-deterministic the same way an ambient
// `Date.now()` inside the writer would (Decision 3.3) — so `options.creationDate`
// is reused as the zip's mtime too, keeping this function pure: same IR, same
// options, same bytes, always.
import type { PcbMaterial } from '@zpd/core';
import { strToU8, zipSync } from 'fflate';
import { drillFilename, drillFileSet } from './holes';
import type { DrillPlating, GerberIr } from './ir';
import {
  gerberFileSet,
  GERBER_ROLE_EXTENSION,
  GERBER_ROLE_LABEL,
  type GerberEmitOptions,
} from './writer';

// The outer zip filename is the shared download-filename helper's (#229) —
// kept in its own module so the gerber contract sub-issue (#231) and this one
// can each land without fighting over the same function body. #231's own
// 3-arg construction was dropped at merge: it lowercased the format, which
// would have disagreed with the sibling JSON download (`zpd-panel-3U-12hp.json`).
export { gerberZipFilename } from '../filename';

/**
 * README rows for the drill pair: which side carries the screw holes is the
 * per-material Decision 11 split, and saying so here is cheaper than a fab
 * guessing why one file is header-only.
 */
const DRILL_LABEL: Record<PcbMaterial, Record<DrillPlating, string>> = {
  fr4: {
    pth: 'plated screw-hole drill (round hits and routed slots)',
    npth: 'non-plated drill (empty - FR-4 screw holes are plated)',
  },
  alumi: {
    pth: 'plated drill (empty - aluminum screw holes are non-plated)',
    npth: 'non-plated screw-hole drill (round hits and routed slots)',
  },
};

const MATERIAL_NOTE: Record<PcbMaterial, string> = {
  fr4: 'FR-4 panel: screw holes are plated through (PTH), and the bottom-side files carry the back design.',
  alumi:
    'Aluminum panel: screw holes are non-plated (NPTH). The back is bare metal - the bottom solder mask file carries the screw-hole openings only.',
};

/**
 * File→function mapping, panel dimensions, and the export-scope statement
 * (Decision 2.2's README.txt). ASCII only, LF-terminated — same discipline as
 * writer.ts's Gerber bodies, for the same reason (Decision 3.4).
 *
 * Builds filenames/labels from writer.ts's ROLE_SPEC lookup tables rather
 * than calling gerberFileSet() a second time — that would pay for a full
 * Gerber body serialization just to read the filenames.
 */
export function gerberReadmeText(ir: GerberIr): string {
  const rows = ir.layers.map((layer) => {
    const filename = `zpd-panel-${ir.panel.hp}hp${GERBER_ROLE_EXTENSION[layer.role]}`;
    return `  ${filename}  —  ${GERBER_ROLE_LABEL[layer.role]}`;
  });
  const drillRows = (['pth', 'npth'] as const).map(
    (plating) =>
      `  ${drillFilename(plating, ir.panel.hp)}  —  ${DRILL_LABEL[ir.material][plating]}`,
  );
  const lines = [
    'zpd Gerber export',
    '',
    GERBER_EXPORT_SCOPE_STATEMENT,
    '',
    `Panel: ${ir.panel.format} ${ir.panel.hp}HP, ${ir.panel.widthMm} x ${ir.panel.heightMm} mm. Material: ${PCB_MATERIAL_LABEL[ir.material]}.`,
    '',
    'Files:',
    ...rows,
    ...drillRows,
    '',
    MATERIAL_NOTE[ir.material],
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * The material's full manifest — every Gerber file in MATERIAL_LAYER_ROLES
 * order, both Excellon drill files, README.txt — zipped. Pure: the same IR and
 * options always produce the same bytes (fflate's DEFLATE is itself
 * deterministic for a given input/level, and `mtime` is pinned above).
 */
export function gerberZipBytes(ir: GerberIr, options: GerberEmitOptions): Uint8Array<ArrayBuffer> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of gerberFileSet(ir, options)) entries[file.filename] = strToU8(file.text);
  for (const file of drillFileSet(ir.drill, ir.panel, options)) {
    entries[file.filename] = strToU8(file.text);
  }
  entries['README.txt'] = strToU8(gerberReadmeText(ir));
  return zipSync(entries, { mtime: new Date(options.creationDate) });
}
