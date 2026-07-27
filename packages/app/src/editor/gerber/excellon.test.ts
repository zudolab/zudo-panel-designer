// Byte-exact Excellon fixtures from the catalog numbers (#227), plus two
// third-party parsers as independent oracles — Decision 10.1's "we did not
// write the oracle" rule applied to the drill side (#235, Decision 11).
//
// The fixtures are asymmetric top-vs-bottom (different cx per row), so a
// missing Y flip — or a doubled one — swaps which slot lands at Y3 vs Y125.5
// and fails the byte comparison. The flip goes through coordinate-frame.ts
// inside the emitter; the DrillIr itself stays in doc space.
import { createParser } from '@tracespace/parser';
import { panelHeightMm, panelWidthMm, type PanelFormat } from '@zpd/core';
import gerberParser from 'gerber-parser';
import { describe, expect, it } from 'vitest';
import { excellonFileText } from './excellon';
import { drillFileSet, injectHoleFabrication } from './holes';
import type { DrillIr, IrPanel } from './ir';
import { FIXTURE_OPTIONS } from './test-ir';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

function panel(format: PanelFormat, hp: number): IrPanel {
  return { format, hp, widthMm: panelWidthMm(hp), heightMm: panelHeightMm(format) };
}

function fabricate(material: 'fr4' | 'alumi', p: IrPanel): DrillIr {
  return injectHoleFabrication({ material, panel: p, tolerance: DEFAULT_IR_TOLERANCE }).drill;
}

const header = (fileFunction: string) => [
  'M48',
  '; #@! TF.CreationDate,2026-07-25T09:30:00+09:00',
  '; #@! TF.GenerationSoftware,zudolab,zudo-panel-designer,0.0.0',
  `; #@! TF.FileFunction,${fileFunction}`,
  'FMAT,2',
  'METRIC',
];

