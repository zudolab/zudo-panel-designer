# Porting rules: pgen pattern → zpd `PanelPatternGenerator`

Source of truth for every port. Read fully before porting; every rule here has
been violated by a first draft at least once.

## 1. Target contract

A zpd pattern implements `PanelPatternGenerator`
(`packages/patterns/src/types.ts`):

```ts
{
  name: string;          // stable kebab id — keep the pgen id unless it collides
  displayName: string;   // human-facing label
  paramDefs: PatternParamDef[];  // numeric-only, physical mm values
  draw(ctx, { widthMm, heightMm, color, params }): void;
}
```

Hard properties of the target:

- **Panel-mm space.** The caller pre-scales the ctx so 1 unit = 1mm and
  pre-clips to the panel rect `(0,0)-(widthMm,heightMm)`. Draw in mm, never in
  pixels; never call `setTransform`/`scale` yourself; overdraw past the edges
  is fine (the clip owns it).
- **ONE flat color.** `opts.color` is the only color. No palettes, no derived
  tints, no alpha.
- **Deterministic.** Identical inputs must reproduce identical draw calls (a
  double-draw test enforces this). No `Math.random`, no `Date`, no state
  between calls.
- **Numeric-only mm `paramDefs`.** Every param is a number with
  `min/max/step/defaultValue`; generators resolve them via
  `resolveParam(params, this.paramDefs, key)` which defaults + clamps (this
  clamp is what keeps loops finite on garbage input — never read
  `params.x` directly).

## 2. Idiom mapping table (pgen → zpd)

| pgen idiom | zpd translation |
| --- | --- |
| `generate(ctx, options{width,height,rand})` | `draw(ctx, {widthMm, heightMm, color, params})` |
| `rand` / `randomizeDefaults(...)` | DROP — replace per-cell uses with `hash01` (§4), or hardcode |
| fg color pools / `colorOffset` cycling / `wrapIndex` picks | single `opts.color`; 2-color alternation → presence/absence (see `checker`) |
| `withAlpha` / `lighten` / `darken` / accent passes | DROP — express hierarchy via line width instead (e.g. accent stroke at 0.5× main width) |
| `setupPatternRender` bg fill | DROP — the caller owns the background (§3) |
| `getParam(options, defs, key)` | `resolveParam(params, this.paramDefs, key)` |
| `centeredGridOrigin` + `cols/rows + 2` loops | `centeredStart(span, pitch)` start + `span + pitch` loop bound (§5) |
| select/toggle params | integer slider (`step: 1` + `Math.round` in draw) or hardcode the classic variant |
| `advanced: true` params | hardcode their defaults |
| `description` field | drop (zpd has no description surface) |
| px-relative sizes (`width/10`, `lineWidth = tile*0.1`) | absolute mm params (§5) |

## 3. NO-BG-PAINT rule (hard)

Generators draw one fg color onto the **shared layer canvas** (see the pattern
branch of `packages/app/src/editor/renderer.ts`): whatever you do not paint
shows the layers *below*. Painting an assumed background color occludes lower
layers and breaks for arbitrary palette colors.

- Never fill the panel rect as "background".
- Never fake negative space by re-painting with a bg color.
- No `globalCompositeOperation` tricks (`destination-out` etc.) — the layer
  canvas is shared.
- Over-under interlace, punched holes, crescents: make the gap **real
  geometry** — even-odd fills (`ctx.fill('evenodd')`), arc gaps, split
  under-strand segments with a gap at each crossing — or simplify to plain
  crossings. If the look only works with bg-colored cuts, **reject** the
  pattern.

## 4. `hash01` — determinism for "was random" choices

`hash01(ix, iy, channel = 0, salt = 0): number` in
`packages/patterns/src/param-utils.ts` returns a stable uniform-ish value in
`[0, 1)` from integer cell indices (Math.imul integer hash — cheap enough to
call per cell).

- Replaces only **local, independent** random choices: per-tile orientation,
  per-cell skip, small jitter, glyph selection.
