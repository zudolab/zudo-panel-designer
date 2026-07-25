/**
 * Differential raster parity across EVERY registered pattern generator
 * (#211's acceptance criterion).
 *
 * A hand-picked handful is explicitly not enough here: this is fabrication
 * output, and a generator whose Canvas semantics the recorder mishandles
 * produces a wrong physical board with no warning anywhere. So the whole
 * registry is swept at default parameters and again at both parameter extremes.
 *
 * ── The "68 generators" figure in #211 ─────────────────────────────────────
 * 68 is the number of `.ts` FILES under `packages/patterns/src/patterns/`. Six
 * of those are not generators: the `index.ts` registry and the five
 * `group-*.ts` port shards. `PATTERN_GENERATORS` holds 62 entries — every
 * generator there is — and the count is pinned below so the sweep cannot
 * quietly shrink.
 *
 * ── Two sweeps, because there are two pieces of code under test ────────────
 * `runParity` renders the generator twice: once through the independent
 * software canvas in `raster-oracle.ts`, once through this module's pipeline.
 * The second render has two distinct halves, and conflating them makes every
 * failure unattributable:
 *
 *   1. **the recorder** — the proxy `ctx`, the fill-rule resolution, the #209
 *      stroker, and the square clip. This is what #211 owns, and it is swept
 *      strictly at all three parameter sets.
 *   2. **the union** — `engine.arrange(...).unite()` from #206's path-bool
 *      backend, which turns the recorder's operands into the disjoint region
 *      set the IR contract requires. It is measured separately and ratcheted,
 *      because it is measurably unreliable on this class of geometry: see
 *      `kernel-limits.test.ts` for two standalone reproductions that involve no
 *      pattern generator at all.
 *
 * ── What "agree" means ─────────────────────────────────────────────────────
 * Pixel equality is the wrong bar and Decision 6.1 says so: the arc→cubic
 * approximation is allowed 2.5 µm and the flattener another 2.5 µm, so the two
 * outlines are near each other, not identical. The assertion is a
 * Hausdorff-style bound — every disagreement must lie within one pixel of one
 * of the two shapes' own outlines — plus filled-area agreement, which is what
 * catches a whole motif being dropped, doubled, or filled under the wrong rule.
 */

import { PATTERN_GENERATORS } from '@zpd/patterns';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import {
  measureUnionUnreliability,
  runParity,
  UNION_SWEEP_SPECS,
  type ParityResult,
  type UnionReliabilityEntry,
} from './pattern-parity';
import { UNION_UNRELIABLE_PATTERN_IDS } from './pattern-union-unreliable.generated';

// The three (label, size/pixels, tolerance, params) sweeps are defined ONCE in
// pattern-parity.ts and shared with the end-to-end union measurement below —
// see UNION_SWEEP_SPECS's own doc comment for why a default-only sweep is not
// enough (a codex review of #215 caught grid-lines corrupting end-to-end only
// at its 'min' extreme). SETS below is that shared source, not a second
// definition — so this file's own ratchet and the union sweep can never
// silently measure two different things.
const SETS = UNION_SWEEP_SPECS;

/**
 * Generators whose RECORDED geometry still disagrees with the reference render.
 * Every entry is a real, unfixed gap — not a tolerance quibble — and is listed
 * rather than silently skipped so the count cannot drift upward unnoticed.
 *
 *  - `masu-tsunagi` — ATTRIBUTED, not mysterious: the innermost of its nested
 *    `strokeRect` squares loses its hole and fills solid. The cause is in
 *    #209's `validatedHoleContours`, is position-dependent, and reproduces in
 *    four lines with no pattern generator involved — see `kernel-limits.test.ts`.
 *  - `asanoha`, `kagome`, `rub-el-hizb` — dense stroked lattices whose stroke
 *    outlines coincide exactly along shared centreline edges. Not yet
 *    attributed to a specific stage.
 *
 * Each is a candidate for the `PATTERN_GEOMETRY_OVERRIDES` hatch once the
 * underlying stroker issue is resolved or ruled out.
 */
const RECORDER_KNOWN_GAPS: ReadonlySet<string> = new Set([
  'masu-tsunagi',
  'asanoha',
  'kagome',
  'rub-el-hizb',
]);

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
}, 60_000);

function describeFailure(
  name: string,
  deep: number,
  areaError: number,
  result: ParityResult,
): string {
  return (
    `${name}: ${deep} pixels differ away from either outline; ` +
    `reference filled ${result.filledA}, area error ${(areaError * 100).toFixed(2)}%`
  );
}

