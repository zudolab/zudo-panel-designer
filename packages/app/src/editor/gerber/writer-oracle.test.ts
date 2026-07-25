// DECISIONS.md Decision 10.1: a self-written parser is not an acceptable
// oracle — it inherits the writer's own misconceptions, so a consistent
// misunderstanding of region polarity would pass in both directions. These
// tests re-read the emitted bytes with two third-party parsers we did not
// write:
//
//   - `gerber-parser` decodes coordinates all the way to MILLIMETRES by
//     independently applying the `%FSLAX46Y46*%` format spec. That makes it the
//     real Y-flip oracle: it re-derives 118.5 mm from `Y118500000` without any
//     help from us, so a wrong digit count or a missing flip cannot hide.
//   - `@tracespace/parser` yields a typed AST, which is the cleaner way to
//     assert region mode, load polarity and aperture structure.
//
// Both are used because they cover different halves of Decision 10.1's
// requirement (coordinate stream vs. region/polarity structure), and two
// independent implementations disagreeing with us is a stronger signal than one.
//
// NOT covered here: Decision 10.2b, the plotted-Gerber-vs-editor raster diff.
// It needs an editor raster of the same document, which requires the extractor
// (#209) and a canvas — neither is available to this fixture-only writer. It
// stays assigned, per Decision 10, to #216 as a scripted `gerbv --export=png`
// step. Decision 10.2a (IR vs editor) validates the extractor, not the writer,
// and is not a substitute for it.
import { describe, expect, it } from 'vitest';
import { createParser } from '@tracespace/parser';
import gerberParser from 'gerber-parser';
import { gerberFileSet, gerberLayerText } from './writer';
import {
  COPPER_LAYER,
  FIXTURE_OPTIONS,
  FIXTURE_PANEL,
  MASK_LAYER_CONTAINER_HIDDEN,
  MASK_LAYER_EMPTY,
  OUTLINE_LAYER,
  fixtureIr,
} from './test-ir';

// --- gerber-parser (streaming, decodes to millimetres) --------------------

interface DecodedOperation {
  readonly type: 'op';
  readonly op: 'move' | 'int' | 'flash';
  readonly coord: { readonly x?: number; readonly y?: number };
}
interface DecodedSet {
  readonly type: 'set';
  readonly prop: string;
  readonly value: unknown;
}
interface DecodedLevel {
  readonly type: 'level';
  readonly level: string;
  readonly value: string;
}
interface DecodedTool {
  readonly type: 'tool';
  readonly code: string;
  readonly tool: { readonly shape: string; readonly params: readonly number[] };
}
type DecodedCommand = DecodedOperation | DecodedSet | DecodedLevel | DecodedTool;

interface DecodedFile {
  readonly commands: readonly DecodedCommand[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

function decode(text: string): Promise<DecodedFile> {
  return new Promise((resolve, reject) => {
    const commands: DecodedCommand[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const parser = gerberParser({});

    parser.on('data', (command: DecodedCommand) => commands.push(command));
    parser.on('warning', (warning: { message: string }) => warnings.push(warning.message));
    parser.on('error', (error: { message: string }) => errors.push(error.message));
    parser.on('end', () => resolve({ commands, warnings, errors }));
    parser.on('close', reject);

    parser.write(text);
    parser.end();
  });
}

const operations = (file: DecodedFile): DecodedOperation[] =>
  file.commands.filter((c): c is DecodedOperation => c.type === 'op');

describe('third-party gerber-parser re-reads the emitted bytes', () => {
  it('decodes the format spec and units without being told either', async () => {
    const file = await decode(gerberLayerText(COPPER_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS));
    const settings = file.commands.filter((c): c is DecodedSet => c.type === 'set');

    expect(settings).toContainEqual(expect.objectContaining({ prop: 'units', value: 'mm' }));
    expect(settings).toContainEqual(expect.objectContaining({ prop: 'nota', value: 'A' }));
    // epsilon = 1.5 * 10^-6: the parser derived the 6-decimal-digit quantum
    // from %FSLAX46Y46*% on its own.
    expect(settings).toContainEqual(expect.objectContaining({ prop: 'epsilon', value: 0.0000015 }));
  });

  it('recovers the exact millimetre coordinates of the asymmetric copper fixture', async () => {
    const file = await decode(gerberLayerText(COPPER_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS));

    // Written out literally, mirrored through 128.5 by hand. An independent
    // decoder agreeing with these numbers is what proves the flip happened, and
    // happened once: a doubled flip would return the doc-space values (10, 20,
    // 50, 70, 80, 85, 95, 100, 110) instead.
    expect(operations(file).map((o) => [o.op, o.coord.x, o.coord.y])).toEqual([
      ['move', 5, 118.5],
      ['int', 35, 118.5],
      ['int', 35, 108.5],
      ['int', 15, 108.5],
      ['int', 15, 78.5],
      ['int', 5, 78.5],
      ['int', 5, 118.5],
      ['move', 5, 58.5],
      ['int', 45, 58.5],
      ['int', 45, 18.5],
      ['int', 5, 18.5],
      ['int', 5, 58.5],
      ['move', 15, 48.5],
      ['int', 15, 28.5],
      ['int', 35, 28.5],
      ['int', 35, 48.5],
      ['int', 15, 48.5],
      ['move', 20, 43.5],
      ['int', 30, 43.5],
      ['int', 20, 33.5],
      ['int', 20, 43.5],
    ]);
  });

  it('places every decoded coordinate inside the panel envelope', async () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), FIXTURE_OPTIONS)) {
      for (const { coord } of operations(await decode(gerberFile.text))) {
        expect(coord.x).toBeGreaterThanOrEqual(0);
        expect(coord.x).toBeLessThanOrEqual(FIXTURE_PANEL.widthMm);
        expect(coord.y).toBeGreaterThanOrEqual(0);
        expect(coord.y).toBeLessThanOrEqual(FIXTURE_PANEL.heightMm);
      }
    }
  });