- Key it on cell indices measured from the panel-center origin so resizing the
  panel re-centers the lattice without rescrambling every cell. With a
  `centeredStart` lattice the idiom is:

  ```ts
  const iy = Math.round((y - heightMm / 2) / pitch);
  const ix = Math.round((x - widthMm / 2) / pitch);
  if (hash01(ix, iy) < 0.5) { /* orientation A */ }
  ```

- Use a distinct `channel` for each independent decision in the same cell
  (orientation vs skip vs jitter) — reusing channel 0 for two decisions
  correlates them visibly.
- **Never** use it to imitate RNG-sequence-dependent behavior: relaxation
  steps, random walks, growth processes, anything where choice N depends on
  choices 1..N−1. If the pattern's structure needs an RNG *sequence*, reject.

## 5. Sizing: one scale ratio per motif

pgen patterns size themselves relative to the canvas (`width/10` etc.); zpd
patterns are physical. Convert with ONE ratio:

1. Pick the motif's target mm pitch (the repeat distance).
2. Scale every source length by the same factor — keep all dimensionless
   ratios from the source (inset fractions, radius/cell ratios) as-is.
3. Defaults must give **3–6 motif repeats in the 30mm thumbnail** window:
   medium motifs 5–8mm pitch, fine texture 3–5mm, large feature motifs
   10–12mm.
4. Line width becomes an independent mm param
   `{min: 0.1, max: 3, step: 0.05}`, default ≈ pgen's effective
   linewidth/cell ratio × your default pitch, clamped to sanity: fine linework
   0.4–0.8mm, bold marks 1–2mm.
5. Sanity-check defaults against real TALL panels (width 5–101.3mm × 128.5mm
   height — think 20×128.5 and 40.3×128.5): the motif must still read as a
   pattern, not 1.5 giant repeats or a grey mush.

Lattice iteration idiom (replaces `centeredGridOrigin` + padded col/row
loops):

```ts
for (let y = centeredStart(heightMm, pitch); y <= heightMm + pitch; y += pitch) {
  for (let x = centeredStart(widthMm, pitch); x <= widthMm + pitch; x += pitch) {
    // cell at (x, y), spans pitch × pitch
  }
}
```

`centeredStart` centers the lattice (one tick lands on span/2) and overscans
one pitch below 0; the `span + pitch` bound overscans the far edge. When a
motif reaches BEYOND its own cell (long over-extensions, big radii), widen
both ends by the reach: start at `centeredStart(...) - reachPitches * pitch`
and bound at `span + pitch + reach`.

## 6. Param design

2–4 defs, in this priority order:

1. **Pitch / cell size (mm)** — almost always present.
2. **Line width or element radius (mm).**
3. At most ONE signature knob that meaningfully changes the look (e.g. turns
   of a spiral, ring count). Integer knobs: `step: 1` + `Math.round` in draw.

Everything else the pgen source exposes gets hardcoded at its pgen default.
When a hardcoded value is a magic ratio from the source, keep it as a named
const with a one-line comment (`// source ratio: bars inset 0.28×cell`).

## 7. Disqualifier checklist

Reject (ledger row `"status": "rejected"` + one-line reason) when the pattern
needs any of:

- Gradients, alpha washes, glow, shadows, or blend modes to read.
- Noise-field fills (value/perlin noise textures, marble, turbulence).
- Multiple colors as part of the identity (checkers of 3+ hues, rainbow
  cycles) — unless a 2-color alternation collapses cleanly to
  presence/absence.
- Randomness beyond a per-cell hash: relaxation, random walks, L-system
  growth with random branching, Poisson-disc scattering.
- Unbounded/iterative simulation, or per-pixel `ImageData` work (**hard
  ban** — bypasses the mm transform and the panel clip entirely).
- Over-under interlace that only works with bg-colored cuts (§3) and cannot
  be re-expressed as real gap geometry.
