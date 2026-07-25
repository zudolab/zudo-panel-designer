/**
 * Path Finder — Pathfinders-row faces ops: Divide / Trim / Merge / Crop.
 *
 * Built on the planar arrangement the kernel exposes (`faces()` /
 * `buildShape()`). Every op is `(orderedInputs, engine?) => Promise<result>`,
 * matching the Shape-Modes convention so one dispatcher can drive all ten.
 *
 * ── Face attribution (the correctness risk of this file) ────────────────────
 * Each atomic face is entirely inside-or-outside every input's filled region,
 * so its paint is decided by ONE representative interior point hit-tested
 * against the inputs top→down. Two rules are load-bearing:
 *
 *   1. The representative point comes from the kernel's OWN face geometry
 *      ({@link ringInteriorPoint} — a topmost-vertex bisector step, not a naive
 *      edge-midpoint + inward normal, which can land OUTSIDE thin or curved
 *      faces) and is ALWAYS containment-checked (inside the outer ring AND
 *      outside every hole). If that candidate fails, a horizontal-scanline
 *      midpoint ({@link scanlineInteriorPoint}) — guaranteed interior for any
 *      simple region with holes — is used instead. The thin crescents from two
 *      overlapping ellipses are exactly the case that exercises the fallback.
 *
 *   2. Hit-testing respects each input's OWN fill rule (convert.ts gives path
 *      leaves `evenodd`, matching zpd's renderer, and shape leaves `nonzero`),
 *      and the TOPMOST FILLED input wins. An unfilled input is transparent to
 *      the search — the filled object behind it shows through, as in
 *      Illustrator. Faces covered by NO filled input are dropped, matching
 *      Illustrator's "Divide and Outline Will Remove Unpainted Artwork" ON.
 */

import {
  createBooleanEngine,
  flattenRing,
  pointInPolygon,
  ringInteriorPoint,
  ringSignedArea,
  type BooleanArrangement,
  type BooleanEngine,
  type KernelFillRule,
  type KernelPathSpec,
  type KernelPoint,
  type KernelRing,
} from '../geometry-kernel';
import { leafToKernelInput, ringsToSpecs } from './convert';
import { pathfinderTarget } from './selection';
import { resolveInputStyle } from './style';
import type { EligibleLeaf, PathfinderOpResult, ResolvedInputStyle } from './types';

/** Illustrator display names — the result layer name base. */
const OP_NAME = { divide: 'Divide', trim: 'Trim', merge: 'Merge', crop: 'Crop' } as const;

const EMPTY: PathfinderOpResult = { specs: [], target: null };

/**
 * Divide (≥1 input, so a single self-intersecting path can split itself):
 * every PAINTED atomic face becomes one spec carrying that face's attributed
 * fill. Strokes dropped, unpainted faces dropped.
 */
export async function divide(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < 1) return EMPTY;
  const eng = engine ?? (await createBooleanEngine());
  const inputs = prepareInputs(orderedInputs);
  const arrangement = arrange(eng, inputs);

  const specs: KernelPathSpec[] = [];
  for (const face of arrangement.faces()) {
    const owner = topmostFilledCovering(faceRepresentativePoint(face), inputs);
    if (!owner) continue; // covered by no filled input → dropped
    specs.push(...ringsToSpecs(face, dropStroke(owner.style), OP_NAME.divide));
  }
  return finalize(specs, OP_NAME.divide, orderedInputs);
}

/**
 * Trim (≥2 inputs): per input, `buildShape` of the faces where that input is
 * the topmost visible (filled) cover. Strokes dropped; same-colour regions are
 * NOT merged — two inputs sharing a fill stay two specs.
 */
export async function trim(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < 2) return EMPTY;
  const eng = engine ?? (await createBooleanEngine());
  const inputs = prepareInputs(orderedInputs);
  const arrangement = arrange(eng, inputs);
  const owners = attributeFaces(arrangement.faces(), inputs);

  // One spec-set per input, back→front, so the result keeps the original
  // z-stacking (the face-sets are disjoint, so this is cosmetic).
  const specs: KernelPathSpec[] = [];
  for (const input of inputs) {
    const faceIndices = collectFaces(owners, input.index);
    if (faceIndices.length === 0) continue;
    specs.push(...buildOwnedSpecs(arrangement, faceIndices, input.style, OP_NAME.trim));
  }
  return finalize(specs, OP_NAME.trim, orderedInputs);
}

