// File-kind classifier for native SVG vector import (#138): decides whether
// a dropped/picked file should go through the SVG safety gate
// (parse-svg-document.ts) or fall back to the existing raster import path
// (import-image.ts). Runs before any parsing -- pure byte/name/MIME
// sniffing, so it stays cheap even for a file we end up rejecting.

// SVG is text (small compared to raster formats at the same visual
// complexity); a 2 MiB cap keeps the safety-gate parser's tree walk bounded
// without needing to special-case pathological input sizes there too.
const SVG_BYTE_CAP = 2 * 1024 * 1024;

export type ImportFileKind = 'svg' | 'svg-oversize' | 'raster' | 'other';

// Byte signatures checked against the file's first 16 bytes. A match wins
// over filename/MIME (#138 spec) so e.g. a PNG mislabeled "logo.svg" is
// still routed to the raster import path instead of the XML parser.
const RASTER_MAGIC: { offset: number; bytes: number[] }[] = [
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }, // PNG
  { offset: 0, bytes: [0xff, 0xd8, 0xff] }, // JPEG
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
];

function matchesRasterMagic(head: Uint8Array): boolean {
  const isRiffWebp =
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 && // "RIFF"
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50; // "WEBP"
  if (isRiffWebp) return true;
  return RASTER_MAGIC.some(
    ({ offset, bytes }) =>
      head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b),
  );
}

function claimsSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

// Strips a leading BOM, XML declaration, comments, and whitespace -- in any
// order/repetition, since real-world export tools mix these (e.g. BOM +
// comment + XML decl) -- so the root-tag sniff below only has to match a
// bare "<svg".
function stripSvgPreamble(text: string): string {
  let s = text;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^\uFEFF/, '');
    s = s.replace(/^\s+/, '');
    s = s.replace(/^<\?xml[^?]*\?>/i, '');
    s = s.replace(/^<!--[\s\S]*?-->/, '');
  } while (s !== prev);
  return s;
}

const SVG_ROOT_SNIFF = /^<svg[\s>]/i;

export async function classifyImportFile(file: File): Promise<ImportFileKind> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (matchesRasterMagic(head)) return 'raster';

  const svgClaimed = claimsSvg(file);
  const isImageMime = file.type.startsWith('image/');

  if (file.size > SVG_BYTE_CAP) {
    if (svgClaimed) return 'svg-oversize';
    return isImageMime ? 'raster' : 'other';
  }

  if (svgClaimed) return 'svg';
  // Root-sniff needs the whole under-cap text, not just the 16-byte prefix
  // used for raster magic above -- the preamble stripped before it can
  // legitimately run past 16 bytes (a long XML declaration, a license
  // comment block, ...).
  const text = await file.text();
  if (SVG_ROOT_SNIFF.test(stripSvgPreamble(text))) return 'svg';
  return isImageMime ? 'raster' : 'other';
}
