# Candidate notes: scored-but-unassigned pgen patterns

Pre-vetted candidates left over from the original 50-pattern port planning
(epic zudolab/zudo-panel-designer#85). Consult this file BEFORE re-triaging
pgen's full catalog — these were already scored against the rulebook and come
with porting notes.

Ground truth for "what is already done" is ALWAYS the ledger
(`packages/patterns/pgen-port-ledger.json`) via `scripts/list-candidates.mjs`
— an id listed below may have been ported or rejected since this file was
written; the lister subtracts those automatically.

## Designated spares from the wave-3 batches

Each original port batch had 2 designated spares, used only if an assigned
pattern got rejected mid-batch. Any spare NOT consumed that way remains a
first-pick candidate for a future round.

| pgen id | family | batch | why selected | porting notes |
| --- | --- | --- | --- | --- |
| `sakura-komon` | Japanese & Manga | A (japanese) | Filled five-petal sakura with cleft tips on a staggered grid — crisp bezier fills, charming organic counterpoint | Replace scatter/rotation rand() with hash of cell index; single fill color |
| `fundo-tsunagi` | Japanese & Manga | A (japanese) | Concave hourglass lozenge outlines chained on a brick-offset grid — distinctive crisp motif | Single color; translate quadraticCurveTo sides to bezier path segments |
| `khatim-star` | Islamic & Arabesque | B (ornament) | 8-point khatim star tessellation — one polygon loop per cell, negative space forms diagonal squares | Drop alpha outline and bg-alpha center accent; solid or outline stars in one color |
| `zellij-star-cross` | Islamic & Arabesque | B (ornament) | 8-point star + cross tessellation from two simple closed polygons on a checkerboard parity — crisp flat fills, deterministic layout | Drop rand() per-cell color and outlineAlpha stroke; alternate fg star / open cross in one color |
| `koch-edge-frieze` | Fractals & L-Systems | C (curves) | Stacked Koch-curve rows form crystalline ridge friezes — crisp angular polylines, distinct from zpd's smooth wave-lines | Fixed iteration depth 2-3; single stroke color, row pitch in mm |
| `hex-truchet` | Mazes, Truchet & Paths | C (curves) | Single-color quadratic-bezier arcs routed across hex tiles into continuous loops — already one stroke color | Replace per-tile random rotation (3 states) with deterministic hash(col,row) |
| `eclipse-crescent-disc-grid` | Circles & Rings | D (rings-circuits) | Crescents carved by a bg-colored offset disc over a filled disc — crisp boolean-style moon shapes, distinct from any zpd circle pattern | Crescent as real even-odd two-arc path (NO bg disc paint); deterministic angle progression from cell index |
| `chip-pad-array` | Circuits & Networks | D (rings-circuits) | Quad-flat-pack IC grid with pin rects and pin-1 dot — on-theme crisp rectangles | Drop darken(); body as outline or solid, pins filled, all one color |
| `herringbone-zigzag-break` | Zigzag & Chevron | E (tilings) | Broken chevron dashes interlocking as herringbone — simple deterministic strokes, distinct from zpd wave-lines/crosshatch | One stroke color; drop per-row color cycling |
| `star-of-david-lattice` | Crosses, Stars & Icons | E (tilings) | Stroked hexagram outlines per cell — pure linework star motif suiting etched-panel look | Replace per-cell random color with one stroke color; two triangle loops per cell |

## Future-round pool

Scored positively during planning but never assigned to a batch. Families from
pgen metadata; re-triage each against the rulebook disqualifiers before
porting (scores predate the final rulebook).

| pgen id | family |
| --- | --- |
| `nordic-weave-cross` | Celtic & Nordic |
| `houndstooth` | Checks & Plaids |
| `overlapping-circle-mesh` | Circles & Rings |
| `jaali-lattice` | Indian & Southeast Asian |
| `quatrefoil-clover-tiling` | Crosses, Stars & Icons |
| `hilbert-curve-weave` | Fractals & L-Systems |
| `cairo-pentagon-lattice` | Tessellations & Tilings |
| `circuit-traces` | Circuits & Networks |
| `solder-grid` | Circuits & Networks |
| `kolam-pulli-dots` | Indian & Southeast Asian |
| `chakra-wheel` | Indian & Southeast Asian |
| `twist-square-vortex` | Optical Illusions |
| `zigzag-bands` | Zigzag & Chevron |
| `same-komon` | Japanese & Manga |
| `nasrid-lattice` | Islamic & Arabesque |
| `trihexagonal` | Tessellations & Tilings |
| `prismatic-pentagon-tiling` | Tessellations & Tilings |
| `elementary-ca` | Fractals & L-Systems |
| `ammann-beenker` | Tessellations & Tilings |
| `fair-isle-bands` | Celtic & Nordic |

Planning also listed `meander-variants`, but no such pgen id exists — it
refers to the unported style variants inside pgen's `meander` pattern (the
classic-key variant was assigned to batch B). If batch B's `meander` port
landed, additional variants would be NEW zpd patterns (e.g.
`meander-double-key`) re-authored from that source, not a straight port.

## Where the shards map

| ledger section | shard file | theme |
| --- | --- | --- |
| `japanese` | `group-japanese.ts` | Japanese classics |
| `ornament` | `group-ornament.ts` | Islamic, Indian & heritage ornament |
| `curves` | `group-curves.ts` | curves, fractals & truchet |
| `ringsCircuits` | `group-rings-circuits.ts` | circles, stars & circuit motifs |
| `tilings` | `group-tilings.ts` | weaves, checks & tilings |

A future round that doesn't fit these themes should add a new shard + ledger
section (SKILL.md step 4) rather than stretching an existing one.