describe('excellonFileText — byte-exact catalog fixtures', () => {
  it('3U-4hp alumi: NPTH carries the routed slots, PTH ships header-only (the #227 acceptance numbers)', () => {
    const p = panel('3U', 4);
    const [pth, npth] = drillFileSet(fabricate('alumi', p), p, FIXTURE_OPTIONS);

    // Slots centred (6.045, 3.0) and (13.955, 125.5), tool T1C3.2, route span
    // 10.28 − 3.2 = 7.08 → endpoints cx ± 3.54, Y flipped through 128.5.
    expect(npth.filename).toBe('zpd-panel-4hp-NPTH.drl');
    expect(npth.text).toBe(
      [
        ...header('NonPlated,1,2,NPTH'),
        'T1C3.2',
        '%',
        'G90',
        'G05',
        'T1',
        'G00X2.505Y125.5',
        'M15',
        'G01X9.585Y125.5',
        'M16',
        'G00X10.415Y3.0',
        'M15',
        'G01X17.495Y3.0',
        'M16',
        'T0',
        'M30',
        '',
      ].join('\n'),
    );

    expect(pth.filename).toBe('zpd-panel-4hp-PTH.drl');
    expect(pth.text).toBe([...header('Plated,1,2,PTH'), '%', 'G90', 'G05', 'M30', ''].join('\n'));
  });

  it('1U-2hp FR-4: the one-off 8.0 slot routes a 4.8 span on the PTH side', () => {
    const p = panel('1U', 2);
    expect(excellonFileText(fabricate('fr4', p).pth, p, FIXTURE_OPTIONS)).toBe(
      [
        ...header('Plated,1,2,PTH'),
        'T1C3.2',
        '%',
        'G90',
        'G05',
        'T1',
        'G00X2.5Y36.65',
        'M15',
        'G01X7.3Y36.65',
        'M16',
        'G00X2.5Y3.0',
        'M15',
        'G01X7.3Y3.0',
        'M16',
        'T0',
        'M30',
        '',
      ].join('\n'),
    );
  });

  it('3U-1hp: round holes emit plain X…Y… hits, no routing', () => {
    const p = panel('3U', 1);
    expect(excellonFileText(fabricate('fr4', p).pth, p, FIXTURE_OPTIONS)).toBe(
      [
        ...header('Plated,1,2,PTH'),
        'T1C3.2',
        '%',
        'G90',
        'G05',
        'T1',
        'X2.5Y125.5',
        'X2.5Y3.0',
        'T0',
        'M30',
        '',
      ].join('\n'),
    );
  });

  it('is LF-terminated ASCII on filled and empty sides alike', () => {
    const p = panel('3U', 12);
    for (const material of ['fr4', 'alumi'] as const) {
      for (const file of drillFileSet(fabricate(material, p), p, FIXTURE_OPTIONS)) {
        expect(file.text).not.toContain('\r');
        expect(file.text.endsWith('M30\n')).toBe(true);
        // eslint-disable-next-line no-control-regex
        expect(file.text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
      }
    }
  });

  it('re-arms drill mode with G05 when hits follow a routed slot — route mode is modal', () => {
    // Not reachable from today's single-tool catalog, but the emitter accepts
    // any DrillFileIr: without the G05, the T2 hit below would be interpreted
    // as another routed move under the still-modal G01.
    const p = panel('3U', 12);
    const text = excellonFileText(
      {
        plating: 'pth',
        tools: [
          { code: 1, diameterMm: 3.2 },
          { code: 2, diameterMm: 5 },
        ],
        hits: [{ tool: 2, x: 10, y: 3 }],
        slots: [{ tool: 1, start: { x: 6.62, y: 3 }, end: { x: 13.7, y: 3 } }],
      },
      p,
      FIXTURE_OPTIONS,
    );
    expect(text).toContain('M16\nT2\nG05\nX10.0Y125.5');
  });

  it('refuses drill content that references a tool absent from the table', () => {
    const p = panel('3U', 12);
    const file = {
      plating: 'npth' as const,
      tools: [],
      hits: [{ tool: 1, x: 5, y: 3 }],
      slots: [],
    };
    expect(() => excellonFileText(file, p, FIXTURE_OPTIONS)).toThrow(/tool table/);
  });
});

// --- gerber-parser (streaming, decodes to millimetres) ---------------------
//
// Same oracle as writer-oracle.test.ts's Gerber side: it independently
// re-derives millimetre coordinates and tool diameters from the bytes, so a
// wrong decimal, a missing flip, or a dropped hit cannot hide.

interface DecodedOperation {
  readonly type: 'op';
  readonly op: 'move' | 'int' | 'flash';
  readonly coord: { readonly x?: number; readonly y?: number };
}
interface DecodedTool {
  readonly type: 'tool';
  readonly code: string;
  readonly tool: { readonly shape: string; readonly params: readonly number[] };
}
type DecodedCommand = DecodedOperation | DecodedTool | { readonly type: string };

interface DecodedFile {
  readonly filetype: string;
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
    parser.on('end', () =>
      resolve({ filetype: parser.format.filetype, commands, warnings, errors }),
    );
    parser.on('close', reject);

    parser.write(text);
    parser.end();
  });
}

const operations = (file: DecodedFile): DecodedOperation[] =>
  file.commands.filter((c): c is DecodedOperation => c.type === 'op');

