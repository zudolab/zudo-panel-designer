// Shared helpers every pattern generator's draw() uses to turn raw params into
// safe, finite drawing coordinates.

import type { PatternParamDef } from './types';

// Resolve a param: fall back to the def's default when missing/non-finite, then
// clamp into [min,max]. Clamping is not just cosmetic — it guarantees positive
// pitches/counts, which keeps the draw loops below finite even if a caller
// passes a stale, zero, or negative value.
export function resolveParam(
  params: Record<string, number>,
  defs: PatternParamDef[],
  key: string,
): number {
  const raw = params[key];
  const finiteRaw = typeof raw === 'number' && Number.isFinite(raw);
  const def = defs.find((d) => d.key === key);
  if (!def) {
    // No param def to clamp against (a draw() asked for a key it never
    // declared — a programmer error). Prefer a finite provided value over a
    // silent 0, which would bypass the positive-pitch/count clamp invariant the
    // draw loops rely on and could hang or crash them.
    return finiteRaw ? raw : Number.NaN;
  }
  const value = finiteRaw ? raw : def.defaultValue;
  return Math.min(def.max, Math.max(def.min, value));
}

// Lowest lattice coordinate to start iterating from so the tiling is centered on
// the panel (one tick lands on span/2) and overscans below 0. Pair with a loop
// bound of `span + pitch` to also overscan the far edge.
export function centeredStart(span: number, pitch: number): number {
  const half = span / 2;
  return half - Math.ceil(half / pitch + 1) * pitch;
}

// Deterministic stand-in for the per-cell rand() calls in patterns ported from
// pgen (tile orientation, cell skip, jitter — local independent choices ONLY,
// never sequence-dependent simulation). Key it on cell indices measured from
// the panel-CENTER origin — `Math.round((x - widthMm / 2) / pitch)` for a
// centeredStart lattice — so resizing the panel re-centers the tiling without
// rescrambling every cell. `channel` separates independent decisions within one
// cell; `salt` separates variants. Math.imul integer mixing with a murmur3-style
// finalizer: pure, no floats in the mix, uniform-ish output in [0, 1).
export function hash01(ix: number, iy: number, channel = 0, salt = 0): number {
  let h = 0x811c9dc5 ^ Math.imul(salt | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (ix | 0), 0x9e3779b1);
  h = Math.imul(h ^ (iy | 0), 0x85ebca77);
  h = Math.imul(h ^ (channel | 0), 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}
