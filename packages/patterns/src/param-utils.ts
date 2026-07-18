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
