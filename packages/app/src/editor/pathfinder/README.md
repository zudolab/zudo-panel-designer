# Path Finder ops

The ten Illustrator-panel operations, as a pure module over the
[geometry kernel](../geometry-kernel/README.md).

| Row         | Ops                                                 |
| ----------- | --------------------------------------------------- |
| Shape Modes | Unite · Minus Front · Intersect · Exclude           |
| Pathfinders | Divide · Trim · Merge · Crop · Outline · Minus Back |

Import from `./index`, never from the individual files.

Everything here is op **policy** — op names, selection eligibility, z-order
roles, style inheritance, where a result lands. None of it belongs in the
kernel: that is what lets the Gerber exporter depend on the kernel without
dragging the Path Finder along.

## What is here

| File             | Contents                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `types.ts`       | `PathfinderOp`, `EligibleLeaf`, `PathfinderTarget`, `PathfinderOpResult`, `ResolvedInputStyle`. No runtime code. |
| `selection.ts`   | Selection → back→front eligible inputs, and the destination rule.                                                |
| `style.ts`       | One leaf's paint → `ResolvedInputStyle`.                                                                         |
| `convert.ts`     | Layer ↔ kernel: bake leaves to rings, group result rings into `KernelPathSpec`s.                                 |
| `shape-modes.ts` | The five boolean ops.                                                                                            |
| `faces-ops.ts`   | Divide / Trim / Merge / Crop over the planar arrangement.                                                        |
| `outline-op.ts`  | Edge extraction.                                                                                                 |
| `dispatch.ts`    | The op list, the min-input table, `applyPathfinderOp`.                                                           |

## What is NOT here

**Committing a result to the document.** An op returns
`{ specs, target }` — geometry plus a destination. Minting ids, inserting at
the slot, grouping a multi-spec result, and folding it all into one undo entry
belong to the panel/UI sub-issue.

**Stroke expansion.** `outlineOp` emits **open, unfilled** paths whose stroke is
the source's fill colour. That is correct Pathfinder behaviour, and it is _not_
turning a stroked centreline into a filled polygon — a separate sub-issue owns
that. The kernel's README says the same about itself.

## Ported from pgen, with real deletions

Source: `pgen/packages/pattern-gen-viewer/src/utils/pathfinder/`. Three things
were dropped rather than adapted, because zpd's model is simpler:

- **`pathProjector`.** pgen applied a bbox-fit scale + centre rotation on the
  way into a boolean and re-derived a transform struct on the way out. zpd
  stores every leaf in world millimetres with **absolute mm handles**, and
  `PathLayer` has no transform and no rotation field — so there is nothing to
  project in either direction. Result specs are world-mm too.
- **The gradient preflight.** pgen's `style.ts` threw on a non-solid fill and
  the panel rendered a blocked-reason banner. zpd's fill is a
  `ColorIndex | null`; there is no gradient, so both the branch and its UI
  affordance would have been permanently dead.
- **`ColorRef` / `ColorScheme` resolution.** Styles are two nullable palette
  indices and a width, read straight off the leaf. No resolution context.

## Contracts that are load-bearing

### Back→front input order

`resolvePathfinderInputs` returns inputs **bottom→top**: index 0 is the
backmost. Minus Front keeps `[0]`, Minus Back keeps the last, and Trim / Crop /
Divide attribute every face to the topmost filled cover. Get this wrong and all
of them return a plausible-looking shape built from the wrong operand, with no
exception and no empty result. The order comes from `projectFlatLayers`' own
projection and `selection.test.ts` compares against it directly.

### Minimum inputs

`divide` and `outline` need **≥1** (a single self-intersecting path is a
meaningful input to both); the other eight need **≥2**. There is no same-parent
requirement — inputs may live in different groups at different depths.

### Fill rule

A path leaf is **always `evenodd`**, even with no `extraSubpaths`. This diverges
from pgen (which used `nonzero` until an inner ring appeared) because zpd's
renderer paints every path with `ctx.fill(path, 'evenodd')` unconditionally, and
the boolean has to agree with what is on screen. Shape leaves stay `nonzero`.
For a simple single ring the rules coincide, so only self-intersecting pen paths
are affected.

### Cross-material destination

A result lands in the container of the **frontmost (topmost) eligible input**,
uniformly for all ten ops. The justification is style inheritance: Unite /
Intersect / Exclude / Minus Back already adopt the topmost input's paint, so
geometry and material stay together.

Two consequences, both intended:

- **Minus Front** inherits the _backmost_ input's style but still lands in the
  frontmost's container, so a cross-material Minus Front has its inherited
  colour rewritten by `normalizeLayerMaterial` on commit. A per-op destination
  was rejected because the faces ops have no single style source to derive one
  from, and a uniform rule is easier to reason about than five.
- **Faces ops** attribute each face to a different input, so a cross-material
  result carries several colours into one container and all of them are
  normalized. This module reports the attributed colour faithfully; collapsing
  it is the document mutation's doing.

Related: within a _single_ material container every leaf already carries that
material's colour, so Merge's same-colour fusing and Trim's per-input split
only diverge for cross-material selections. The attribution code is
colour-generic regardless.

## Known limit inherited from the backend

**Exact edge tangency.** When an input edge is exactly tangent to another (e.g.
a rect's edge touching a circle at one point), path-bool drops the intersection
region and splits the union — the
`area(A∪B) + area(A∩B) == area(A) + area(B)` invariant does not hold there.
Nudging either shape by more than the kernel's 1e-4 mm snap grid restores it.
Nothing in this module can recover it; it is the kernel's documented paper.js
fallback territory. Pinned by a named test in `shape-modes.test.ts` so that a
future backend fix shows up as a failing test rather than going unnoticed.

The kernel's own **point-touching lobes** limit (two shapes meeting at exactly
one corner come back as one non-simple ring) applies here unchanged; see the
kernel README.
