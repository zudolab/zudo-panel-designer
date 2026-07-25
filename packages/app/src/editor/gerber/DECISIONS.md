# Gerber export — locked decisions

Decision record for the Gerber export thread (epic #204, source issue #203, this
sub-issue #207). **This document is authoritative.** Where a sub-issue body, the
repository `README.md`, or the doc site disagrees with what is written here,
this document wins and the other text is stale.

Downstream sub-issues bound by this record: #209 (geometry IR), #210 (RS-274X
writer), #211 (pattern recorder), #212 (text outliner), #215 (zip + export UI).

## Binding scope steer from the requester

> "as the circuit, this does not work at all. but this is all right. just make
> our copper layer as design element. it's enough for us"

Copper is a **decorative design element, not a functional circuit.** No nets, no
pads, no DRC, no component drill data. Everything below follows from that.

---

## Decision 0 — The geometry IR contract

This is the load-bearing deliverable. #210 builds against **hand-authored
fixtures** of this contract and must never need to read #209's implementation.
The types below are the contract; #209 creates them at
`packages/app/src/editor/gerber/ir.ts` and every other sub-issue imports them.

```ts
// packages/app/src/editor/gerber/ir.ts

/**
 * A point in DOCUMENT millimetres: origin at the panel's TOP-LEFT, +x right,
 * +y DOWN. This is zpd document space (core/src/types.ts:1), NOT Gerber space.
 * The Y flip to Gerber's bottom-left/+y-up frame happens exactly once, in the
 * writer — see Decision 1.
 */
export interface IrPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A closed polygon ring, ALREADY FLATTENED to straight segments (Decision 6).
 * There are no curves in the IR — Gerber region contours interpolate linearly.
 *
 * - Implicitly closed: the last point is NOT a repeat of the first.
 * - At least 3 points.
 * - Not self-intersecting (guaranteed by the #206 kernel's arrangement).
 * - Winding per Decision 0.2.
 */
export type IrRing = readonly IrPoint[];

/** One filled area: an outer boundary plus its immediate holes. */
export interface IrRegion {
  /** Positive signed area in doc space (Decision 0.2). */
  readonly outer: IrRing;
  /**
   * Negative signed area. Each hole lies strictly inside `outer` and does not
   * intersect it or any sibling hole. Geometry nested INSIDE a hole is not a
   * hole-of-a-hole — it is promoted to its own later IrRegion (Decision 0.3).
   */
  readonly holes: readonly IrRing[];
}

export type IrLayerRole = 'copper' | 'solder-mask' | 'silkscreen' | 'outline';

export interface IrLayer {
  readonly role: IrLayerRole;
  /**
   * DECLARATIVE ONLY — copied verbatim into the file's `%TF.FilePolarity,…*%`
   * attribute (Decision 3). It NEVER causes a geometric operation. Solder mask
   * is 'negative' and its geometry is still emitted uncomplemented, exactly as
   * it arrives (Decision 3).
   */
  readonly filePolarity: 'positive' | 'negative';
  /**
   * How the writer renders `regions`. 'filled-region' → G36/G37 contours.
   * 'stroked-contour' → D02/D01 moves with the profile aperture, used only by
   * the 'outline' role (Decision 2.3).
   */
  readonly renderAs: 'filled-region' | 'stroked-contour';
  /**
   * Disjoint (Decision 0.3), ordered outer-before-contained (Decision 0.3).
   * An empty array is legal and meaningful — see Decision 4 for what an empty
   * solder-mask layer means.
   */
  readonly regions: readonly IrRegion[];
}

export interface IrPanel {
  readonly hp: number;
  /** panelWidthMm(hp) — always a PANEL_SIZES table value (Decision 8). */
  readonly widthMm: number;
  /** PANEL_HEIGHT_MM = 128.5, the Y-flip constant. */
  readonly heightMm: number;
}

export interface GerberIr {
  readonly panel: IrPanel;
  /** Exactly 4 entries, in this order: copper, solder-mask, silkscreen, outline. */
  readonly layers: readonly [IrLayer, IrLayer, IrLayer, IrLayer];
}
```

### 0.1 Units and space

Millimetres, IEEE-754 double, **document space (top-left origin, +y down)**.

