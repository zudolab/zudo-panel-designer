// Byte-exact assertions on the emitted RS-274X, in the spirit of
// download.test.ts: the emitter is pure, so the exact string a fab receives is
// the thing under test. Expected files are written out in full rather than
// re-derived, because a helper that builds the expectation the same way the
// writer does would agree with any bug the writer has.
import { describe, expect, it } from 'vitest';
import { gerberFileSet, gerberLayerText, type GerberEmitOptions } from './writer';
import type { IrLayer } from './ir';
import {
  COPPER_LAYER,
  FIXTURE_OPTIONS,
  FIXTURE_PANEL,
  MASK_LAYER_CONTAINER_HIDDEN,
  MASK_LAYER_EMPTY,
  MASK_LAYER_WITH_OPENINGS,
  OUTLINE_LAYER,
  fixtureIr,
} from './test-ir';

const OPTIONS: GerberEmitOptions = FIXTURE_OPTIONS;

const emit = (layer: IrLayer): string => gerberLayerText(layer, FIXTURE_PANEL, OPTIONS);

const GLOBAL_ATTRIBUTES = [
  '%TF.GenerationSoftware,zudolab,zudo-panel-designer,0.0.0*%',
  '%TF.CreationDate,2026-07-25T09:30:00+09:00*%',
  '%TF.Part,Other,Decorative front panel artwork - no drill data*%',
  '%TF.SameCoordinates*%',
];

const PREAMBLE = ['%ADD10C,0.010*%', 'D10*', 'G01*', '%LPD*%'];

const file = (lines: readonly string[]): string => `${[...lines, 'M02*'].join('\n')}\n`;

describe('gerberLayerText — copper (.GTL)', () => {
  it('emits the exact file for the asymmetric fixture, Y-flipped exactly once', () => {
    // Every doc-space Y below is mirrored through 128.5: 10→118.5, 20→108.5,
    // 50→78.5, 70→58.5, 80→48.5, 85→43.5, 95→33.5, 100→28.5, 110→18.5. Not one
    // of them survives a missing flip, and a doubled flip restores the doc value.
    expect(emit(COPPER_LAYER)).toBe(
      file([
        'G04 zudo-panel-designer 12HP panel - top copper*',
        '%FSLAX46Y46*%',
        '%MOMM*%',
        '%TF.FileFunction,Copper,L1,Top*%',
        '%TF.FilePolarity,Positive*%',
        ...GLOBAL_ATTRIBUTES,
        ...PREAMBLE,
        // L-shape
        'G36*',
        'X5000000Y118500000D02*',
        'X35000000Y118500000D01*',
        'X35000000Y108500000D01*',
        'X15000000Y108500000D01*',
        'X15000000Y78500000D01*',
        'X5000000Y78500000D01*',
        'X5000000Y118500000D01*',
        'G37*',
        // square with a hole: outer dark, hole cleared, dark restored after
        'G36*',
        'X5000000Y58500000D02*',
        'X45000000Y58500000D01*',
        'X45000000Y18500000D01*',
        'X5000000Y18500000D01*',
        'X5000000Y58500000D01*',
        'G37*',
        '%LPC*%',
        'G36*',
        'X15000000Y48500000D02*',
        'X15000000Y28500000D01*',
        'X35000000Y28500000D01*',
        'X35000000Y48500000D01*',
        'X15000000Y48500000D01*',
        'G37*',
        '%LPD*%',
        // island inside that hole — a later, separate region, painted after the
        // %LPC*% that cleared its surroundings
        'G36*',
        'X20000000Y43500000D02*',
        'X30000000Y43500000D01*',
        'X20000000Y33500000D01*',
        'X20000000Y43500000D01*',
        'G37*',
      ]),
    );
  });

  it('would produce different bytes if the flip were skipped', () => {
    // Guards the assertion above from a fixture that happens to be symmetric:
    // the un-flipped doc Y of the L-shape's first vertex is 10 mm.
    const text = emit(COPPER_LAYER);
    expect(text).toContain('X5000000Y118500000D02*');
    expect(text).not.toContain('X5000000Y10000000D02*');
  });
});

