/**
 * GENERATED — do not hand-edit. Regenerate, never hand-patch a name in or out.
 *
 * Source of truth: `measureUnionUnreliability()` in `pattern-parity.ts`, the
 * SAME end-to-end sweep `pattern-parity.test.ts`'s "end-to-end parity through
 * the kernel union" suite ratchets against — every registered pattern
 * generator, run through record → #206 kernel union → square clip, compared
 * against an independent software-canvas render (`raster-oracle.ts`).
 *
 * `path-bool` (the #206 kernel's current boolean backend) corrupts the union
 * for the ids below — see #218 for the root cause (a backend defect, not a
 * caller bug: two plain squares mis-union with no pattern generator involved)
 * and the measured failure modes, from "0.5% of the area survives" through
 * "100% wrong" to an outright throw.
 *
 * `build-ir.ts` refuses to export a pattern layer naming one of these ids
 * (`GerberRefusalCode: 'pattern-union-unreliable'`, #215) rather than ship
 * fabrication data already known to be geometrically wrong.
 *
 * Regenerate after any change to `path-bool`, the pattern recorder, or the
 * kernel union (e.g. #218's planned paper.js backend swap) with:
 *
 *   GENERATE_PATTERN_UNION_UNRELIABLE=1 pnpm --filter @zpd/app exec vitest run \
 *     src/editor/gerber/generate-pattern-union-unreliable.test.ts
 *
 * `pattern-parity.test.ts` fails loudly if this file drifts from a fresh
 * measurement — that is what keeps the refusal honest as the backend
 * improves. Once every generator passes, regenerating collapses this to an
 * empty array and the refusal above stops firing for every pattern, with no
 * hand-edit required to retire it.
 *
 * Measured 2026-07-25: 27/62 generators, default parameters, 24 mm square.
 */
export const UNION_UNRELIABLE_PATTERN_IDS: readonly string[] = [
  'ammann-bars',
  'asanoha',
  'astroid-grid',
  'aztec-step-fret',
  'cairo-pentagonal',
  'circuit-board-tiles',
  'diamond-lattice',
  'guilloche',
  'herringbone',
  'hex-circuit',
  'hex-lattice',
  'igeta',
  'kagome',
  'masu-tsunagi',
  'maurer-rose',
  'meander',
  'rings-interlock',
  'seigaiha',
  'shippo',
  'smith-truchet',
  'snowflakes-geometric',
  'steiner-chain',
  'valknut-grid',
  'vesica-lens-circle-mesh',
  'via-grid-array',
  'wachigai',
  'yoshiwara-tsunagi',
];
