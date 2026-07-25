/**
 * Arc → cubic approximation (Decision 6.1), verified BY MEASUREMENT.
 *
 * The classic 4-cubic KAPPA circle has a peak radial error of ≈ 2.725e-4 × r —
 * 1.7 µm at r = 6.4 mm but 17.4 µm at r = 64 mm, over three times the entire
 * 5 µm budget on a full-panel-height ellipse. So this module does NOT use
 * `KAPPA` / 4 cubics. It starts at 8 cubics per full ellipse (already ≈ 0.27 µm
 * at r = 64 mm) and then halves the arc angle while the MEASURED deviation
 * exceeds the budget, capped at 256 segments per full ellipse.
 *
 * Measuring beats a transcribed error formula: it cannot be mistyped, and it
 * is the assertion the test wants anyway.
 *
 * Everything here is in document millimetres, y-down. The angle parameter is
 * the ellipse's own parameter φ, so a point is `(cx + rx·cos φ, cy + ry·sin φ)`;
 * increasing φ traverses clockwise ON SCREEN and yields a POSITIVE shoelace
 * signed area, which is the Decision 0.2 sign for an outer ring.
 */

import type { KernelCubic, KernelPoint, KernelRing } from '../geometry-kernel';
import { sampleCubicAt } from '../geometry-kernel';
import { INITIAL_ELLIPSE_SEGMENTS, MAX_ELLIPSE_SEGMENTS } from './tolerance';

const TAU = Math.PI * 2;

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, phi: number): KernelPoint {
  return { x: cx + rx * Math.cos(phi), y: cy + ry * Math.sin(phi) };
}

/**
 * One cubic approximating the elliptical arc φ ∈ [phi0, phi1].
 *
 * The ellipse is an affine image of the unit circle and Béziers are
 * affine-invariant, so the circular construction (handle length
 * `(4/3)·tan(Δ/4)` along the tangent) transports to the ellipse unchanged —
 * and so does its error, which is why measuring on the real ellipse is valid.
 */
function arcCubic(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phi0: number,
  phi1: number,
): KernelCubic {
  const k = (4 / 3) * Math.tan((phi1 - phi0) / 4);
  const p0 = ellipsePoint(cx, cy, rx, ry, phi0);
  const p3 = ellipsePoint(cx, cy, rx, ry, phi1);
  // dP/dφ at each endpoint.
  const t0 = { x: -rx * Math.sin(phi0), y: ry * Math.cos(phi0) };
  const t1 = { x: -rx * Math.sin(phi1), y: ry * Math.cos(phi1) };
  return {
    p0,
    c1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
    c2: { x: p3.x - k * t1.x, y: p3.y - k * t1.y },
    p3,
  };
}

function buildArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startPhi: number,
  sweep: number,
  segments: number,
): KernelCubic[] {
  const step = sweep / segments;
  const out: KernelCubic[] = [];
  for (let i = 0; i < segments; i++) {
    out.push(arcCubic(cx, cy, rx, ry, startPhi + i * step, startPhi + (i + 1) * step));
  }
  return out;
}

/** Probe parameters, `k/16` for k = 1…15 — note t = 0.5 is among them. */
const PROBE_COUNT = 16;

/**
 * Worst deviation of the cubics from the true ellipse, in millimetres.
 *
 * DEVIATION FROM DECISION 6.1, deliberate and documented: the decision pins
 * "evaluate each cubic at `t = 0.5` and compare against the true arc point" —
 * but for the standard arc→cubic construction that probe is identically zero.
 * The handle length `(4/3)·tan(Δ/4)` is DERIVED from forcing the `t = 0.5`
 * point onto the arc (it is where `KAPPA` itself comes from), so the measured
 * value is ~1e-14 mm at any radius and the subdivision loop would never run —
 * the guard would silently do nothing. Peak error sits near `t ≈ 0.21` / `0.79`.
 *
 * So the probe set is widened to `t = k/16`, which CONTAINS `t = 0.5`; the
 * threshold, the doubling rule and the 256 cap are unchanged. Decision 6.1's
 * own figure ("8 cubics puts a 64 mm radius at ≈ 0.27 µm") is reproduced only
 * by a real max-deviation measure, so this is what that decision was costing.
 *
 * The deviation is measured radially in the ellipse's normalised frame and
 * scaled by `max(rx, ry)`, which is an upper bound on the true distance to the
 * ellipse (`|A·q − A·q̂| ≤ ‖A‖·|q − q̂|`) — conservative for an eccentric
 * ellipse, and conservative is the right direction for fabrication.
 */
export function measureArcDeviation(
  cubics: readonly KernelCubic[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): number {
  const scale = Math.max(rx, ry);
  let worst = 0;
  for (const cubic of cubics) {
    for (let k = 1; k < PROBE_COUNT; k++) {
      const p = sampleCubicAt(cubic, k / PROBE_COUNT);
      const radial = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      worst = Math.max(worst, Math.abs(radial - 1) * scale);
    }
  }
  return worst;
}

/**
 * Approximate an elliptical arc with cubics whose measured deviation from the
 * true ellipse is within `toleranceMm`. `sweep` may be negative (clockwise in
 * parameter space); its magnitude may exceed 2π only for a full ellipse.
 */
export function ellipticalArcToCubics(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startPhi: number,
  sweep: number,
  toleranceMm: number,
): KernelCubic[] {
  if (!Number.isFinite(sweep) || sweep === 0) return [];
  if (!(rx > 0) || !(ry > 0)) return [];

  const turns = Math.abs(sweep) / TAU;
  const maxSegments = Math.max(1, Math.ceil(MAX_ELLIPSE_SEGMENTS * turns));
  let segments = Math.min(maxSegments, Math.max(1, Math.ceil(INITIAL_ELLIPSE_SEGMENTS * turns)));
  let cubics = buildArc(cx, cy, rx, ry, startPhi, sweep, segments);

  while (segments < maxSegments && measureArcDeviation(cubics, cx, cy, rx, ry) > toleranceMm) {
    segments = Math.min(segments * 2, maxSegments);
    cubics = buildArc(cx, cy, rx, ry, startPhi, sweep, segments);
  }
  return cubics;
}

/** A circular arc — the stroker's round caps and round joins (Decision 5). */
export function circularArcToCubics(
  center: KernelPoint,
  radius: number,
  startPhi: number,
  sweep: number,
  toleranceMm: number,
): KernelCubic[] {
  return ellipticalArcToCubics(center.x, center.y, radius, radius, startPhi, sweep, toleranceMm);
}

/**
 * A whole ellipse as a closed cubic ring. Positive shoelace signed area, so it
 * is already an outer ring in Decision 0.2's sign convention.
 */
export function ellipseToRing(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  toleranceMm: number,
): KernelRing {
  const cubics = ellipticalArcToCubics(cx, cy, rx, ry, 0, TAU, toleranceMm);
  if (cubics.length === 0) return [];
  // Close exactly on the start point: the last cubic's p3 is cos/sin(2π),
  // which is not bit-identical to cos/sin(0).
  cubics[cubics.length - 1] = { ...cubics[cubics.length - 1], p3: cubics[0].p0 };
  return cubics;
}