/**
 * Merge (≥2 inputs): Trim, then fuse the face-sets that resolve to the SAME
 * fill — group faces by attributed fill, `buildShape` per group, so adjacent
 * same-colour regions become one spec. Groups are emitted in sorted fill order
 * for determinism; the per-fill face-sets are spatially disjoint, so the fused
 * specs never overlap.
 */
export async function merge(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < 2) return EMPTY;
  const eng = engine ?? (await createBooleanEngine());
  const inputs = prepareInputs(orderedInputs);
  const arrangement = arrange(eng, inputs);
  const owners = attributeFaces(arrangement.faces(), inputs);

  const byFill = new Map<string, { faceIndices: number[]; style: ResolvedInputStyle }>();
  owners.forEach((ownerIndex, faceIndex) => {
    if (ownerIndex < 0) return;
    const style = inputs[ownerIndex]!.style;
    const key = String(style.fill);
    const bucket = byFill.get(key) ?? { faceIndices: [], style };
    bucket.faceIndices.push(faceIndex);
    byFill.set(key, bucket);
  });

  const specs: KernelPathSpec[] = [];
  for (const key of [...byFill.keys()].sort()) {
    const { faceIndices, style } = byFill.get(key)!;
    specs.push(...buildOwnedSpecs(arrangement, faceIndices, style, OP_NAME.merge));
  }
  return finalize(specs, OP_NAME.merge, orderedInputs);
}

/**
 * Crop (≥2 inputs): keep only faces INSIDE the topmost input, which is consumed
 * as a pure clip boundary — its own paint is discarded, so each surviving face
 * takes the fill of the topmost filled input BELOW it. Faces inside the crop
 * but covered by no lower filled input are dropped. Strokes dropped; Trim-style
 * per-input `buildShape` (no same-colour merge).
 */
export async function crop(
  orderedInputs: EligibleLeaf[],
  engine?: BooleanEngine,
): Promise<PathfinderOpResult> {
  if (orderedInputs.length < 2) return EMPTY;
  const eng = engine ?? (await createBooleanEngine());
  const inputs = prepareInputs(orderedInputs);
  const top = inputs[inputs.length - 1]!;
  const lower = inputs.slice(0, inputs.length - 1);
  const arrangement = arrange(eng, inputs);

  // Attribute among the LOWER inputs only, and only for faces inside the top
  // boundary (geometric coverage — the top's own fill is irrelevant here).
  const owners = arrangement.faces().map((face) => {
    const rep = faceRepresentativePoint(face);
    if (!pointInFilledContours(rep, top.polys, top.fillRule)) return -1;
    const owner = topmostFilledCovering(rep, lower);
    return owner ? owner.index : -1;
  });

  const specs: KernelPathSpec[] = [];
  for (const input of lower) {
    const faceIndices = collectFaces(owners, input.index);
    if (faceIndices.length === 0) continue;
    specs.push(...buildOwnedSpecs(arrangement, faceIndices, input.style, OP_NAME.crop));
  }
  return finalize(specs, OP_NAME.crop, orderedInputs);
}

// ─── Input preparation + attribution ────────────────────────────────────────

/**
 * A baked op input: its world-mm contours (for the kernel), flattened copies of
 * those SAME contours (for hit-testing, so the geometry stays consistent with
 * what the arrangement saw), their shared fill rule, resolved style, and its
 * z-order index (0 = backmost).
 */
interface PreparedInput {
  index: number;
  contours: KernelRing[];
  polys: KernelPoint[][];
  fillRule: KernelFillRule;
  style: ResolvedInputStyle;
}

/**
 * Bake each leaf into one compound input + resolve its style. Leaves arrive
 * back→front, so `index` doubles as the paint order the arrangement and the
 * attribution both rely on. A degenerate input keeps its position and style but
 * has no contours, so it can never own a face.
 */
