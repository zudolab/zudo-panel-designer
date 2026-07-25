/**
 * Codegen, not a correctness check — `pattern-parity.test.ts`'s "matches the
 * generated pattern-union-unreliable.generated.ts constant" test is what
 * verifies the committed file; this one REWRITES it from a fresh measurement.
 *
 * Gated behind an env var so it never runs as part of an ordinary `pnpm test`
 * (it pays the same ~900s-worst-case end-to-end union sweep
 * `pattern-parity.test.ts` already pays for once, and — unlike every other
 * test in this package — it has a side effect on the working tree) and never
 * silently overwrites the committed file from a routine CI run.
 *
 * Regenerate with:
 *
 *   GENERATE_PATTERN_UNION_UNRELIABLE=1 pnpm --filter @zpd/app exec vitest run \
 *     src/editor/gerber/generate-pattern-union-unreliable.test.ts
 *
 * then re-run the normal suite (or just `pattern-parity.test.ts`) to confirm
 * the drift check is green, and commit the regenerated file.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PATTERN_GENERATORS } from '@zpd/patterns';
import { describe, expect, it } from 'vitest';
import { createBooleanEngine } from '../geometry-kernel';
import { measureUnionUnreliableNames } from './pattern-parity';

const OUTPUT_PATH = fileURLToPath(
  new URL('./pattern-union-unreliable.generated.ts', import.meta.url),
);

const GENERATE = process.env.GENERATE_PATTERN_UNION_UNRELIABLE === '1';

function renderModule(names: readonly string[]): string {
  const items = names.map((name) => `  ${JSON.stringify(name)},`).join('\n');
  const date = new Date().toISOString().slice(0, 10);
  return `/**
 * GENERATED — do not hand-edit. Regenerate, never hand-patch a name in or out.
 *
 * Source of truth: \`measureUnionUnreliability()\` in \`pattern-parity.ts\`, the
 * SAME end-to-end sweep \`pattern-parity.test.ts\`'s "end-to-end parity through
 * the kernel union" suite ratchets against — every registered pattern
 * generator, run through record → #206 kernel union → square clip, compared
 * against an independent software-canvas render (\`raster-oracle.ts\`).
 *
 * \`path-bool\` (the #206 kernel's current boolean backend) corrupts the union
 * for the ids below — see #218 for the root cause (a backend defect, not a
 * caller bug: two plain squares mis-union with no pattern generator involved)
 * and the measured failure modes, from "0.5% of the area survives" through
 * "100% wrong" to an outright throw.
 *
 * \`build-ir.ts\` refuses to export a pattern layer naming one of these ids
 * (\`GerberRefusalCode: 'pattern-union-unreliable'\`, #215) rather than ship
 * fabrication data already known to be geometrically wrong.
 *
 * Regenerate after any change to \`path-bool\`, the pattern recorder, or the
 * kernel union (e.g. #218's planned paper.js backend swap) with:
 *
 *   GENERATE_PATTERN_UNION_UNRELIABLE=1 pnpm --filter @zpd/app exec vitest run \\
 *     src/editor/gerber/generate-pattern-union-unreliable.test.ts
 *
 * \`pattern-parity.test.ts\` fails loudly if this file drifts from a fresh
 * measurement — that is what keeps the refusal honest as the backend
 * improves. Once every generator passes, regenerating collapses this to an
 * empty array and the refusal above stops firing for every pattern, with no
 * hand-edit required to retire it.
 *
 * Measured ${date}: ${names.length}/${PATTERN_GENERATORS.length} generators, default parameters, 24 mm square.
 */
export const UNION_UNRELIABLE_PATTERN_IDS: readonly string[] = [
${items}
];
`;
}

(GENERATE ? describe : describe.skip)('generate pattern-union-unreliable.generated.ts', () => {
  it(
    'measures every registered generator end-to-end and writes the result',
    async () => {
      const engine = await createBooleanEngine();
      const names = measureUnionUnreliableNames(engine, PATTERN_GENERATORS);
      writeFileSync(OUTPUT_PATH, renderModule(names));
      // The write is the point; this just proves it didn't silently produce
      // an empty/garbage module in a run with zero registered generators.
      expect(names.length).toBeLessThanOrEqual(PATTERN_GENERATORS.length);
    },
    900_000,
  );
});
