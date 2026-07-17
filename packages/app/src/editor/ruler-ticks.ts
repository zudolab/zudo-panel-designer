// Pure tick math for the mm rulers — no DOM, node-testable. The ruler strips
// paint whatever this returns; all coordinate-space correctness lives here
// (and in ruler-ticks.test.ts), not in the canvas painting code.
//
// Coordinate model: screen = mm * pxPerMm + offset (same as camera.project),
// so mm 0 always lands exactly at the camera offset — the panel's top-left
// corner — for any pan/zoom.

export interface TickStep {
  /** labeled tick spacing in mm (1-2-5 x 10^n) */
  major: number;
  /** unlabeled tick spacing in mm (= major / 5) */
  minor: number;
}

export interface RulerTick {
  mm: number;
  cssPx: number;
  isMajor: boolean;
}

// Smallest 1-2-5 x 10^n step whose on-screen spacing is >= targetPx, so major
// (labeled) ticks never crowd below ~targetPx apart at any zoom.
export function pickTickStepMm(pxPerMm: number, targetPx = 50): TickStep {
  const thresholdMm = targetPx / pxPerMm;
  // Start one decade below the threshold's magnitude to absorb log10 float
  // error near exact powers of ten, then walk 1-2-5 upward.
  let exp = Math.floor(Math.log10(thresholdMm)) - 1;
  for (;;) {
    for (const mantissa of [1, 2, 5]) {
      const step = mantissa * 10 ** exp;
      if (step * pxPerMm >= targetPx) return { major: step, minor: step / 5 };
    }
    exp += 1;
  }
}

// All minor-grid ticks whose screen position falls inside [0, lengthPx],
// overscanned by one minor tick per end so edge ticks/labels don't pop in
// and out while panning. Tick mm values are computed from integer indices
// (i * minor), which keeps mm 0 exact and makes the major test float-safe:
// major = 5 * minor, so isMajor is simply i % 5 === 0.
export function getRulerTicksMm(
  pxPerMm: number,
  offsetPx: number,
  lengthPx: number,
  step: TickStep,
): RulerTick[] {
  const { minor } = step;
  if (pxPerMm <= 0 || lengthPx <= 0 || minor <= 0) return [];
  const startMm = (0 - offsetPx) / pxPerMm;
  const endMm = (lengthPx - offsetPx) / pxPerMm;
  const firstIndex = Math.floor(startMm / minor) - 1; // snap down + overscan
  const lastIndex = Math.ceil(endMm / minor) + 1;
  const ticks: RulerTick[] = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    const mm = i * minor;
    ticks.push({
      mm,
      cssPx: mm * pxPerMm + offsetPx,
      isMajor: i % 5 === 0,
    });
  }
  return ticks;
}

// Label text for a major tick: integers once the step is coarse enough,
// one decimal for sub-mm steps (0.5 major at deep zoom).
export function formatTickLabel(mm: number, majorStep: number): string {
  return majorStep >= 1 ? String(Math.round(mm)) : mm.toFixed(1);
}