function prepareInputs(leaves: EligibleLeaf[]): PreparedInput[] {
  return leaves.map((leaf, index) => {
    const { contours, fillRule } = leafToKernelInput(leaf);
    return {
      index,
      contours,
      // Do NOT pass `flattenRing` straight to `map`: the array index would be
      // taken as its optional `samplesPerSeg` argument (index 0 → empty poly).
      polys: contours.map((contour) => flattenRing(contour)),
      fillRule,
      style: resolveInputStyle(leaf),
    };
  });
}

function arrange(engine: BooleanEngine, inputs: PreparedInput[]): BooleanArrangement {
  return engine.arrange(inputs.map((i) => ({ contours: i.contours, fillRule: i.fillRule })));
}

/**
 * The topmost FILLED input whose filled region covers `pt`, searching front→back
 * over `candidates` (which are back→front). Unfilled inputs are skipped — they
 * are transparent, and the search continues to the filled object behind them.
 * Null when nothing filled covers the point → the face is unpainted → dropped.
 */
function topmostFilledCovering(pt: KernelPoint, candidates: PreparedInput[]): PreparedInput | null {
  for (let k = candidates.length - 1; k >= 0; k--) {
    const candidate = candidates[k]!;
    if (candidate.style.fill === null) continue;
    if (pointInFilledContours(pt, candidate.polys, candidate.fillRule)) return candidate;
  }
  return null;
}

/** Every face → its winning input index, or -1 (dropped). Shared by Trim/Merge. */
function attributeFaces(faces: KernelRing[][], candidates: PreparedInput[]): number[] {
  return faces.map((face) => {
    const owner = topmostFilledCovering(faceRepresentativePoint(face), candidates);
    return owner ? owner.index : -1;
  });
}

function collectFaces(owners: number[], inputIndex: number): number[] {
  const out: number[] = [];
  owners.forEach((ownerIndex, faceIndex) => {
    if (ownerIndex === inputIndex) out.push(faceIndex);
  });
  return out;
}

/** `buildShape` the given faces and turn the merged rings into fill-only specs. */
function buildOwnedSpecs(
  arrangement: BooleanArrangement,
  faceIndices: number[],
  style: ResolvedInputStyle,
  name: string,
): KernelPathSpec[] {
  const rings = arrangement.buildShape(faceIndices);
  if (rings.length === 0) return [];
  return ringsToSpecs(rings, dropStroke(style), name);
}

/** Faces ops always drop strokes; the width rides along inertly. */
function dropStroke(style: ResolvedInputStyle): ResolvedInputStyle {
  return { fill: style.fill, stroke: null, strokeWidth: style.strokeWidth };
}

/** Empty → no-op; multi-piece → number the pieces for a readable layer tree. */
function finalize(
  specs: KernelPathSpec[],
  base: string,
  orderedInputs: readonly EligibleLeaf[],
): PathfinderOpResult {
  if (specs.length === 0) return EMPTY;
  if (specs.length > 1) {
    specs.forEach((spec, i) => {
      spec.name = `${base} ${i + 1}`;
    });
  }
  return { specs, target: pathfinderTarget(orderedInputs) };
}

// ─── Representative interior point (containment-checked) ────────────────────

/**
 * A point guaranteed strictly interior to a face (outer ring minus its holes).
 *
 * Primary: the kernel's {@link ringInteriorPoint} of the outer ring, CONTAINMENT
 * CHECKED against the outer ring and every hole. If it lands in a hole, or
 * outside a thin/curved outer ring, fall back to a horizontal-scanline
 * midpoint. Exported for the concave/curved-face attribution test.
 */
export function faceRepresentativePoint(face: KernelRing[]): KernelPoint {
  const outer = outerRingOf(face);
  const outerPoly = flattenRing(outer);
  const holePolys = face.filter((ring) => ring !== outer).map((ring) => flattenRing(ring));
  const inFace = (p: KernelPoint): boolean =>
    pointInPolygon(p, outerPoly) && holePolys.every((hole) => !pointInPolygon(p, hole));

  const primary = ringInteriorPoint(outer);
  if (inFace(primary)) return primary;

  const scan = scanlineInteriorPoint(outerPoly, holePolys);
  if (scan && inFace(scan)) return scan;

  // Realistic faces are covered by primary/scan; keep a deterministic value.
  return primary;
}

