import { GERBER_ARTWORK_ONLY_STATEMENT } from './artwork-only-statement';
export { GERBER_ARTWORK_ONLY_STATEMENT } from './artwork-only-statement';
// Pure `.zip` + README assembly (#215): GerberIr in, zip bytes out. No DOM, no
// filesystem — mirroring writer.ts's own split from any DOM concern, which is
// what `download.ts`'s DOM shell for downloadGerberZip() builds on.
//
// fflate's `mtime` defaults to `Date.now()` (see its ZipAttributes doc), which
// would make the zip bytes non-deterministic the same way an ambient
// `Date.now()` inside the writer would (Decision 3.3) — so `options.creationDate`
// is reused as the zip's mtime too, keeping this function pure: same IR, same
// options, same bytes, always.
import { strToU8, zipSync } from 'fflate';
import type { GerberIr } from './ir';
import {
  gerberFileSet,
  GERBER_ROLE_EXTENSION,
  GERBER_ROLE_LABEL,
  type GerberEmitOptions,
} from './writer';

/** Matches `download.ts`'s `zpd-panel-<hp>hp.json`. */
export function gerberZipFilename(hp: number): string {
  return `zpd-panel-${hp}hp-gerber.zip`;
}


/**
 * File→function mapping, panel dimensions, and the artwork-only statement
 * (Decision 2.2's README.txt). ASCII only, LF-terminated — same discipline as
 * writer.ts's Gerber bodies, for the same reason (Decision 3.4).
 *
 * Builds filenames/labels from writer.ts's ROLE_SPEC lookup tables rather
 * than calling gerberFileSet() a second time — that would pay for a full
 * Gerber body serialization just to read four filenames.
 */
export function gerberReadmeText(ir: GerberIr): string {
  const rows = ir.layers.map((layer) => {
    const filename = `zpd-panel-${ir.panel.hp}hp${GERBER_ROLE_EXTENSION[layer.role]}`;
    return `  ${filename}  —  ${GERBER_ROLE_LABEL[layer.role]}`;
  });
  const lines = [
    'zpd Gerber export',
    '',
    GERBER_ARTWORK_ONLY_STATEMENT,
    '',
    `Panel: ${ir.panel.hp}HP, ${ir.panel.widthMm} x ${ir.panel.heightMm} mm.`,
    '',
    'Files:',
    ...rows,
    '',
    'No Excellon drill file. No bottom-side files. No paste layer.',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * All four Gerber files plus README.txt, zipped. Pure: the same IR and
 * options always produce the same bytes (fflate's DEFLATE is itself
 * deterministic for a given input/level, and `mtime` is pinned above).
 */
export function gerberZipBytes(ir: GerberIr, options: GerberEmitOptions): Uint8Array<ArrayBuffer> {
  const files = gerberFileSet(ir, options);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.filename] = strToU8(file.text);
  entries['README.txt'] = strToU8(gerberReadmeText(ir));
  return zipSync(entries, { mtime: new Date(options.creationDate) });
}