Rationale for keeping the IR in doc space rather than pre-flipping: it makes the
IR directly comparable against what the renderer painted (the raster round-trip
oracle in Decision 10 depends on this), and it confines all Gerber-frame
knowledge to one module. #210's acceptance test — "an asymmetric fixture proves
the Y-flip is applied, and applied once" — is only meaningful if the fixture is
*not* already flipped.

### 0.2 Winding convention

Pinned by the **sign of the shoelace signed area evaluated in document space**,
not by the words "clockwise"/"counter-clockwise" — those invert under a Y-down
axis and are a reliable source of bugs.

```
A = ½ · Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)      (indices wrap)
```

- `IrRegion.outer` — **A > 0**
- every `IrRegion.holes[i]` — **A < 0**

Checkable directly with the #206 kernel's `ringSignedArea` with no coordinate
change. Note that in a +y-down frame a positive-area ring traverses *clockwise
on screen*; that is expected, not a bug.

Useful side effect, and the reason this sign was chosen over its mirror: the Y
flip negates signed area, so **an outer ring must have negative signed area in
Gerber space**. That turns the winding sign into a second, independent Y-flip
tripwire that #210 can assert cheaply.

Gerber itself is winding-agnostic — G36 region polarity is set by `%LPD*%` /
`%LPC*%`, never by traversal direction. **The writer must NOT re-wind rings**;
it emits vertices in IR order.

### 0.3 Region disjointness and ordering

Within one `IrLayer`:

- Regions are **pairwise disjoint** — #209's union step guarantees this. The
  writer may therefore emit them as a plain painter's-algorithm stream with no
  containment analysis of its own.
- The single exception is containment: a region lying inside another region's
  hole (an island) is its own `IrRegion` and **must appear later in the array**
  than the region whose hole contains it. Gerber is an ordered image stream; an
  island emitted before the `%LPC*%` that clears its surroundings is erased.
- Deterministic order, required for byte-exact tests: sort by nesting depth
  ascending, then by outer-ring `min(y)` ascending, then `min(x)` ascending,
  then by the first vertex `(x, y)`.

Arbitrary nesting depth is expressible: outer → hole → island → island's hole →
… each odd level is a `holes` entry, each even level a new `IrRegion`.

### 0.4 How an unsupported layer is signalled