/** The outer boundary of a face = the ring of largest |signed area|. */
function outerRingOf(face: KernelRing[]): KernelRing {
  let best = face[0]!;
  let bestArea = -1;
  for (const ring of face) {
    const area = Math.abs(ringSignedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

/**
 * Midpoint of the widest interior span on a horizontal scan line through a
 * region (outer polyline minus hole polylines), evaluated even-odd so holes
 * carve the span correctly. Several y levels are tried, avoiding the bbox edges
 * (and thus most vertices); returns the first non-degenerate interior midpoint,
 * or null if the region has no area on any tried line.
 *
 * This is the robustness net the naive edge-midpoint attribution lacks: it never
 * lands outside a thin crescent. Exported for direct testing.
 */
export function scanlineInteriorPoint(
  outerPoly: KernelPoint[],
  holePolys: KernelPoint[][],
): KernelPoint | null {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outerPoly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!(maxY > minY)) return null;

  const allPolys = [outerPoly, ...holePolys];
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.15, 0.85, 0.45, 0.55];
  for (const fraction of fractions) {
    const y = minY + (maxY - minY) * fraction;
    const xs: number[] = [];
    for (const poly of allPolys) {
      const n = poly.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[j]!;
        const b = poly[i]!;
        if (a.y <= y !== b.y <= y) {
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    // Even-odd: interior spans are [xs[0],xs[1]], [xs[2],xs[3]], …
    let bestMid: number | null = null;
    let bestWidth = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1]! - xs[k]!;
      if (width > bestWidth) {
        bestWidth = width;
        bestMid = (xs[k]! + xs[k + 1]!) / 2;
      }
    }
    if (bestMid !== null && bestWidth > 1e-9) return { x: bestMid, y };
  }
  return null;
}

// ─── Fill-rule-aware point-in-contours ──────────────────────────────────────

/**
 * Is `pt` inside the filled region of a compound input?
 *
 * Even-odd toggles membership for every containing contour, independent of
 * contour direction. Nonzero sums each contour's signed winding number before
 * deciding, so oppositely wound holes cancel while equally wound nested
 * contours stay filled.
 */
export function pointInFilledContours(
  pt: KernelPoint,
  polys: KernelPoint[][],
  fillRule: KernelFillRule,
): boolean {
  if (fillRule === 'evenodd') {
    let inside = false;
    for (const poly of polys) {
      if (pointInPolygon(pt, poly)) inside = !inside;
    }
    return inside;
  }

  let winding = 0;
  for (const poly of polys) winding += windingNumber(pt, poly);
  return winding !== 0;
}

/**
 * Is `pt` inside the filled region of a single ring under `fillRule`? Even-odd
 * defers to the kernel's `pointInPolygon`; nonzero uses a winding number, so a
 * self-intersecting path's doubly-wound core reads as filled (even-odd would
 * punch it — which is what zpd's renderer actually does for a path leaf, hence
 * the rule travelling with the input rather than being fixed here). Exported for
 * direct testing.
 */
export function pointInFilledRing(
  pt: KernelPoint,
  poly: KernelPoint[],
  fillRule: KernelFillRule,
): boolean {
  return pointInFilledContours(pt, [poly], fillRule);
}

/** Signed winding number of a closed polyline around `pt` (Sunday's algorithm). */
export function windingNumber(pt: KernelPoint, poly: KernelPoint[]): number {
  let wn = 0;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    if (a.y <= pt.y) {
      if (b.y > pt.y && isLeft(a, b, pt) > 0) wn++;
    } else if (b.y <= pt.y && isLeft(a, b, pt) < 0) {
      wn--;
    }
  }
  return wn;
}

/** >0 if `p` is left of the directed line a→b, <0 if right, 0 if collinear. */
function isLeft(a: KernelPoint, b: KernelPoint, p: KernelPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}