describe('gerberLayerText — outline (.GKO)', () => {
  it('emits a stroked profile contour with no TF.FilePolarity and no G36', () => {
    expect(emit(OUTLINE_LAYER)).toBe(
      file([
        'G04 zudo-panel-designer 12HP panel - board outline profile*',
        '%FSLAX46Y46*%',
        '%MOMM*%',
        '%TF.FileFunction,Profile,NP*%',
        ...GLOBAL_ATTRIBUTES,
        ...PREAMBLE,
        'X0Y128500000D02*',
        'X60600000Y128500000D01*',
        'X60600000Y0D01*',
        'X0Y0D01*',
        'X0Y128500000D01*',
      ]),
    );
  });

  it('never opens region mode on the profile — it is a cut path, not a fill', () => {
    expect(emit(OUTLINE_LAYER)).not.toContain('G36');
    expect(emit(OUTLINE_LAYER)).not.toContain('TF.FilePolarity');
  });
});

// DECISIONS.md Decision 4: two document states that look alike and mean
// opposite things on the board. All three rows are required.
describe('gerberLayerText — solder mask (.GTS) container matrix', () => {
  const maskHeader = [
    'G04 zudo-panel-designer 12HP panel - top solder mask*',
    '%FSLAX46Y46*%',
    '%MOMM*%',
    '%TF.FileFunction,Soldermask,Top*%',
    '%TF.FilePolarity,Negative*%',
    ...GLOBAL_ATTRIBUTES,
    ...PREAMBLE,
  ];

  it('hidden container → one full-panel opening region (NOT an empty file)', () => {
    expect(emit(MASK_LAYER_CONTAINER_HIDDEN)).toBe(
      file([
        ...maskHeader,
        'G36*',
        'X0Y128500000D02*',
        'X60600000Y128500000D01*',
        'X60600000Y0D01*',
        'X0Y0D01*',
        'X0Y128500000D01*',
        'G37*',
      ]),
    );
  });

  it('visible empty container → zero regions, which means full mask coverage', () => {
    expect(emit(MASK_LAYER_EMPTY)).toBe(file(maskHeader));
  });

  it('visible container with leaves → those openings, uncomplemented', () => {
    expect(emit(MASK_LAYER_WITH_OPENINGS)).toBe(
      file([
        ...maskHeader,
        'G36*',
        'X5000000Y58500000D02*',
        'X45000000Y58500000D01*',
        'X45000000Y18500000D01*',
        'X5000000Y18500000D01*',
        'X5000000Y58500000D01*',
        'G37*',
        '%LPC*%',
        'G36*',
        'X15000000Y48500000D02*',
        'X15000000Y28500000D01*',
        'X35000000Y28500000D01*',
        'X35000000Y48500000D01*',
        'X15000000Y48500000D01*',
        'G37*',
        '%LPD*%',
        'G36*',
        'X20000000Y43500000D02*',
        'X30000000Y43500000D01*',
        'X20000000Y33500000D01*',
        'X20000000Y43500000D01*',
        'G37*',
      ]),
    );
  });

  it('declares Negative on every row, including the one with no geometry', () => {
    for (const layer of [MASK_LAYER_CONTAINER_HIDDEN, MASK_LAYER_EMPTY, MASK_LAYER_WITH_OPENINGS]) {
      expect(emit(layer)).toContain('%TF.FilePolarity,Negative*%');
      expect(emit(layer)).not.toContain('%TF.FilePolarity,Positive*%');
    }
  });

  it('does not complement the geometry — the openings are emitted verbatim', () => {
    // A complemented mask would have to introduce a panel-sized outer rectangle
    // around the openings. The openings row has none.
    expect(emit(MASK_LAYER_WITH_OPENINGS)).not.toContain('X60600000');
  });
});

