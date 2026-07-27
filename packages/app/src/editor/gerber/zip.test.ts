// #215's zip assembly: gerberZipBytes/gerberReadmeText are pure (no DOM), so
// both the exact bytes and — via fflate's own unzipSync, a real independent
// parser — the archive's structural validity are directly assertable here,
// same spirit as writer.test.ts's byte-exact Gerber assertions.
import { loadTestFontFile } from './test-font-loader';
import {
  createDefaultDoc,
  createPcbLayerContainer,
  type DocState,
  type PathLayer,
  type PatternLayer,
  type PcbLayerStack,
  type ShapeLayer,
  type TextLayer,
} from '@zpd/core';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import { buildGerberIr } from './build-ir';
import { gerberFileSet, type GerberEmitOptions } from './writer';
import {
  gerberReadmeText,
  gerberZipBytes,
  gerberZipFilename,
  GERBER_ARTWORK_ONLY_STATEMENT,
} from './zip';
import { fixtureIr } from './test-ir';
import { setCuratedFontFileLoaderForTests } from './text-fonts';

const HP = 16;

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
  // Same seam build-ir.test.ts uses: the real outliner (#212) lazy-loads a
  // `?url` font asset that vitest resolves to `/@fs/<abs path>`, which `fetch`
  // cannot read in this environment but the filesystem can.
  setCuratedFontFileLoaderForTests(loadTestFontFile);
});

// A pattern id NOT in pattern-union-unreliable.generated.ts, so this fixture
// exercises the happy path rather than the #218 refusal covered separately in
// build-ir.test.ts.
const RELIABLE_PATTERN_ID = 'dot-grid';

function shapeSilkscreen(): ShapeLayer {
  return {
    id: 'silk-rect',
    name: 'Silkscreen rect',
    type: 'shape',
    shape: 'rect',
    x: 8,
    y: 14,
    width: 24,
    height: 16,
    color: 2,
  };
}

function pathCopper(): PathLayer {
  return {
    id: 'copper-path',
    name: 'Copper path',
    type: 'path',
    points: [
      { x: 10, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 50 },
      { x: 10, y: 50 },
    ],
    closed: true,
    fill: 1,
    stroke: null,
    strokeWidth: 0,
  };
}

function textSilkscreen(): TextLayer {
  return {
    id: 'silk-text',
    name: 'Legend',
    type: 'text',
    content: 'ZPD',
    fontFamily: 'Inter',
    sizeMm: 4,
    x: 8,
    y: 90,
    color: 2,
  };
}

function patternCopper(): PatternLayer {
  return {
    id: 'copper-pattern',
    name: 'Dot grid',
    type: 'pattern',
    patternType: RELIABLE_PATTERN_ID,
    params: {},
    color: 1,
    x: 40,
    y: 40,
    size: 20,
  };
}

function fixtureDoc(): DocState {
  const layers: PcbLayerStack = [
    createPcbLayerContainer('copper', [pathCopper(), patternCopper()]),
    createPcbLayerContainer('solder-mask', []),
    createPcbLayerContainer('silkscreen', [shapeSilkscreen(), textSilkscreen()]),
  ];
  return { ...createDefaultDoc(), panelHp: HP, layers, guides: [] };
}

const OPTIONS: GerberEmitOptions = {
  creationDate: '2026-07-25T09:30:00+09:00',
  softwareVersion: '0.0.0',
};

describe('gerberZipBytes — a document with shape + path + text + pattern layers', () => {
  it('produces a valid zip fflate itself can re-open, with all four Gerber files plus README.txt', async () => {
    const result = await buildGerberIr(fixtureDoc(), { engine });
    expect(result.ok, result.ok ? '' : result.refusals.map((r) => r.code).join(', ')).toBe(true);
    if (!result.ok) return;

    const bytes = gerberZipBytes(result.ir, OPTIONS);
    const unzipped = unzipSync(bytes);

    const expectedFiles = gerberFileSet(result.ir, OPTIONS);
    const expectedNames = [...expectedFiles.map((f) => f.filename), 'README.txt'].sort();
    expect(Object.keys(unzipped).sort()).toEqual(expectedNames);

    for (const file of expectedFiles) {
      expect(strFromU8(unzipped[file.filename])).toBe(file.text);
    }
    expect(strFromU8(unzipped['README.txt'])).toBe(gerberReadmeText(result.ir));
  });

  it('is deterministic — the same IR and options zip to the same bytes twice', async () => {
    const result = await buildGerberIr(fixtureDoc(), { engine });
    if (!result.ok) throw new Error('unexpected refusal');
    const first = gerberZipBytes(result.ir, OPTIONS);
    const second = gerberZipBytes(result.ir, OPTIONS);
    expect(Buffer.from(second)).toEqual(Buffer.from(first));
  });
});

describe('gerberZipFilename', () => {
  it('encodes format, hp, and material via the shared filename helper (#229)', () => {
    expect(gerberZipFilename({ format: '3U', panelHp: 12, material: 'fr4' })).toBe(
      'zpd-panel-3U-12hp-fr4-gerber.zip',
    );
  });
});

describe('gerberReadmeText (Decision 2.2 / 2.4)', () => {
  const ir = fixtureIr();

  it('carries the artwork-only statement word-for-word', () => {
    expect(gerberReadmeText(ir)).toContain(GERBER_ARTWORK_ONLY_STATEMENT);
  });

  it('names the panel dimensions and every file with its function', () => {
    const text = gerberReadmeText(ir);
    expect(text).toContain(`${ir.panel.hp}HP`);
    expect(text).toContain(`${ir.panel.widthMm}`);
    expect(text).toContain(`${ir.panel.heightMm}`);
    expect(text).toContain('zpd-panel-12hp.GTL');
    expect(text).toContain('zpd-panel-12hp.GTS');
    expect(text).toContain('zpd-panel-12hp.GTO');
    expect(text).toContain('zpd-panel-12hp.GKO');
    expect(text).toContain('No Excellon drill file');
  });

  it("is LF-terminated, no CRLF (Decision 3.4's line-ending discipline; README.txt is free text, not a Gerber body, so Unicode punctuation like the statement's em dash is fine)", () => {
    const text = gerberReadmeText(ir);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
  });
});
