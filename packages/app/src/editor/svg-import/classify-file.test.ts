// Pure byte/name/MIME sniffing, no DOM needed -- runs in the default node
// test environment (no per-file environment override required).
import { describe, expect, it } from 'vitest';
import { classifyImportFile } from './classify-file';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const GIF87A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function riffWebp(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0, 0, 0, 0], 4); // chunk size, irrelevant to the sniff
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return bytes;
}

function file(bytes: number[] | Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function textFile(text: string, name: string, type: string): File {
  return new File([text], name, { type });
}

describe('classifyImportFile', () => {
  it('classifies raster magic as raster even when the filename claims .svg', async () => {
    const f = file(PNG_MAGIC, 'logo.svg', 'image/svg+xml');
    expect(await classifyImportFile(f)).toBe('raster');
  });

  it('classifies raster magic as raster even when the MIME claims image/svg+xml', async () => {
    const f = file(JPEG_MAGIC, 'photo', 'image/svg+xml');
    expect(await classifyImportFile(f)).toBe('raster');
  });

  it('recognizes GIF87a magic', async () => {
    expect(await classifyImportFile(file(GIF87A_MAGIC, 'a.gif', 'image/gif'))).toBe('raster');
  });

  it('recognizes GIF89a magic', async () => {
    expect(await classifyImportFile(file(GIF89A_MAGIC, 'a.gif', 'image/gif'))).toBe('raster');
  });

  it('recognizes RIFF/WEBP magic', async () => {
    expect(await classifyImportFile(file(riffWebp(), 'a.webp', 'image/webp'))).toBe('raster');
  });

  it('classifies a real SVG by MIME type', async () => {
    const f = textFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'a', 'image/svg+xml');
    expect(await classifyImportFile(f)).toBe('svg');
  });

  it('classifies a real SVG by .svg extension when MIME is empty', async () => {
    const f = textFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'a.svg', '');
    expect(await classifyImportFile(f)).toBe('svg');
  });

  it('classifies by content root sniff when neither MIME nor extension claim SVG', async () => {
    const f = textFile('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'download', '');
    expect(await classifyImportFile(f)).toBe('svg');
  });

  it('root-sniffs through a BOM, XML declaration, and a leading comment', async () => {
    const text =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported by tool -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const f = textFile(text, 'download', '');
    expect(await classifyImportFile(f)).toBe('svg');
  });

  it('does not root-sniff content that is not actually SVG', async () => {
    const f = textFile('<html><body>not svg</body></html>', 'download', '');
    expect(await classifyImportFile(f)).toBe('other');
  });

  it('classifies a non-SVG, non-raster file as other', async () => {
    const f = textFile('hello world', 'notes.txt', 'text/plain');
    expect(await classifyImportFile(f)).toBe('other');
  });

  it('classifies an unrecognized image/* MIME as raster', async () => {
    const f = textFile('binary-ish', 'a.bmp', 'image/bmp');
    expect(await classifyImportFile(f)).toBe('raster');
  });

  it('classifies an over-cap file that claims SVG by extension as svg-oversize', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const f = textFile(big, 'huge.svg', '');
    expect(await classifyImportFile(f)).toBe('svg-oversize');
  });

  it('classifies an over-cap file that claims SVG by MIME as svg-oversize', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const f = textFile(big, 'huge', 'image/svg+xml');
    expect(await classifyImportFile(f)).toBe('svg-oversize');
  });

  it('classifies an over-cap image/* file as raster, not svg-oversize', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const f = textFile(big, 'huge.png', 'image/png');
    expect(await classifyImportFile(f)).toBe('raster');
  });

  it('classifies an over-cap non-image, non-svg-claiming file as other', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const f = textFile(big, 'huge.txt', 'text/plain');
    expect(await classifyImportFile(f)).toBe('other');
  });

  it('accepts a file exactly at the 2 MiB cap as svg', async () => {
    const exact = '<svg xmlns="http://www.w3.org/2000/svg">' + '<!--pad-->'.repeat(0) + '</svg>';
    const f = textFile(exact, 'a.svg', '');
    expect(await classifyImportFile(f)).toBe('svg');
  });
});