describe('third-party gerber-parser re-reads the emitted drill bytes', () => {
  it('recovers the tool diameter and the exact millimetre route of the 3U-4hp slots', async () => {
    const p = panel('3U', 4);
    const file = await decode(excellonFileText(fabricate('alumi', p).npth, p, FIXTURE_OPTIONS));

    expect(file.filetype).toBe('drill');
    expect(file.errors).toEqual([]);

    const tools = file.commands.filter((c): c is DecodedTool => c.type === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].code).toBe('1');
    expect(tools[0].tool).toMatchObject({ shape: 'circle', params: [3.2] });

    expect(operations(file).map((o) => [o.op, o.coord.x, o.coord.y])).toEqual([
      ['move', 2.505, 125.5],
      ['int', 9.585, 125.5],
      ['move', 10.415, 3],
      ['int', 17.495, 3],
    ]);
  });

  it('reads round hits back as flashes at the flipped catalog centres', async () => {
    const p = panel('3U', 1);
    const file = await decode(excellonFileText(fabricate('fr4', p).pth, p, FIXTURE_OPTIONS));
    expect(operations(file).map((o) => [o.op, o.coord.x, o.coord.y])).toEqual([
      ['flash', 2.5, 125.5],
      ['flash', 2.5, 3],
    ]);
  });

  it('parses filled and empty sides without errors, warning only about zero suppression it cannot see', async () => {
    const p = panel('3U', 12);
    for (const material of ['fr4', 'alumi'] as const) {
      for (const drillFile of drillFileSet(fabricate(material, p), p, FIXTURE_OPTIONS)) {
        const file = await decode(drillFile.text);
        expect(file.filetype).toBe('drill');
        expect(file.errors).toEqual([]);
        // Decimal coordinates carry an explicit point, so the parser's
        // "zero suppression missing" assumption is inert — allow only that.
        for (const warning of file.warnings) expect(warning).toMatch(/zero suppression/);
      }
    }
  });
});

// --- @tracespace/parser (typed AST) ----------------------------------------

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function ast(text: string): { readonly done: boolean; readonly filetype: string | null; readonly children: readonly AstNode[] } {
  const parser = createParser();
  parser.feed(text);
  const root = parser.results();
  return {
    done: root.done,
    filetype: root.filetype,
    children: root.children as unknown as readonly AstNode[],
  };
}

describe('third-party @tracespace/parser re-reads the emitted drill bytes', () => {
  it('identifies the file as a drill file and decodes the tool table', () => {
    const p = panel('3U', 4);
    const tree = ast(excellonFileText(fabricate('alumi', p).npth, p, FIXTURE_OPTIONS));

    expect(tree.filetype).toBe('drill');
    const tool = tree.children.find((node) => node.type === 'toolDefinition');
    expect(tool).toMatchObject({ code: '1', shape: { type: 'circle', diameter: 3.2 } });
  });

  // @tracespace/parser 5.0.0-next.0's drill grammar stalls at the mandatory
  // `%` end-of-header line: everything after it goes unparsed and `done`
  // stays false. The `%` is required by the reference sets (and gerber-parser
  // above handles the untouched bytes fine), so the byte stream keeps it; to
  // still get tracespace's typed AST over the BODY, re-feed the same text
  // with the single `%` line dropped — the coordinate stream is untouched.
  it('sees the routed-slot structure (G00/M15/G01/M16 → move/line) behind the % limitation', () => {
    const p = panel('3U', 4);
    const text = excellonFileText(fabricate('alumi', p).npth, p, FIXTURE_OPTIONS)
      .split('\n')
      .filter((line) => line !== '%')
      .join('\n');
    const tree = ast(text);

    expect(tree.done).toBe(true);
    const body = tree.children
      .filter((n) => n.type === 'toolChange' || n.type === 'interpolateMode' || n.type === 'graphic')
      .map((n) =>
        n.type === 'toolChange'
          ? `tool:${String(n.code)}`
          : n.type === 'interpolateMode'
            ? `mode:${String(n.mode)}`
            : `at:${String((n.coordinates as { x: string; y: string }).x)},${String(
                (n.coordinates as { x: string; y: string }).y,
              )}`,
      );
    expect(body).toEqual([
      'mode:drill', // G05
      'tool:1',
      'mode:move',
      'at:2.505,125.5',
      'mode:line',
      'at:9.585,125.5',
      'mode:move',
      'at:10.415,3.0',
      'mode:line',
      'at:17.495,3.0',
      'tool:0',
    ]);
  });
});