  it('reports no errors, and warns only about the X2 attributes it does not model', async () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), FIXTURE_OPTIONS)) {
      const file = await decode(gerberFile.text);
      expect(file.errors).toEqual([]);
      // This is Decision 3.3's arbitration of %TF.SameCoordinates*%: the
      // identifier-less form is not rejected, only left uninterpreted like
      // every other TF attribute, so the attribute stays.
      for (const warning of file.warnings) expect(warning).toMatch(/^block "%TF\./);
    }
  });

  it('sees the dummy aperture some parsers require a file to define', async () => {
    const file = await decode(gerberLayerText(OUTLINE_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS));
    const tools = file.commands.filter((c): c is DecodedTool => c.type === 'tool');

    expect(tools).toHaveLength(1);
    expect(tools[0].code).toBe('10');
    expect(tools[0].tool.shape).toBe('circle');
    expect(tools[0].tool.params).toEqual([0.01]);
  });
});

// --- @tracespace/parser (typed AST, region and polarity structure) --------

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function ast(text: string): readonly AstNode[] {
  const parser = createParser();
  parser.feed(text);
  return parser.results().children as unknown as readonly AstNode[];
}

describe('third-party @tracespace/parser re-reads the emitted bytes', () => {
  it('reads back the pinned coordinate format', () => {
    const format = ast(gerberLayerText(COPPER_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS)).find(
      (node) => node.type === 'coordinateFormat',
    );

    expect(format).toMatchObject({ zeroSuppression: 'leading', format: [4, 6], mode: 'absolute' });
  });

  it('recognises every command except the X2 attributes, which it keeps verbatim', () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), FIXTURE_OPTIONS)) {
      for (const node of ast(gerberFile.text)) {
        if (node.type !== 'unimplemented') continue;
        expect(node.value).toMatch(/^%TF\./);
      }
    }
  });

  it('sees balanced G36/G37 region blocks with dark-clear-dark polarity per hole', () => {
    const nodes = ast(gerberLayerText(COPPER_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS));
    const structure = nodes
      .filter((node) => node.type === 'regionMode' || node.type === 'loadPolarity')
      .map((node) =>
        node.type === 'regionMode'
          ? `region:${String(node.region)}`
          : `polarity:${String(node.polarity)}`,
      );

    expect(structure).toEqual([
      'polarity:dark', // header
      'region:true', // L-shape
      'region:false',
      'region:true', // square outer
      'region:false',
      'polarity:clear', // its hole
      'region:true',
      'region:false',
      'polarity:dark', // restored before the island
      'region:true', // island
      'region:false',
    ]);
  });

  it('leaves the profile out of region mode entirely', () => {
    const nodes = ast(gerberLayerText(OUTLINE_LAYER, FIXTURE_PANEL, FIXTURE_OPTIONS));
    expect(nodes.filter((node) => node.type === 'regionMode')).toEqual([]);
    expect(nodes.filter((node) => node.type === 'graphic')).toHaveLength(5);
  });

  it('reads an empty solder-mask file as a complete file with no image at all', () => {
    const nodes = ast(gerberLayerText(MASK_LAYER_EMPTY, FIXTURE_PANEL, FIXTURE_OPTIONS));
    expect(nodes.filter((node) => node.type === 'graphic')).toEqual([]);
    expect(nodes.at(-1)).toMatchObject({ type: 'done' });
  });

  it('reads the hidden-container solder mask as one full-panel dark region', () => {
    const nodes = ast(gerberLayerText(MASK_LAYER_CONTAINER_HIDDEN, FIXTURE_PANEL, FIXTURE_OPTIONS));

    expect(nodes.filter((node) => node.type === 'loadPolarity')).toHaveLength(1);
    expect(nodes.filter((node) => node.type === 'regionMode')).toHaveLength(2);
    expect(nodes.filter((node) => node.type === 'graphic')).toHaveLength(5);
  });

  it('marks every emitted file complete — M02* reached, nothing dangling', () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), FIXTURE_OPTIONS)) {
      const parser = createParser();
      parser.feed(gerberFile.text);
      const root = parser.results();

      expect(root.done).toBe(true);
      expect(root.filetype).toBe('gerber');
    }
  });
});
