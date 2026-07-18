---
name: port-pgen-patterns
description: 'Port static pattern generators from the pgen repo (zudolab/zudo-pattern-gen) into zpd panel patterns. Use when the user says "port pgen patterns", "add more patterns from pgen", "port more patterns", "grow the pattern catalog from pgen", or otherwise wants pgen/pattern-gen patterns brought into the panel designer.'
---

# Port pgen patterns into zpd

Repeatable workflow for porting static patterns from pgen
(zudolab/zudo-pattern-gen) into `@zpd/patterns` as `PanelPatternGenerator`s.
Everything needed lives in this skill + the repo — no prior session context
required.

## Layout

| Piece | Path |
| --- | --- |
| Rulebook (read BEFORE porting anything) | `references/porting-rules.md` |
| Scored candidate pool + spares from past planning | `references/candidate-notes.md` |
| Candidate lister | `scripts/list-candidates.mjs` |
| Ledger ↔ registry checker | `scripts/check-ledger.mjs` |
| Ledger (what was ported/rejected, append-only) | `packages/patterns/pgen-port-ledger.json` |
| Group shard files (ported generators live here) | `packages/patterns/src/patterns/group-*.ts` |
| Registry | `packages/patterns/src/patterns/index.ts` |
| Shared helpers (`resolveParam`, `centeredStart`, `hash01`) | `packages/patterns/src/param-utils.ts` |

## Step 1 — resolve the pgen checkout

pgen is expected at `$HOME/repos/zp/pgen`; override with the `PGEN_DIR` env
var. If neither exists, stop and tell the user to clone
`zudolab/zudo-pattern-gen` (the port cannot proceed without the source repo —
there is no bundled copy).

- Static-pattern metadata: `$PGEN_DIR/packages/generators/src/pattern-search-metadata.ts`
  (data-only, `kind: 'static' | 'animated'`)
- Pattern sources: `$PGEN_DIR/packages/generators/src/patterns/<id>.ts`

## Step 2 — list candidates

```sh
node .claude/skills/port-pgen-patterns/scripts/list-candidates.mjs          # grouped by family
node .claude/skills/port-pgen-patterns/scripts/list-candidates.mjs --json   # machine-readable
node .claude/skills/port-pgen-patterns/scripts/list-candidates.mjs <id...>  # check specific ids
```

The script subtracts everything already in the ledger (any status), so
previously ported AND previously rejected patterns never get re-attempted.
Check `references/candidate-notes.md` first — it holds pre-scored candidates
(designated spares and a future-round pool) with porting notes.

## Step 3 — triage each candidate

Read the pgen source and run it against the disqualifier checklist in
`references/porting-rules.md`. Reject early: gradients/alpha, noise fills,
multi-color-essential looks, sequence-dependent randomness, per-pixel
ImageData, bg-cut interlace, animation-only. A rejection still gets a ledger
row (`"status": "rejected"` + one-line reason) so it is never re-triaged.

## Step 4 — port per the rulebook

Follow `references/porting-rules.md` for the mapping (mm-space params, single
`color`, determinism via `hash01`, `resolveParam` + `centeredStart` idioms,
sizing defaults, NO-BG-PAINT). One file per pattern:
`packages/patterns/src/patterns/<zpd-name>.ts` (kebab-case; keep the pgen id
as the zpd name unless it collides with an existing generator).

Append the generator to the matching **group shard**
(`group-japanese.ts`, `group-ornament.ts`, `group-curves.ts`,
`group-rings-circuits.ts`, `group-tilings.ts`). Do NOT add generators to
`patterns/index.ts` directly — the registry only grows via shard spreads,
which keeps parallel port branches conflict-free. If no existing shard fits a
new porting round, create a new `group-<theme>.ts` shard, spread it at the END
of the `PATTERN_GENERATORS` array in `index.ts`, and add a matching new
section to the ledger.

## Step 5 — test

```sh
pnpm vitest run packages/patterns
```

The registry suite auto-covers every registered generator (real panel sizes,
determinism double-draw, garbage params, non-finite coordinate scan, call
budget) — a new pattern needs no bespoke test to get this coverage. Also run
`pnpm typecheck` and `pnpm lint` before finishing.

## Step 6 — record in the ledger

Append one row per attempted pattern to the matching section of
`packages/patterns/pgen-port-ledger.json`:

```json
{
  "zpdName": "igeta",
  "pgenId": "igeta",
  "family": "Japanese & Manga",
  "status": "ported",
  "date": "2026-07-18",
  "notes": "one line on what was dropped/translated (or why rejected)"
}
```

`status` is `ported`, `original` (pre-port hand-written patterns only), or
`rejected`. Sections are APPEND-ONLY: never reorder, resort, or rewrite
existing rows — parallel branches rely on each batch's diff staying in its own
hunk.

## Step 7 — verify ledger ↔ registry

```sh
node .claude/skills/port-pgen-patterns/scripts/check-ledger.mjs
```

Must print OK: every registered generator has exactly one `ported`/`original`
row, every such row has a registered generator, names and pgen ids unique.

## Step 8 — visual sanity

Patterns render as one flat color on the panel (gold on black by default). If
a browser is available, check the pattern picker thumbnails (30mm window) and
one tall panel (e.g. 40.3×128.5mm) at defaults: crisp lines, centered motif,
3–6 motif repeats in the thumbnail. Tune `defaultValue`s if a pattern reads
muddy or sparse — defaults are part of the deliverable.
