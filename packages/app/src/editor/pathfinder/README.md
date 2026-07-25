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
| `mutation.ts`    | Op result → new layer tree. Pure, synchronous, `PcbLayerStack` in / out.                                         |
| `runner.ts`      | Dispatch, the stale-input guard, one history commit.                                                             |

## What is NOT here

**The panel.** Buttons, enabled state, icons and keyboard bindings are the UI
sub-issue (#214). `createPathfinderRunner(host).run(op)` is the whole surface
it needs; `canApplyPathfinderOp` gates the buttons and `PATHFINDER_OP_LABELS`
names them.

**Stroke expansion.** `outlineOp` emits **open, unfilled** paths whose stroke is
the source's fill colour. That is correct Pathfinder behaviour, and it is _not_
turning a stroked centreline into a filled polygon — a separate sub-issue owns
that. The kernel's README says the same about itself.

## Committing a result (#213)

An op returns `{ specs, target }` — geometry plus a destination.
`mutation.ts` turns that into a tree and `runner.ts` commits it, in one undo
entry. Four decisions live there:

- **Tree shape.** A multi-piece result becomes ONE group node in the frontmost
  input's slot, not N flat siblings — Illustrator's behaviour, and it keeps the
  pieces one selectable unit and one contiguous z-band. A single spec is a lone
  leaf. `shouldGroupResult` is the predicate.
- **One undo entry.** The whole thing is one pure stack→stack transform handed
  to `commit()` once. zpd's history snapshots the full document, so the new
  group, the consumed inputs and the pruned groups revert together — the
  tree-SHAPE change is inside the snapshot. pgen's `flushSync`-in-a-reducer
  ordering has no analogue here and was not ported.
- **Empty-group cleanup.** zpd DOES clean up (pgen does not, and inherits
  orphan groups). A group is dropped when it was an ancestor of a consumed
  input and has no children left; the sweep cascades to parents. A group that
  was ALREADY empty before the op is left alone — undoing a Path Finder op
  must not resurrect something the user emptied in an earlier edit.
- **Multi-colour attribution.** The insert routes through
  `replacePcbNodeWithNodes`, so the several attributed colours a faces op can
  carry into one container are normalized to the destination material like any
  other insertion. Only the null/non-null paint channels survive: an unfilled
  spec stays unfilled, so Outline's edges keep their single painted channel.

### Stale input

Geometry is asynchronous (lazy `import('path-bool')`, async op entry points),
so between the click and the result the user may edit the document, change the
selection, or dispatch another op. `runner.ts` captures a revision at dispatch
and discards any result that no longer matches it. Without this, an edit made
while the kernel is still loading is silently overwritten.

Three checks, all after the await and before any write:

| Check          | Source                          | Catches                                        |
| -------------- | ------------------------------- | ---------------------------------------------- |
| **superseded** | a per-dispatch sequence number  | a newer op dispatched while this one ran       |
| **state**      | `doc.layers` ref + selected ids | an edit or selection change the host has shown |
| **epoch**      | `host.mutationEpoch`            | a mutation React has queued but not flushed    |

The epoch exists because the state check is **not sufficient in React**.
`ToolContext.doc` / `.selectedIds` read refs that resync in a passive effect,
so a mutation dispatched while geometry is pending is invisible to them until
React renders. A continuation resuming inside that window would pass the state
check and commit a whole-document snapshot built from the superseded doc,
reverting the user's edit. `mutationEpoch` is bumped synchronously inside every
mutator (`use-doc-history.ts` for the document half, `Editor.tsx` for the
selection half), so it moves at call time rather than at flush time — and it
covers undo / redo / gesture aborts, which never name their own resulting
document. Any other host wiring this runner up must provide the same guarantee;
a constant epoch compiles and is correct only when the host's reads are
synchronous.

The epoch is deliberately **coarse** — it counts mutations without describing
them, so it cannot tell a guide drag from a layer edit. Against a host that
provides one, any document or selection mutation landing during the await
cancels the op, even one that left `doc.layers` alone. That is the intended
trade: a Path Finder op is cheap and repeatable, reverting a user's edit is
not, and the window traded away is the few milliseconds a boolean takes.

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

### Ring containment needs an area guard

`ringsToSpecs` classifies outer-vs-hole by even-odd containment of each ring's
interior point. That point comes from the kernel's `ringInteriorPoint`, which
steps inward from the ring's topmost vertex by a fraction of that ring's own
bbox diagonal and only verifies the result against **that** ring. On a thin
frame (a 100mm square minus a 98mm one) the step clears the 1mm wall and lands
inside the hole, so a container search without an area guard makes the two rings
each other's container, gives both odd depth, and drops the whole result
silently. Containment implies strictly greater area for the non-overlapping
rings a boolean returns, so only larger rings are considered. Pinned by the
thin-frame tests in `convert.test.ts` and `shape-modes.test.ts`.

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