Extraction is **per-layer and asynchronous** (#212 lazy-imports `opentype.js`
and fetches font files; the #206 kernel is a lazy `import('path-bool')`).

```ts
export type IrUnsupportedReason =
  // handed off to another extractor — not an error
  | 'pattern-layer'        // #211 owns it
  | 'text-layer'           // #212 owns it
  // terminal — becomes a refusal (Decision 8)
  | 'image-layer'
  | 'unknown-pattern-id'
  | 'non-curated-font'
  | 'missing-glyph'
  | 'complexity-overrun';

export type IrLayerResult =
  | {
      readonly kind: 'regions';
      readonly layerId: string;
      readonly regions: readonly IrRegion[]; // may be empty
    }
  | {
      readonly kind: 'unsupported';
      readonly layerId: string;
      readonly layerName: string;       // for the refusal dialog (#215)
      readonly reason: IrUnsupportedReason;
      readonly detail?: string;         // e.g. the pattern id, the font family
    };

export interface LayerGeometrySource {
  readonly handles: Layer['type'];
  extract(layer: Layer, ctx: IrExtractContext): Promise<IrLayerResult>;
}
```

- #209 ships sources for `shape` and `path`, and returns
  `{ kind: 'unsupported', reason: 'pattern-layer' | 'text-layer' | 'image-layer' }`
  for the rest.
- #211 and #212 register additional `LayerGeometrySource`s. The orchestrator
  re-dispatches any `'pattern-layer'` / `'text-layer'` result to them.
- Anything still `unsupported` after every registered source has been consulted
  is a **refusal**, naming the layers (Decision 8).

**Hidden layers never reach extraction and never trigger a refusal.** After
`projectPcbLayerSlices` folds container/group `hidden` onto leaves, `hidden ===
true` means the layer is not manufactured — the identical guard every existing
manufacturing pass uses (`paintMaskPunches`, `paintInvertedPanelStack`). A
hidden image layer, or a hidden text layer in a non-curated font, must **not**
block the export.

### 0.5 What the IR deliberately does not carry

No apertures, no nets, no pads, no drill data, no per-object colour, no layer
names, no Gerber syntax. Aperture choice, attribute strings, number formatting
and the Y flip are all writer concerns.

---

## Decision 1 — Coordinate system and the Y-axis flip (FABRICATION-CRITICAL)

zpd document space is **top-left origin, +y down** (`core/src/types.ts:1`).
Gerber is a **top view of the board, +x right, +y up**, origin at the panel's
bottom-left.

```
gerberX = docX
gerberY = PANEL_HEIGHT_MM − docY      // PANEL_HEIGHT_MM = 128.5
```

**Applied exactly once, at one named boundary:**

```ts
// packages/app/src/editor/gerber/coordinate-frame.ts  (created by #210)
export function toGerberPoint(p: IrPoint, panelHeightMm: number): IrPoint;
```

Binding rules:

- `coordinate-frame.ts` is the **only** file in the repository permitted to
  compute `panelHeightMm - y`. It is grep-able on purpose. No extractor, no
  pattern recorder, no text outliner, no fixture may pre-flip.
- Every emitted coordinate passes through it exactly once. Omitting it mirrors
  the whole panel — text reads backwards and the boards are scrap. Applying it
  twice is exactly as wrong.
- Pinned unit test: `toGerberPoint({ x: 0, y: 0 }, 128.5)` → `{ x: 0, y: 128.5 }`,
  and `toGerberPoint({ x: 0, y: 128.5 }, 128.5)` → `{ x: 0, y: 0 }`.
- The panel occupies Gerber `x ∈ [0, panelWidthMm(hp)]`, `y ∈ [0, 128.5]`. All
  emitted coordinates are non-negative (guaranteed by the clip, Decision 7).

**No Gerber-level transforms.** All rotation, mirroring and scaling is baked
into coordinates in document space during extraction. The writer never emits
`%MI*%`, `%SF*%`, `%OF*%`, `%AS*%`, aperture-block rotation, or `LM`/`LR`/`LS`
object transforms. `ShapeLayer.rotation` / `TextLayer.rotation` / `ImageLayer.
rotation` are documented as *degrees clockwise around the bbox centre in y-down
space*; after the flip that reads as counter-clockwise, which is automatic and
correct because the rotation was baked before the flip. Anyone "helpfully"
adding a Gerber-level rotation would double-transform.

---

## Decision 2 — Fileset scope: artwork + outline only

### 2.1 Files

| File | Content | X2 `TF.FileFunction` |
|---|---|---|
| `.GTL` | Top copper | `Copper,L1,Top` |
| `.GTS` | Top solder mask | `Soldermask,Top` |
| `.GTO` | Top silkscreen / legend | `Legend,Top` |
| `.GKO` | Board outline (profile) | `Profile,NP` |

**No Excellon drill file. No mounting-hole geometry. No bottom-side files. No
paste layer.** The document model carries zero hole/drill data and zero
bottom-side content, and the requester's steer puts electrical and mechanical
completeness out of scope.

All four files are **always written**, even when empty. Omitting a file is
another ambiguity a fab has to guess at; an empty-but-present file with a
correct `TF.FileFunction` is unambiguous. (Read Decision 4 before concluding
that an empty `.GTS` is harmless — it is meaningful, not neutral.)

### 2.2 Filenames

Matching `download.ts`'s existing `zpd-panel-${doc.panelHp}hp.json`:

```
zpd-panel-<hp>hp-gerber.zip
├── zpd-panel-<hp>hp.GTL
├── zpd-panel-<hp>hp.GTS
├── zpd-panel-<hp>hp.GTO
├── zpd-panel-<hp>hp.GKO
└── README.txt
```

### 2.3 The outline layer is a contour, not a fill

`.GKO` carries the panel rectangle as a **stroked closed contour** (`renderAs:
'stroked-contour'`), drawn with the profile aperture, not as a G36 region. A
filled region on a profile layer is ambiguous about which side of the boundary
is board; the profile is a cut path and must read as one.

### 2.4 The limitation is surfaced in the app, not only in the zip

Binding on #215. The export UI states, **before the download happens**:

> This export contains artwork only — copper, solder mask, silkscreen, and the
> board outline. It contains no drill file and no mounting-hole geometry. It is
> artwork for an already-specified Takazudo blank panel, not a standalone
> orderable board.

The same text goes in `README.txt` inside the zip *as well*, but the in-app
statement is the real protection: fabs routinely ignore instructions bundled in
a zip, and nobody reads a README before uploading to an automated quoting form.

The file itself also carries it, so it survives being separated from both the
zip and the UI — see `TF.Part` in Decision 3.2.

---

## Decision 3 — X2 file attributes and number format

### 3.1 Per-file attributes (exact strings)

```
Copper       %TF.FileFunction,Copper,L1,Top*%
             %TF.FilePolarity,Positive*%
Solder mask  %TF.FileFunction,Soldermask,Top*%
             %TF.FilePolarity,Negative*%
Silkscreen   %TF.FileFunction,Legend,Top*%
             %TF.FilePolarity,Positive*%
Outline      %TF.FileFunction,Profile,NP*%
```

### 3.2 Solder-mask polarity — verified against the code, not the docs

I read the source rather than the prose, as instructed. The code is
unambiguous:

- `packages/core/src/palette.ts:1-3` — "black routes to the solder-mask
  container, where it **OPENS the mask** (reveals copper, or bare substrate,
  beneath) rather than painting mask on".
- `packages/core/src/palette.ts:17` — `note: 'solder-mask opening (reveals
  copper beneath)'`.
- `packages/app/src/editor/mask-sheet.ts:2-3` — "a visible mask leaf **carves an
  opening** instead of painting positive black".
- `packages/app/src/editor/mask-sheet.ts:38` — the punch is literally
  `ctx.globalCompositeOperation = 'destination-out'`.
- `packages/app/src/editor/renderer.ts:683-687` — the sheet is filled solid with
  `PALETTE[0].hex` and then punched.

`README.md:45-46` says "Solder-mask artwork is positive coverage; omitted areas
and even-odd path holes reveal copper beneath it." **That prose is stale and
inverted.** It is corrected in #216. Do not implement from it.

The resulting rule, which is the single easiest thing to get half-right:

> **Mask geometry passes through UNCOMPLEMENTED — and the file still declares
> `%TF.FilePolarity,Negative*%`.**

"No geometric inversion" is not the same as "positive file". Ucamco defines a
negative solder-mask file as *image = absence of mask material*, which is
exactly what a zpd mask leaf already means. Declaring `Positive` here inverts
the physical board just as badly as complementing the geometry would; doing
both would cancel out and accidentally work, which is worse still because
nobody would find it.

### 3.3 Global attributes

```
%TF.GenerationSoftware,zudolab,zudo-panel-designer,<pkgVersion>*%
%TF.CreationDate,<ISO-8601 with timezone>*%
%TF.Part,Other,Decorative front panel artwork - no drill data*%
%TF.SameCoordinates*%
```

- `TF.Part,Other,…` puts the artwork-only limitation **inside every file**, so
  it survives the file being separated from both the zip's `README.txt` and the
  app's export UI. This is an addition beyond what #207's body listed, for the
  same reason #207 insisted the limitation appear in the UI.
- `TF.CreationDate` is **an explicit parameter of the pure emitter**, never read
  from `Date.now()` inside it. `download.ts` splits pure `panelConfigJson` from
  DOM `downloadPanelConfig` precisely so the exact output string is assertable;
  an ambient timestamp would destroy that for the Gerber writer. Tests inject a
  fixed date.
- `TF.SameCoordinates` asserts all four files share one origin — one line, and
  the direct guard against a per-file origin mistake. If the independent
  validator of Decision 10 rejects the no-identifier form, drop the attribute
  and record the deviation in a code comment; do not invent an identifier.

### 3.4 Number format

```
%FSLAX46Y46*%   leading zeros omitted, absolute, 4 integer + 6 decimal digits
%MOMM*%         millimetres
```

Quantum = 1e-6 mm (1 nm); range to 9999.999999 mm. Ample for a 128.5 mm panel
and three orders of magnitude finer than the 5 µm flattening tolerance.

- Conversion: `Math.round(mm * 1e6)`. All coordinates are non-negative after
  clipping (Decision 7), so `Math.round`'s asymmetric half-up behaviour on
  negatives never applies.
- **Both X and Y are emitted on every operation.** No modal coordinate
  omission. It costs bytes and buys determinism and byte-exact tests.
- Line terminator is **LF (`\n`)**, not CRLF. Deterministic across platforms.
- ASCII only. No non-ASCII in `G04` comments (layer names may contain anything —
  do not echo user text into comments).

### 3.5 Body structure

```
G04 <comment>*
%FSLAX46Y46*%
%MOMM*%
%TF...*%              (the attributes above)
%ADD10C,0.010*%
D10*
G01*
%LPD*%
  … regions …
M02*
```

- `%ADD10C,0.010*%` + `D10*` define and select a dummy 10 µm round aperture.
  Region mode ignores the current aperture, but some parsers reject a file that
  never defines one, and the profile contour (Decision 2.3) genuinely needs it.
- `G01*` sets linear interpolation once. Region contours are straight segments
  only — no `G02`/`G03`, no `G75`. Curves were already flattened (Decision 6).
- Filled region, per `IrRegion`:
  ```
  G36*
  X…Y…D02*            move to outer[0]
  X…Y…D01*            outer[1] … outer[n-1]
  X…Y…D01*            explicit closing segment back to outer[0]
  G37*
  %LPC*%              per hole
  G36* … G37*
  %LPD*%              restore after each hole
  ```
  The closing segment is emitted explicitly even though the spec auto-closes a
  region: the IR ring is *implicitly* closed, and making the closure explicit
  removes any chance of the two conventions disagreeing.
- Stroked contour (`.GKO`): `X…Y…D02*` then `X…Y…D01*` per vertex, plus the
  explicit closing `D01*`.
- `M02*` terminates. Nothing after it.

---

## Decision 4 — Hidden solder-mask container (FABRICATION-CRITICAL)

`renderer.ts:669` defines the semantics:

```
// Hidden mask container ⇒ NO sheet: bare copper on substrate (epic pin 4).
// An empty visible container still composites the full black sheet.
```

Two states that look similar in the document and mean **opposite** things on
the board:

| `slices.solderMaskHidden` | Leaves | Board | `.GTS` (negative polarity) |
|---|---|---|---|
| `true` | any | **no mask anywhere** | **one full-panel opening region** |
| `false` | none | full mask coverage | **empty (zero regions)** |
| `false` | some | mask with openings | those openings, uncomplemented |

**Decision: emit a full-panel opening rectangle when the mask container is
hidden.** Not a warning, not a refusal.

- A warning is unsafe and is explicitly rejected — an export that produces a
  plausible-looking file plus a dismissible warning is how boards get scrapped.
- A refusal was the other candidate, and I rejected it: "bare copper on
  substrate, no mask" is a **legitimate, deliberately supported design** in this
  editor (epic #176 pin 4), and it is exactly expressible in Gerber. Refusing an
  expressible, intentional design would be a defect, not a safeguard.
- Doing nothing is the actively wrong option: an empty `.GTS` conventionally
  means *full* mask coverage — the precise inverse of what a hidden container
  means. The bug this decision exists to prevent is "hidden container → emit
  nothing → fab covers the whole panel in mask".

The full-panel opening region is the **clipped board outline**: the rectangle
`(0,0)–(panelWidthMm(hp), 128.5)` in doc space, subject to the same clip as
everything else (Decision 7).

Accepted tradeoff, stated explicitly: mask registration tolerance means a
mask-opening that stops exactly at the profile can leave a hairline of mask at
the very panel edge, where a bleed would not. Accepted, because the panel edge
is routed away, the artwork is decorative, and a bleed would be the only piece
of geometry in the entire export that violates Decision 7's single clip rule.

This table is a required test matrix for #209/#210 — all three rows.

---

## Decision 5 — Stroke expansion: implement a real stroker (option (a))

The #206 kernel provides boolean ops but **no offsetting**: pgen's `Outline` op
splits edges and re-emits them *stroked* (`outline-op.ts:8`, `:254-255` set
`fill.enabled: false`, `stroke.enabled: true`). Gerber has no stroked-path
primitive for arbitrary artwork.

**Chosen: (a) — a real stroker producing filled regions.** Round/butt/square
caps, round/miter joins, miter limit.

Option (b) — constrain to Gerber circular apertures and refuse anything else —
was rejected on evidence: `PathLayer` has no cap/join field, but the 68 pattern
generators set `lineCap` and `lineJoin` 19 times each, including `butt`,
`square` and `miter`, none of which a circular aperture can express. Patterns
are the bulk of the reference panel design, so (b) would refuse the primary use
case. (b) is not a smaller amount of work either — it is the same work plus a
refusal path.

Pinned parameters:

- **`PathLayer` strokes use the Canvas2D defaults: `butt` cap, `miter` join,
  miter limit 10.** Derived from the code, not assumed: `paintLayer` sets only
  `strokeStyle` and `lineWidth` (`renderer.ts:432-435`) and wraps every layer in
  `ctx.save()`/`ctx.restore()` (`:354`, `:473`), so no other layer's cap/join
  can leak in and the context is at its documented defaults.
- **Pattern strokes use whatever the generator set at `stroke()` time** — the
  recorder captures style at call time, not at assignment time (#211).
- Stroker output is **cubic rings** in the kernel's `EngineRing` form, with
  round caps and round joins as KAPPA arcs. It feeds the boolean pipeline, so it
  must not be pre-flattened.
- **Expansion happens before clipping**, and before the union.
- `strokeWidth <= 0` or a non-finite width contributes no geometry (matching
  `renderer.ts:432`'s `layer.strokeWidth > 0` guard). Not a refusal.
- A zero-length subpath with a `round` or `square` cap paints a dot/square in
  Canvas; with `butt` it paints nothing. Reproduce that.

Pipeline order, fixed:

```
extract (cubics, doc mm)
  → bake rotation
  → stroke-expand (cubics)
  → union per material (kernel)
  → clip to profile (kernel)
  → adaptive flatten (Decision 6)
  → IR polygons
```

Flattening is **last**, after all boolean work, so precision is not spent twice
and the kernel's exact `cubicSignedArea` still applies to the real curves.

---

## Decision 6 — Coordinate format and flattening tolerance

Format: `%FSLAX46Y46*%` + `%MOMM*%` (Decision 3.4).

**Adaptive flattening, max chord deviation ≤ 5 µm (0.005 mm).**

- `core/src/path-geometry.ts:54`'s `DEFAULT_FLATTEN_SEGMENTS = 24` is a fixed
  segment count per cubic *regardless of arc length*. Correct for hit-testing;
  wrong for fabrication — it over-samples a 0.1 mm curve and under-samples a
  120 mm one by the same factor. **#209 writes its own adaptive flattener and
  does not reuse it.** The core constant stays untouched; hit-testing is fine.
- 5 µm is ~0.004% of the panel height and roughly an order of magnitude below
  any fab's minimum feature size, while staying 5000× the 1 nm coordinate
  quantum so the tolerance is never lost to rounding.
- Recursion bound: **24 subdivision levels**, and a minimum emitted segment
  length of **1 µm**. Degenerate/cusped cubics must terminate rather than
  subdivide forever.
- Subdivision criterion: recursive flatness test against the control polygon
  (standard de Casteljau flatness), not uniform-`t` sampling — uniform `t` does
  not bound chord error on a cubic with unevenly distributed control points.
- Consecutive vertices closer than 1 µm are collapsed; a ring left with fewer
  than 3 vertices is dropped.
- Test (from #209's acceptance): max chord deviation ≤ 5 µm on a
  high-curvature fixture, measured against the analytic curve.

---

## Decision 7 — Clip everything to the board outline

**Yes, clip.** All of copper, solder mask and silkscreen are intersected with
the panel rectangle `(0,0)–(panelWidthMm(hp), 128.5)` in doc space. The
`outline` layer *is* the clip boundary and is not clipped.

`renderer.ts:43-45` ghosts out-of-panel content at `OUTSIDE_GHOST_ALPHA = 0.35`
with the comment "the area beyond the panel edge is physically cut off in
fabrication, so dimming encodes *this will not be manufactured*". The editor
makes a promise to the user; exporting that content unclipped breaks it. A user
who parked a scratch shape off-panel would find it in the fab data.

Clipping also guarantees every emitted coordinate is non-negative and within
the `FSLAX46` range, which Decision 3.4's rounding rule relies on.

The clip is a real boolean intersection via the #206 kernel, not a bbox reject —
a shape straddling the edge must be cut, not dropped and not kept whole.

---

## Decision 8 — Refusal conditions (hard)

A refusal **aborts the export**. No file is produced. #215 surfaces it as a
dialog naming the offending layers — never a console warning, never a silent
skip. Fabrication output is not a place for a plausible-looking wrong file.

```ts
export type GerberRefusalCode =
  | 'unlisted-panel-hp'
  | 'image-layer-present'
  | 'non-curated-font'
  | 'missing-glyph'
  | 'unknown-pattern-id'
  | 'complexity-overrun';

export interface GerberRefusal {
  readonly code: GerberRefusalCode;
  readonly message: string;
  /** Empty for document-level refusals such as 'unlisted-panel-hp'. */
  readonly layers: readonly { readonly id: string; readonly name: string }[];
}
```

All refusals are collected and reported **together** — a user with three
untraced images and one bad font should see one dialog, not four sequential
ones.

| Code | Trigger | Why |
|---|---|---|
| `unlisted-panel-hp` | `doc.panelHp` has no `PANEL_SIZES` entry | `panelWidthMm` falls back to `hp * 5.08`, self-documented (`panel-sizes.ts:31-35`) as "an approximation, not an order-ready dimension". `serialize.ts:130-133` accepts any positive HP ≤ 20, so 7, 9 and 13.5 all reach the exporter. |
| `image-layer-present` | any **visible** `image` layer | `types.ts:73` — "Design-time source only — a raster cannot be manufactured on the panel." Every manufacturing pass already skips it. Skipping silently means artwork the user can see is missing from the board. |
| `non-curated-font` | a **visible** text layer whose `fontFamily` is outside the 10 curated `@fontsource` families (`fonts.ts` `CURATED_FONTS`) | A runtime Google font (1,942 possible) has no local file to outline, and canvas may have silently substituted a fallback face that `opentype.js` cannot detect. |
| `missing-glyph` | a codepoint absent from the resolved `@fontsource` subset | A silently dropped character on silkscreen is a wrong physical board. |
| `unknown-pattern-id` | `patternByName(layer.patternType)` returns undefined | `PatternLayer.patternType` is deliberately opaque data preserved even when unrecognised (`types.ts:31-32`). The renderer draws nothing; the export must not silently drop it. |
| `complexity-overrun` | see below | |

**Hidden layers never trigger any of these** (Decision 0.4).

### Complexity ceiling — refuse, do not offload to a worker

`core/src/pattern-geometry.ts:15-22` sets `MAX_PATTERN_SIZE_MM = 1000` (~8× the
largest panel dimension) as an explicit DoS guard, noting generators "run JS
loops across the whole draw span (the canvas clip bounds pixels, not loop
work)". At that size with dense parameters a generator emits hundreds of
thousands of primitives, and a main-thread boolean union over them hangs the
tab.

Pinned ceilings:

- **20,000 rings per material layer** entering the boolean union.
- **2,000,000 total flattened vertices** across the assembled IR.

Both are far beyond any legitimate panel design — a 128.5 mm pattern square at a
0.1 mm pitch is ~1,285 stroked lines, more than an order of magnitude under the
ring ceiling — and well short of what hangs the tab.

**The ring ceiling is checked incrementally, DURING recording, and aborts the
generator mid-draw.** Checking after recording is useless: it is the union, not
the recording, that hangs, but a pathological generator can also hang inside its
own loop before the union is ever reached.

**Rejected: worker offload.** It requires moving `path-bool`, the stroker, the
pattern recorder and an `OffscreenCanvas` render path across a thread boundary,
for a rare, explicit, user-initiated action, to make a design succeed that is
too dense to manufacture anyway. A clear refusal naming the offending layer is
honest and costs nothing. This is a departure from #207's body only in that it
picks one of the two options it offered, which is what this document is for.

---

## Decision 9 — Normalisation parity with the renderer

Negative-dimension shapes must export exactly as they were drawn on screen.

**Apply `normalizeRect` (`core/src/bbox.ts:25-32`) to every `ShapeLayer` before
extraction.** This reproduces both renderer branches:

- rect (`renderer.ts:371`): `ctx.rect(x, y, w, h)` with a negative `w`/`h` draws
  the mirrored rect, which is `normalizeRect`'s output.
- ellipse (`renderer.ts:376-384`): the renderer already normalises by hand —
  centre `x + w/2, y + h/2`, radii `Math.abs(w)/2, Math.abs(h)/2` — with an
  explicit comment that `ctx.ellipse` throws `IndexSizeError` on a negative
  radius.

The rotation pivot is unaffected: `paintLayer` pivots on
`bbox.x + bbox.width / 2, bbox.y + bbox.height / 2` from the **raw** bbox
(`renderer.ts:357-360`), and that centre is invariant under `normalizeRect`.
Normalise first, then rotate about the centre — the two orders agree.

**Text rotation is the exception and must NOT be recomputed.** #212 calls
`getTextGeometry(layer).pivot`. That pivot is cached and font-load-dependent by
design (`text-geometry.ts:1-3`) so a layer does not visibly jump when a font
resolves; recomputing it lands rotated text somewhere other than where the user
saw it. Read layers through `projectPcbLayerSlices` / `projectFlatLayers` so the
exporter gets the same array instance the editor uses — a freshly-projected
array bumps the document incarnation and can invalidate cached pivots mid-
session.

Ellipses are extracted as 4 KAPPA cubics (the kernel exports `KAPPA`), matching
`ctx.ellipse`'s own approximation to well within Decision 6's tolerance.

---

## Decision 10 — Validation oracle

A self-written parser is useful for fast unit tests but **insufficient as the
only oracle**: it inherits the writer's own misconceptions, so a consistent
misunderstanding of region polarity passes both directions. Three independent
checks, all required:

1. **A third-party Gerber parser, in CI.** Added as a `devDependency` of
   `packages/app` — `@tracespace/parser` or `gerber-parser`; the implementer
   picks whichever installs and parses cleanly. The binding requirement is only
   that **we did not write it**. It re-parses every emitted file and asserts the
   coordinate stream, format spec, and region/polarity structure. It also
   arbitrates Decision 3.3's `TF.SameCoordinates` question.
2. **Raster round-trip diff, in CI.** Render the IR to a canvas and diff it
   against `preview/surface-maps.ts` / `paintInvertedPanelStack` output for the
   same document. This is the only oracle that catches *semantic* errors a
   syntax parser cannot see — a dropped layer, a mirrored panel, an inverted
   mask. It works precisely because the IR is in document space (Decision 0.1),
   so no flip has to be undone to compare.
3. **A human look through an independent viewer, once, in #216.** Open the
   produced zip in `gerbv` or Ucamco's free reference viewer and confirm the
   panel is not mirrored, on an **asymmetric** design with legible text. A
   vertically symmetric fixture cannot catch a mirror and is worthless for this.

Plus the two structural tests already required by the sub-issues, restated here
because they are the two failures that scrap boards:

- **An asymmetric fixture proves the Y-flip is applied, and applied once**
  (#210). Assert both the flipped coordinates and the signed-area sign inversion
  from Decision 0.2.
- **The Decision 4 mask matrix, all three rows.**

---

## Summary — one line each

0. **IR contract**: flattened polygon rings in document mm (y-down), `IrRegion
   {outer, holes}` grouped into 4 ordered `IrLayer`s, outer rings positive
   signed area, disjoint and outer-before-contained, unsupported layers signalled
   by a typed `IrLayerResult` discriminated union.
1. **Y flip**: `gerberY = 128.5 − docY`, applied once in
   `gerber/coordinate-frame.ts` and nowhere else; no Gerber-level transforms.
2. **Fileset**: `.GTL`/`.GTS`/`.GTO`/`.GKO` only, always written, no drill data;
   the artwork-only limitation appears in the export UI before download.
3. **Attributes**: exact X2 strings as listed; solder mask is uncomplemented
   geometry in a `Negative`-polarity file; creation date is injected, not
   ambient.
4. **Hidden mask container**: emit a full-panel opening rectangle — an empty
   `.GTS` would mean the opposite (full coverage).
5. **Stroker**: implement a real one (round/butt/square caps, round/miter joins,
   miter limit 10); apertures cannot express what the pattern generators use.
6. **Format/tolerance**: `%FSLAX46Y46*%` + `%MOMM*%`, adaptive flattening at
   ≤5 µm chord error, flattened last after all boolean work.
7. **Clipping**: real boolean intersection with the board outline, honouring the
   editor's 0.35-alpha "this will not be manufactured" promise.
8. **Refusals**: unlisted HP, visible image layer, non-curated font, missing
   glyph, unknown pattern id, complexity overrun (20,000 rings/layer,
   2,000,000 vertices total) — refuse, do not offload to a worker; hidden layers
   never trigger a refusal.
9. **Normalisation**: `normalizeRect` before extraction; never recompute the
   cached text pivot.
10. **Oracles**: third-party parser in CI + raster round-trip diff in CI + one
    human check in an independent viewer on an asymmetric design.
