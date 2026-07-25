/**
 * Standalone reproductions of two defects in the merged geometry stack that the
 * pattern work runs into constantly, pinned here so they are a known quantity
 * rather than folklore.
 *
 * Neither involves a pattern generator, a recorder or a canvas. Both are four
 * to ten lines of hand-written geometry, and both assert the WRONG answer that
 * is currently produced, with the right answer written next to it. When either
 * is fixed these tests fail loudly, which is exactly what should happen: the
 * `RECORDER_KNOWN_GAPS` list in `pattern-parity.test.ts` and the union ratchet
 * next to it both become stale at the same moment.
 *
 * `geometry-kernel/engine.ts` names the criteria for replacing path-bool with
 * paper.js. What is recorded here meets two of them:
 *
 *   T2 — "a boolean throws / hangs / returns empty for a NON-empty true result
 *         on realistic inputs". Both cases below qualify.
 *   T3 — holes coming back such that the result is not recoverable by
 *         area-sign normalisation.
 *
 * Acting on that is #206's call and a much larger change than #211; recording
 * the evidence is what this file is for.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBooleanEngine,
  ringSignedArea,
  type BooleanEngine,
  type KernelInput,
  type KernelRing,
} from '../geometry-kernel';
import { degenerateCubic, polygonToRing, rectToRing } from './primitives';
import { strokeSubpathsToInputs } from './stroker';
import { DEFAULT_IR_TOLERANCE } from './tolerance';

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
}, 30_000);

const netArea = (rings: readonly KernelRing[]): number =>
  Math.abs(rings.reduce((a, r) => a + ringSignedArea(r), 0));

const single = (ring: KernelRing): KernelInput => ({ contours: [ring], fillRule: 'nonzero' });

describe('kernel limit 1 — a compound input with collinear contour overlap', () => {
  it('resolves two overlapping rectangles correctly when they are separate operands', () => {
    const a = rectToRing(0, 0, 10, 10);
    const b = rectToRing(5, 0, 10, 10);
    expect(netArea(engine.arrange([single(a), single(b)]).unite())).toBeCloseTo(150, 6);
  });

  it('returns their INTERSECTION when they share one compound input', () => {
    const a = rectToRing(0, 0, 10, 10);
    const b = rectToRing(5, 0, 10, 10);
    const wrong = netArea(engine.arrange([{ contours: [a, b], fillRule: 'nonzero' }]).unite());
    // The true nonzero area of that compound path is 150 mm². This is why
    // `fillOperands` splits a same-wound `nonzero` fill into one operand per
    // contour instead of handing the path over whole.
    expect(wrong).toBeCloseTo(50, 6);
    expect(wrong).not.toBeCloseTo(150, 0);
  });

  it('gets the even-odd case wrong the same way, which is why parity is used instead', () => {
    const a = rectToRing(0, 0, 10, 10);
    const b = rectToRing(5, 0, 10, 10);
    const inner = rectToRing(2, 2, 3, 3);
    const compound = netArea(
      engine.arrange([{ contours: [a, b, inner], fillRule: 'evenodd' }]).unite(),
    );
    const byParity = netArea(
      engine
        .arrange([a, b, inner].map((r) => ({ contours: [r], fillRule: 'evenodd' as const })))
        .exclude(),
    );
    expect(byParity).toBeCloseTo(91, 6); // (A xor B) minus the square inside A
    expect(compound).toBeCloseTo(59, 6); // wrong
  });
});

describe('kernel limit 2 — a closed stroke loses its hole at some coordinates', () => {
  const SIDE = 2.533333333333333;
  const WIDTH = 0.5;

  function closedSquare(origin: number): {
    contour: ReturnType<typeof degenerateCubic>[];
    closed: true;
  } {
    const pts = [
      { x: origin, y: origin },
      { x: origin + SIDE, y: origin },
      { x: origin + SIDE, y: origin + SIDE },
      { x: origin, y: origin + SIDE },
    ];
    return { contour: pts.map((p, i) => degenerateCubic(p, pts[(i + 1) % 4])), closed: true };
  }

  const stroke = (origin: number): KernelInput[] =>
    strokeSubpathsToInputs(
      [closedSquare(origin)],
      { width: WIDTH, cap: 'butt', join: 'miter', miterLimit: 10 },
      DEFAULT_IR_TOLERANCE,
      engine,
    );

  // A stroked square band: (side + width)² − (side − width)², i.e. 4·side·width.
  const EXPECTED = 4 * SIDE * WIDTH;

  it('is correct at the origin — outer ring plus its hole', () => {
    const rings = stroke(0).flatMap((i) => i.contours);
    expect(rings).toHaveLength(2);
    // 3 decimals, not 6: the kernel snaps its inputs to a 0.1 µm grid, so an
    // area this size carries ~1e-4 mm² of quantisation.
    expect(netArea(rings)).toBeCloseTo(EXPECTED, 3);
  });

  it('drops the hole at x = y = −5.2666…, filling the square solid', () => {
    // The identical square, translated. `masu-tsunagi` places its innermost
    // nested square almost exactly here, which is why that generator's centres
    // come out solid instead of as rings.
    const rings = stroke(-5.266666666666667).flatMap((i) => i.contours);
    expect(rings).toHaveLength(1); // should be 2
    expect(netArea(rings)).toBeCloseTo((SIDE + WIDTH) ** 2, 3); // the solid outer
    expect(netArea(rings)).not.toBeCloseTo(EXPECTED, 1);
  });
});

describe('kernel limit 3 — exact coincidence between operands defeats the union', () => {
  it('unions a corner-touching checkerboard correctly', () => {
    const cell = 6;
    const inputs: KernelInput[] = [];
    let cells = 0;
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        if ((ix + iy) % 2 !== 0) continue;
        cells++;
        inputs.push(single(rectToRing(ix * cell, iy * cell, cell, cell)));
      }
    }
    expect(netArea(engine.arrange(inputs).unite())).toBeCloseTo(cells * cell * cell, 6);
  });

  it('gets it wrong once each tile grows a tab whose edge lies along the tile edge', () => {
    // `houndstooth-tooth-grid`'s construction, reduced: a checkerboard of tiles
    // plus two triangular tabs per tile, each sharing part of its tile's edge.
    // Nine operands are enough; the true area is the sum, since nothing
    // overlaps.
    const cell = 6;
    const tab = 2.4;
    const inputs: KernelInput[] = [];
    let cells = 0;
    for (const [ix, iy] of [
      [0, 0],
      [-1, 1],
      [1, 1],
    ]) {
      const x = ix * cell;
      const y = iy * cell;
      cells++;
      inputs.push(single(rectToRing(x, y, cell, cell)));
      inputs.push(
        single(
          polygonToRing([
            { x: x + cell, y },
            { x: x + cell + tab, y },
            { x: x + cell, y: y + tab },
          ]),
        ),
      );
      inputs.push(
        single(
          polygonToRing([
            { x, y: y + cell },
            { x, y: y + cell + tab },
            { x: x + tab, y: y + cell },
          ]),
        ),
      );
    }
    const expected = cells * (cell * cell + tab * tab);
    const actual = netArea(engine.arrange(inputs).unite());
    expect(expected).toBeCloseTo(125.28, 6);
    expect(actual).toBeCloseTo(122.4, 2); // one whole tab lost
    expect(actual).not.toBeCloseTo(expected, 1);
  });

  it('is avoided entirely by never putting merely-adjacent operands in one arrangement', () => {
    // Which is what `connectedComponents`' margin does: the tiles above touch
    // rather than overlap, so nothing needs uniting and each stays its own
    // region. Same artwork, no boolean, no coincidence to mis-resolve.
    const cell = 6;
    const a = single(rectToRing(0, 0, cell, cell));
    const b = single(rectToRing(cell, cell, cell, cell));
    const separate = netArea([...a.contours, ...b.contours]);
    expect(separate).toBeCloseTo(2 * cell * cell, 6);
  });
});