describe('pattern parity — the registry itself', () => {
  it('sweeps every registered generator, and the count is pinned', () => {
    expect(PATTERN_GENERATORS).toHaveLength(62);
    expect(new Set(PATTERN_GENERATORS.map((g) => g.name)).size).toBe(62);
  });

  it('names only real generators as known gaps', () => {
    const registered = new Set(PATTERN_GENERATORS.map((g) => g.name));
    for (const name of RECORDER_KNOWN_GAPS) expect(registered.has(name)).toBe(true);
  });

  /**
   * Keeps the exemption list from rotting. A name that no longer disagrees at
   * ANY parameter set has been fixed and must leave the list — otherwise the
   * list quietly grows into a place where real regressions hide.
   */
  it('every named gap still disagrees at at least one parameter set', () => {
    for (const name of RECORDER_KNOWN_GAPS) {
      const gen = PATTERN_GENERATORS.find((g) => g.name === name)!;
      const disagrees = SETS.some(({ set, tolerance, params }) => {
        const { recorder } = runParity(gen, engine, {
          ...set,
          params: params(gen),
          recorderOnly: true,
        });
        return recorder.deep > 0 || recorder.areaError > tolerance;
      });
      expect(disagrees, `${name} now matches everywhere — remove it from RECORDER_KNOWN_GAPS`).toBe(
        true,
      );
    }
  }, 300_000);
});

for (const { label, set, tolerance, params } of SETS) {
  describe(`recorder parity — ${label}`, () => {
    for (const gen of PATTERN_GENERATORS) {
      const known = RECORDER_KNOWN_GAPS.has(gen.name);
      it(`${gen.name} records the same artwork it paints${known ? ' (known gap)' : ''}`, () => {
        const result = runParity(gen, engine, { ...set, params: params(gen), recorderOnly: true });
        const { deep, areaError } = result.recorder;
        // A known gap is not asserted here — several of them disagree at one
        // parameter set and match at another, so a per-set expectation would be
        // noise. The list is kept honest by the test below instead.
        if (known) return;
        expect(deep, describeFailure(gen.name, deep, areaError, result)).toBe(0);
        expect(areaError, describeFailure(gen.name, deep, areaError, result)).toBeLessThanOrEqual(
          tolerance,
        );
      }, 120_000);
    }
  });
}

/**
 * End-to-end, through the kernel's union, across ALL of `UNION_SWEEP_SPECS`
 * (default parameters AND both parameter extremes) — not defaults alone. A
 * generator verified only at its defaults is NOT verified: `PatternLayer`'s
 * `size`/`params` are user-controlled, and a codex review of #215 caught
 * `grid-lines` corrupting end-to-end only when every parameter sits at its
 * minimum, a combination the app can produce and a default-only sweep cannot
 * see.
 *
 * A ratchet rather than a per-generator assertion, deliberately. The failures
 * are not this module's to fix — they are path-bool mis-resolving exact
 * coincidence — and a per-name known-failure list would be noise that flips
 * membership on any kernel change. A floor catches a regression in either
 * direction of blame while staying honest about where the pipeline currently
 * stands, and the failing names are printed so nobody has to guess.
 *
 * The sweep runs ONCE in `beforeAll` and both `it`s below read its result —
 * `measureUnionUnreliability` is the expensive half (three real kernel unions
 * per generator, one per spec), and running it twice would double this
 * suite's cost for no extra coverage.
 */
// Re-measured after widening the sweep past defaults-only (see the doc
// comment above) — printed by this same suite, not a number pulled out of the
// air. Lower than the old defaults-only floor (35) because "reliable" now
// means reliable across every spec, a strictly harder bar: 36/62 fail at
// least one spec, so 26 pass all three.
const MIN_PASSING = 26;

describe('end-to-end parity through the kernel union, across every parameter sweep', () => {
  let entries: UnionReliabilityEntry[] = [];

  beforeAll(async () => {
    entries = await measureUnionUnreliability(engine, PATTERN_GENERATORS);
    // Printed, not swallowed: the list is the deliverable of this test.
    console.log(
      `union-corrupted generators (${entries.length}/62): ` +
        entries.map((e) => `${e.name}(${e.detail})`).join(' '),
    );
  }, 900_000);

  it('at least MIN_PASSING of 62 generators survive the union intact across every parameter sweep', () => {
    const passing = PATTERN_GENERATORS.length - entries.length;
    const failing = entries.map((e) => e.name).join(' ');
    expect(passing, `union failures: ${failing}`).toBeGreaterThanOrEqual(MIN_PASSING);
  });

  /**
   * Drift guard for #215's export-time refusal (`GerberRefusalCode:
   * 'pattern-union-unreliable'`, `build-ir.ts`). `UNION_UNRELIABLE_PATTERN_IDS`
   * is a GENERATED constant, not hand-maintained — this test re-measures
   * reality on every run and fails loudly the moment the two disagree, in
   * either direction: a name this test newly measures as unreliable that the
   * generated file doesn't have yet (the backend regressed further) or a name
   * in the generated file this test no longer measures as unreliable (the
   * generated file is stale — regenerate it). That is what lets the refusal
   * disappear cleanly once #218 is fixed — regenerate, don't hand-edit.
   */
  it('matches the generated pattern-union-unreliable.generated.ts constant — regenerate (see that file\'s header) if this fails', () => {
    const measured = entries.map((e) => e.name).sort();
    expect(measured).toEqual([...UNION_UNRELIABLE_PATTERN_IDS].sort());
  });
});