describe('coordinate formatting', () => {
  it('emits both X and Y on every operation — no modal omission', () => {
    const operations = emit(COPPER_LAYER)
      .split('\n')
      .filter((line) => /D0[12]\*$/.test(line));

    expect(operations.length).toBeGreaterThan(0);
    for (const line of operations) expect(line).toMatch(/^X-?\d+Y-?\d+D0[12]\*$/);
  });

  it('rounds to the 1 nm quantum rather than truncating, and omits leading zeros', () => {
    const layer: IrLayer = {
      role: 'silkscreen',
      filePolarity: 'positive',
      renderAs: 'filled-region',
      regions: [
        {
          outer: [
            { x: 0.1 + 0.2, y: 12.3 },
            { x: 1, y: 3.1415926535 },
            { x: 0.0000004, y: 0 },
          ],
          holes: [],
        },
      ],
    };

    const text = emit(layer);
    // 0.1+0.2 = 0.30000000000000004 mm → 300000 nm, unpadded.
    expect(text).toContain('X300000Y116200000D02*');
    // 128.5 − 3.1415926535 = 125.3584073465 mm → 125358407.3465 nm, rounded.
    expect(text).toContain('X1000000Y125358407D01*');
    // 0.4 nm rounds to 0 nm and prints as a bare "0", not "0000000000".
    expect(text).toContain('X0Y128500000D01*');
  });
});

describe('large but legal geometry', () => {
  // Decision 8 permits 2,000,000 flattened vertices across the IR, so a single
  // ring can run well past the ~125,000 arguments V8 accepts in one call. Any
  // `push(...lines)` in the emission path throws RangeError on input like this
  // and aborts a valid export.
  const denseRing = Array.from({ length: 200_000 }, (_, i) => ({
    x: (i % 1000) / 1000,
    y: 20 + i / 200_000,
  }));

  it('emits a 200,000-vertex ring without overflowing the call stack', () => {
    const layer: IrLayer = {
      role: 'copper',
      filePolarity: 'positive',
      renderAs: 'filled-region',
      regions: [{ outer: denseRing, holes: [denseRing] }],
    };

    const text = emit(layer);
    // outer + hole, each with a move, n-1 segments and the explicit close.
    expect(text.split('\n').filter((line) => /D0[12]\*$/.test(line))).toHaveLength(2 * 200_001);
  });

  it('emits a dense stroked profile without overflowing the call stack', () => {
    const layer: IrLayer = {
      role: 'outline',
      filePolarity: null,
      renderAs: 'stroked-contour',
      regions: [{ outer: denseRing, holes: [denseRing] }],
    };

    expect(() => emit(layer)).not.toThrow();
  });
});

describe('gerberFileSet', () => {
  it('always writes all four files with the download.ts filename convention', () => {
    expect(gerberFileSet(fixtureIr(MASK_LAYER_EMPTY), OPTIONS).map((f) => f.filename)).toEqual([
      'zpd-panel-12hp.GTL',
      'zpd-panel-12hp.GTS',
      'zpd-panel-12hp.GTO',
      'zpd-panel-12hp.GKO',
    ]);
  });

  it('terminates every file with M02* and nothing after it', () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), OPTIONS)) {
      expect(gerberFile.text.endsWith('M02*\n')).toBe(true);
      expect(gerberFile.text.split('\n').filter((line) => line === 'M02*')).toHaveLength(1);
    }
  });

  it('emits LF only and stays ASCII', () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), OPTIONS)) {
      expect(gerberFile.text).not.toContain('\r');
      // eslint-disable-next-line no-control-regex
      expect(gerberFile.text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    }
  });

  it('emits no Gerber-level transform — rotation is already baked into the IR', () => {
    for (const gerberFile of gerberFileSet(fixtureIr(), OPTIONS)) {
      for (const forbidden of [
        '%MI',
        '%SF',
        '%OF',
        '%AS',
        '%LM',
        '%LR',
        '%LS',
        'G02',
        'G03',
        'G75',
      ]) {
        expect(gerberFile.text).not.toContain(forbidden);
      }
    }
  });

  it('is pure — the same IR and options always produce the same bytes', () => {
    const first = gerberFileSet(fixtureIr(), OPTIONS).map((f) => f.text);
    const second = gerberFileSet(fixtureIr(), OPTIONS).map((f) => f.text);
    expect(second).toEqual(first);
  });

  it('takes the creation date from its caller, never from an ambient clock', () => {
    const [copper] = gerberFileSet(fixtureIr(), {
      creationDate: '2001-02-03T04:05:06-08:00',
      softwareVersion: '9.9.9',
    });
    expect(copper.text).toContain('%TF.CreationDate,2001-02-03T04:05:06-08:00*%');
    expect(copper.text).toContain('%TF.GenerationSoftware,zudolab,zudo-panel-designer,9.9.9*%');
  });
});