- Animation-only structure (`kind: 'animated'`, `.frag` companions) — only
  `kind: 'static'` patterns are candidates at all.

Mid-port rejections are normal: if honoring §1–§6 destroys what made the
pattern attractive, stop, write the rejected row, and pick another candidate.

## 8. Worked example: `igeta` (simple tier)

pgen source (abridged): bg fill + per-cell color cycling; cell from
`max(width,height)/cellSize`; per cell four `fillRect` bars (two vertical, two
horizontal) inset `0.28×cell` from the cell edges, `0.28×cell` thick,
over-extended `0.9×barW` past the crossings.

Dropped: bg fill (§3), color cycling → one flat color (§2),
`colorOffset`/`rand` (§2). Converted: cell → mm pitch param, bar thickness →
mm line-width param; inset ratio stays a source constant. Result
(`packages/patterns/src/patterns/igeta.ts`):

```ts
import type { PanelPatternGenerator } from '../types';
import { resolveParam, centeredStart } from '../param-utils';

export const igeta: PanelPatternGenerator = {
  name: 'igeta',
  displayName: 'Igeta',
  paramDefs: [
    { key: 'cell', label: 'Cell size (mm)', min: 3, max: 20, step: 0.5, defaultValue: 7 },
    { key: 'barWidth', label: 'Bar width (mm)', min: 0.1, max: 3, step: 0.05, defaultValue: 1.8 },
  ],
  draw(ctx, { widthMm, heightMm, color, params }) {
    const cell = resolveParam(params, this.paramDefs, 'cell');
    const barWidth = resolveParam(params, this.paramDefs, 'barWidth');
    // source ratios: bars inset 0.28×cell; bars over-extend 0.9×barWidth past
    // the crossings (seamless joints; the source's notched-timber look)
    const inset = cell * 0.28;
    const over = barWidth * 0.9;
    ctx.fillStyle = color;
    for (let y = centeredStart(heightMm, cell); y <= heightMm + cell; y += cell) {
      for (let x = centeredStart(widthMm, cell); x <= widthMm + cell; x += cell) {
        ctx.fillRect(x + inset - barWidth / 2, y - over, barWidth, cell + over * 2);
        ctx.fillRect(x + cell - inset - barWidth / 2, y - over, barWidth, cell + over * 2);
        ctx.fillRect(x - over, y + inset - barWidth / 2, cell + over * 2, barWidth);
        ctx.fillRect(x - over, y + cell - inset - barWidth / 2, cell + over * 2, barWidth);
      }
    }
  },
};
```

For a hash-driven example (per-tile orientation via `hash01` on
center-origin indices), read
`packages/patterns/src/patterns/smith-truchet.ts`.

## 9. Effort tiers

| Tier | LOC | Shape |
| --- | --- | --- |
| simple | 20–45 | direct lattice of rect/arc primitives, no per-cell decisions (`igeta`) |
| medium | 50–90 | per-cell hash decisions, multi-segment motifs, even-odd fills (`smith-truchet` at the low end) |
| complex | 90–150 | composed motifs, gap-split interlace, closed-form curve families |

If a port is trending past ~150 LOC, that is a smell: either the motif is
being over-faithful to dropped features, or the pattern belongs in the
rejected pile.

## 10. Registration + tests

- Append the generator to its **group shard** (`group-*.ts`) only — never to
  `patterns/index.ts` directly (see SKILL.md step 4).
- `pnpm vitest run packages/patterns` — the registry suite auto-covers every
  registered pattern: draws on real panel sizes (30×30 thumbnail window,
  5/40.3/101.3 × 128.5 panels) and degenerate ones, at defaults and per-param
  extremes, with garbage params; asserts it painted something, no exception,
  no non-finite coordinate, per-draw call budget (< 200k), and a
  determinism double-draw. Design the draw loop with that budget in mind
  (min-pitch × largest panel is the worst case).
- Ledger row + `node .claude/skills/port-pgen-patterns/scripts/check-ledger.mjs`
  green (SKILL.md steps 6–7).
