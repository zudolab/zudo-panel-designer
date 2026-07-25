# Geometry kernel

Engine-agnostic computational geometry for zpd, in **document millimetres**.

This is a **shared foundation with two consumers**, not a Path Finder
internal:

- **Path Finder ops** (#202) — Illustrator-style boolean shape modes.
- **Gerber geometry IR** (#203) — flattening the document to fabricable
  copper / solder-mask / silkscreen regions.

Neither owns it. If a type or function only makes sense for boolean _ops_ — an
op name, a panel action, a selection rule — it belongs in the Path Finder
module, not here. That separation is what lets the Gerber exporter depend on
the kernel without dragging in editor UI.

Import from `./index`, never from the individual files.

## What is here

| File          | Contents                                                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | The shared vocabulary: `KernelPoint`/`KernelCubic`/`KernelRing`/`KernelInput`, the `KernelEpsilons` tolerance regime, the `BooleanEngine`/`BooleanArrangement` adapter surface, and the document bridge (`KernelLeaf`, `KernelPathSpec`). No runtime code. |
| `geometry.ts` | Pure helpers, no boolean backend: `sampleCubicAt`, `splitCubicAt`, exact Green's-theorem `cubicSignedArea`/`ringSignedArea`, `reverseRing`, `flattenRing`, `pointInPolygon`, `ringInteriorPoint`, `KAPPA`.                                                 |
| `engine.ts`   | The only `path-bool`-coupled file: input snapping, the boolean ops, face enumeration, sliver filtering, segment intersection.                                                                                                                              |

## What is NOT here

**Stroke expansion / offsetting.** Nothing in this kernel turns a stroked
centreline into a filled outline polygon. A separate sub-issue owns that. Do
not assume `unite()` over stroked inputs approximates it — the kernel only ever
sees fill regions.

Also deliberately absent: **point rotation**. `@zpd/core`'s `rotatePoint`
already implements the identical y-down, clockwise-degrees convention. Bake
`ShapeLayer.rotation` with core's helper before building rings.

**Splitting point-touching lobes.** Two shapes meeting at exactly one corner
come back as a single non-simple ring tracing both lobes — path-bool leaves no
positional break to split on. Areas still add correctly and nothing is lost,
but a consumer that needs each lobe separately must split on repeated vertices
itself. Pinned by `engine.test.ts`.

## Things to know before touching it

### 0. Bad input fails loudly, on purpose

A non-finite coordinate, or a degenerate tolerance like `{sliverArea: NaN}`,
does not make path-bool throw — it makes it return **nothing**, which is
indistinguishable from "the boolean legitimately found no geometry". On a
fabrication tool that is the worst possible failure mode, so both are rejected
with a `RangeError` at the kernel boundary. Do not soften these into silent
fallbacks.

### 1. There is no line primitive

A straight edge is a **degenerate cubic** (`c1 === p0`, `c2 === p3`). This
matches zpd's `PathPoint` model, where a segment whose endpoints carry no
`hout`/`hin` is a straight line — so document ↔ kernel conversion is lossless
in both directions. Do not add a line case.

### 2. One tolerance regime, tuned for millimetres

`DEFAULT_MM_EPSILONS` (in `engine.ts`) is `{ snap: 1e-4, sliverArea: 1e-6,
point: 1e-6 }` — mm and mm². pgen's Pathfinder used `{1e-4, 1e-3, 1e-6}` in
composition _pixels_, so every value here was re-derived from a fabrication or
backend fact instead of carried over; `sliverArea` moved as a result, while
`snap` and `point` happen to land on the same numerals by independent
derivation. The full per-value rationale (minimum fabricable feature, layer
registration tolerance, path-bool's unit-blind internal epsilon, float64
headroom at panel scale) is documented on the constant and pinned by
`engine.test.ts`. The downstream consumer is a PCB fabricator, so getting these
wrong silently drops or merges real artwork — change them only with a
fabrication reason, and update the tests that pin both ends of the window.

The regime is applied in two places, both inside `engine.ts`: inputs are
snapped to the `snap` grid **before** the op, and result rings below
`sliverArea` are dropped **after** it. Never layer a second set of tolerances
on top of path-bool's own comparisons.

The snap grid is not optional polish. With `snap: 0`, two rectangles offset by
1e-5 mm make path-bool fail inside its own arrangement code — `engine.test.ts`
demonstrates exactly that.

### 3. `faces()` indices are ours, not path-bool's

Sliver filtering removes faces, which renumbers the array `faces()` returns
while path-bool keeps counting the dropped ones. `buildShape()` therefore
translates each index back before calling through. If you refactor either
method, keep them consistent — the failure mode is `buildShape()` silently
returning a _different, valid-looking_ region, which no type checker catches.

## Backend

`path-bool` v1.0.0 (MIT, Adam Platkevič) — the standalone port of Graphite's
boolean kernel (planar arrangement + major/minor dual-graph decomposition). Not
clipper-lib, not paper.js.

It is loaded **lazily** via `import('path-bool')` inside `createBooleanEngine`,
so it lands in its own Vite chunk rather than the eager first-paint bundle.
Keep it that way: a top-level value import or re-export from `path-bool` in
**any** kernel file undoes it. `engine.test.ts` checks every kernel module for
one (comments stripped first, and with a negative control so a green run means
"none found" rather than "the regex matched nothing").

It deliberately does **not** live in `@zpd/core`, which has zero dependencies by
design so it stays testable in plain Node.

Two of path-bool's private constants (`EPS`, `NEARLY_LINEAR_EPS`) are mirrored
in `engine.ts` because the package does not export them. That duplication is
load-bearing — do not "clean it up". Re-verify both against the dist bundle on
any dependency bump.

## Provenance

Ported from
`$HOME/repos/zp/pgen/packages/pattern-gen-viewer/src/utils/pathfinder/`
(`types.ts`, `geometry.ts`, `engine.ts`), with `splitCubicAt` inlined from that
repo's `utils/bezier-split.ts`. The port drops pgen's layer-transform model
(zpd stores leaf geometry in world mm, so there is no local↔composition
normalization step) and retunes the tolerance regime from pixels to
millimetres.
