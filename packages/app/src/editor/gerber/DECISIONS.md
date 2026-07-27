# Gerber export — locked decisions

Decision record for the Gerber export thread (epic #204, source issue #203, this
sub-issue #207). **This document is authoritative.** Where a sub-issue body, the
repository `README.md`, or the doc site disagrees with what is written here,
this document wins and the other text is stale.

Downstream sub-issues bound by this record: #209 (geometry IR), #210 (RS-274X
writer), #211 (pattern recorder), #212 (text outliner), #215 (zip + export UI).

**Revised by the material-holes epic #226, sub #231.** The export grew from
artwork-only to fabrication output: per-material file sets, back-side files,
and Excellon drill data for the panel screw holes. Decisions 0, 1, 2, 3 and 4
are revised in place; Decisions 11–13 are new. Additionally bound: #235
(Excellon drill + hole/ring injection — fills `holes.ts`), #236 (back-side
extraction + packaging — fills `back-extract.ts`).

## Binding scope steer from the requester

> "as the circuit, this does not work at all. but this is all right. just make
> our copper layer as design element. it's enough for us"

Copper is a **decorative design element, not a functional circuit.** No nets, no
pads, no DRC, no component drill data. Everything below follows from that.

The #231 revision does not loosen the steer: the drill files carry ONLY the
panel template's own screw holes (Decision 11), never component holes, and the
copper — front or back — is still artwork, not nets.

---

## Decision 0 — The geometry IR contract

This is the load-bearing deliverable. #210 builds against **hand-authored
fixtures** of this contract and must never need to read #209's implementation.
The types below are the contract; #209 creates them at
`packages/app/src/editor/gerber/ir.ts` and every other sub-issue imports them.

The #231 revision extends the same contract with back-side roles, a
per-material layer list, and the Excellon drill IR that #235 and #236 fill in
parallel — neither may need to change a shape here. If a downstream sub-issue
must change one of these shapes to do its job, #231 failed.

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

/**
 * Front roles, back roles (`b-` prefix), and the profile. Back-role geometry
 * is ALREADY X-mirrored into canonical fabrication coordinates (front view,
 * doc space) when it reaches an `IrLayer` — the mirror happens exactly once,
 * at the build-IR boundary, never in the writer (Decision 13).
 */
export type IrLayerRole =
  | 'copper'
  | 'solder-mask'
  | 'silkscreen'
  | 'b-copper'
  | 'b-solder-mask'
  | 'b-silkscreen'
  | 'outline';

export type BackLayerRole = Extract<IrLayerRole, `b-${string}`>;

export interface IrLayer {
  readonly role: IrLayerRole;
  /**
   * DECLARATIVE ONLY — copied verbatim into the file's `%TF.FilePolarity,…*%`
   * attribute (Decision 3). It NEVER causes a geometric operation. Solder mask
   * is 'negative' and its geometry is still emitted uncomplemented, exactly as
   * it arrives (Decision 3).
   *
   * `null` means the attribute is NOT emitted for this file. The 'outline'
   * role is `null`: file polarity is not meaningful for a Profile, and
   * emitting it there would be an extra, unasked-for attribute that breaks
   * #210's byte-exact fixtures. The field is required-but-nullable rather than
   * optional so a fixture author must make the choice explicitly.
   */
  readonly filePolarity: 'positive' | 'negative' | null;
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
  readonly format: PanelFormat;
  readonly hp: number;
  /** panelWidthMm(hp) — always a PANEL_SIZES table value (Decision 8). */
  readonly widthMm: number;
  /** panelHeightMm(format) — the Y-flip constant (39.65 for 1U, 128.5 for 3U). */
  readonly heightMm: number;
}

/**
 * Declarative role metadata, pinned by Decision 3.1's attribute table. Every
 * builder of an `IrLayer` (build-ir, #235's injections, #236's back
 * extraction, fixtures) reads the value from here so the table has one owner.
 */
export const ROLE_FILE_POLARITY: Record<IrLayerRole, IrLayer['filePolarity']>;

/**
 * Which back files a material ships (Decision 12): FR-4 has a real editable
 * back; alumi is a B.Mask carrying only the screw-hole openings.
 */
export const MATERIAL_BACK_ROLES: Record<PcbMaterial, readonly BackLayerRole[]>;
// fr4:   ['b-copper', 'b-solder-mask', 'b-silkscreen']
// alumi: ['b-solder-mask']

/**
 * The exact `GerberIr.layers` role list per material, in emission order:
 * front, back, outline. The zip manifest follows it entry for entry.
 */
export const MATERIAL_LAYER_ROLES: Record<PcbMaterial, readonly IrLayerRole[]>;
// fr4:   ['copper', 'solder-mask', 'silkscreen',
//         'b-copper', 'b-solder-mask', 'b-silkscreen', 'outline']
// alumi: ['copper', 'solder-mask', 'silkscreen', 'b-solder-mask', 'outline']

export interface GerberIr {
  readonly material: PcbMaterial;
  readonly panel: IrPanel;
  /** One entry per MATERIAL_LAYER_ROLES[material], in that order. */
  readonly layers: readonly IrLayer[];
  /** Both drill files, always — one side is empty per material (Decision 11). */
  readonly drill: DrillIr;
}

// ─── Excellon drill IR (Decision 11) — same DOCUMENT-space mm as above ──────

/** Per-FILE split in Excellon: two files, two headers — never a per-hit flag. */
export type DrillPlating = 'pth' | 'npth';

export interface DrillTool {
  /** Excellon tool number: `T<code>` in the tool table and the body. 1-based. */
  readonly code: number;
  /** Drill diameter in mm — the `C` parameter, e.g. `T1C3.200`. */
  readonly diameterMm: number;
}

/** One round hole: a plain `X…Y…` stroke of the selected tool. */
export interface DrillHit {
  /** References DrillTool.code within the same file. */
  readonly tool: number;
  /** Hole centre, doc space mm. */
  readonly x: number;
  readonly y: number;
}

/**
 * One routed slot (`G00` start, `M15` plunge, `G01` end, `M16` retract — the
 * ordered reference sets' exact idiom). `start`/`end` are the endpoint
 * CENTRES of the routed span: `slotLength − drillDiameter` long, NOT the
 * finished overall stadium length (panel-templates.ts).
 */
export interface DrillSlot {
  readonly tool: number;
  readonly start: IrPoint;
  readonly end: IrPoint;
}

export interface DrillFileIr {
  readonly plating: DrillPlating;
  /** Tool table in `code` order. Empty ⇒ the file is emitted header-only. */
  readonly tools: readonly DrillTool[];
  readonly hits: readonly DrillHit[];
  readonly slots: readonly DrillSlot[];
}

/** Both files, always present; the empty side is emitted header-only. */
export interface DrillIr {
  readonly pth: DrillFileIr;
  readonly npth: DrillFileIr;
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

No apertures, no nets, no pads, no component drill data (the `DrillIr` pair
carries only the panel screw holes, Decision 11), no per-object colour, no
layer names, no Gerber syntax. Aperture choice, attribute strings, number
formatting and the Y flip are all writer concerns.

---

## Decision 1 — Coordinate system and the Y-axis flip (FABRICATION-CRITICAL)

zpd document space is **top-left origin, +y down** (`core/src/types.ts:1`).
Gerber is a **top view of the board, +x right, +y up**, origin at the panel's
bottom-left.

```
gerberX = docX
gerberY = panelHeightMm(format) − docY      // 39.65 for 1U, 128.5 for 3U
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
- The panel occupies Gerber `x ∈ [0, panelWidthMm(hp)]`,
  `y ∈ [0, panelHeightMm(format)]`. All emitted coordinates are non-negative
  (guaranteed by the clip, Decision 7).
- The Excellon drill writer (#235) flips through the SAME
  `coordinate-frame.ts` boundary — drill IR coordinates are document-space mm
  like every other IR coordinate, and `holes.ts` never computes the flip
  itself.
- The back-side X mirror (Decision 13) is a DIFFERENT, build-IR-side
  transform. It does not change this rule: back layers reach the writer
  already in front-view doc space and get the same single Y flip as front
  layers.

**No Gerber-level transforms.** All rotation, mirroring and scaling is baked
into coordinates in document space during extraction. The writer never emits
`%MI*%`, `%SF*%`, `%OF*%`, `%AS*%`, aperture-block rotation, or `LM`/`LR`/`LS`
object transforms. `ShapeLayer.rotation` / `TextLayer.rotation` / `ImageLayer.
rotation` are documented as *degrees clockwise around the bbox centre in y-down
space*; after the flip that reads as counter-clockwise, which is automatic and
correct because the rotation was baked before the flip. Anyone "helpfully"
adding a Gerber-level rotation would double-transform.

---

## Decision 2 — Fileset scope: per-material fabrication set

(Revised by #231. The original decision was "artwork + outline only, no drill
data, no bottom side"; the material-holes epic #226 retired that scope.)

### 2.1 Files

| File | Content | X2 `TF.FileFunction` | FR-4 | alumi |
|---|---|---|---|---|
| `.GTL` | Top copper | `Copper,L1,Top` | yes | yes |
| `.GTS` | Top solder mask | `Soldermask,Top` | yes | yes |
| `.GTO` | Top silkscreen / legend | `Legend,Top` | yes | yes |
| `.GBL` | Bottom copper | `Copper,L2,Bot` | yes | — |
| `.GBS` | Bottom solder mask | `Soldermask,Bot` | yes | yes* |
| `.GBO` | Bottom silkscreen / legend | `Legend,Bot` | yes | — |
| `.GKO` | Board outline (profile) | `Profile,NP` | yes | yes |
| `-PTH.drl` | Plated screw-hole drill | `Plated,1,2,PTH` (Excellon, Decision 11) | content | empty |
| `-NPTH.drl` | Non-plated screw-hole drill | `NonPlated,1,2,NPTH` (Excellon, Decision 11) | empty | content |

\* alumi's `.GBS` carries the screw-hole openings ONLY (Decision 12).

The Gerber layer files follow `MATERIAL_LAYER_ROLES[material]` entry for
entry, in its order: front, back, outline. `Copper,L1,Top` / `Copper,L2,Bot`
together declare the two-layer stackup — the layer numbers ARE the
declaration; X2 has no separate stackup attribute at this level.

Still out of scope: component holes, paste layers, anything electrical. The
drill pair carries only the panel template's screw holes.

Every file in the material's manifest is **always written**, even when empty.
Omitting a file is another ambiguity a fab has to guess at; an empty-but-
present file with a correct `TF.FileFunction` is unambiguous. This now covers
the drill pair too: the material's unused side ships header-only (Decision
11), exactly like the ordered reference sets did. (Read Decision 4 before
concluding that an empty `.GTS` is harmless — it is meaningful, not neutral.)

### 2.2 Filenames

Inner files keep `download.ts`'s `zpd-panel-${doc.panelHp}hp` stem; the zip
filename gains format and material now that both vary (#229's shared
download-filename helper takes over the construction when it lands —
whichever side merges second reconciles):

```
zpd-panel-<format>-<hp>hp-<material>-gerber.zip   e.g. zpd-panel-3u-12hp-fr4-gerber.zip
├── zpd-panel-<hp>hp.GTL
├── zpd-panel-<hp>hp.GTS
├── zpd-panel-<hp>hp.GTO
├── zpd-panel-<hp>hp.GBL        (FR-4 only)
├── zpd-panel-<hp>hp.GBS
├── zpd-panel-<hp>hp.GBO        (FR-4 only)
├── zpd-panel-<hp>hp.GKO
├── zpd-panel-<hp>hp-PTH.drl
├── zpd-panel-<hp>hp-NPTH.drl
└── README.txt
```

### 2.3 The outline layer is a contour, not a fill

`.GKO` carries the panel rectangle as a **stroked closed contour** (`renderAs:
'stroked-contour'`), drawn with the profile aperture, not as a G36 region. A
filled region on a profile layer is ambiguous about which side of the boundary
is board; the profile is a cut path and must read as one.

### 2.4 The scope statement is surfaced in the app, not only in the zip

Binding on #215; wording revised by #231 (the artwork-only statement retired
with the drill/back-side scope change). The export UI states, **before the
download happens**:

> This export contains fabrication data for a Takazudo blank panel: copper,
> solder mask, silkscreen, the board outline, and Excellon drill files for the
> panel screw holes (FR-4 panels also carry back-side files). The copper is
> decorative artwork, not a functional circuit. Hole and back-side support is
> still landing across the material-holes epic, so drill and back-side content
> may be incomplete in this build.

The constant is `GERBER_EXPORT_SCOPE_STATEMENT` (renamed from
`GERBER_ARTWORK_ONLY_STATEMENT`; the `artwork-only-statement.ts` module
filename is deliberately kept to avoid import churn across the lazy/static
boundary). The final sentence is an honest interim caveat — the epic's closing
integration sub-issue (#238) removes it once drill and back content are real.

The same text goes in `README.txt` inside the zip *as well*, but the in-app
statement is the real protection: fabs routinely ignore instructions bundled in
a zip, and nobody reads a README before uploading to an automated quoting form.

The file itself also carries the decorative-copper caveat, so it survives being
separated from both the zip and the UI — see `TF.Part` in Decision 3.3.

---

## Decision 3 — X2 file attributes and number format

### 3.1 Per-file attributes (exact strings)

```
Copper         %TF.FileFunction,Copper,L1,Top*%
               %TF.FilePolarity,Positive*%
Solder mask    %TF.FileFunction,Soldermask,Top*%
               %TF.FilePolarity,Negative*%
Silkscreen     %TF.FileFunction,Legend,Top*%
               %TF.FilePolarity,Positive*%
B.Copper       %TF.FileFunction,Copper,L2,Bot*%
               %TF.FilePolarity,Positive*%
B.Solder mask  %TF.FileFunction,Soldermask,Bot*%
               %TF.FilePolarity,Negative*%
B.Silkscreen   %TF.FileFunction,Legend,Bot*%
               %TF.FilePolarity,Positive*%
Outline        %TF.FileFunction,Profile,NP*%
               (no TF.FilePolarity — IrLayer.filePolarity is null for 'outline')
```

`ir.ts`'s `ROLE_FILE_POLARITY` is the one code owner of this polarity table —
build-ir, #235's injections, #236's back extraction and the fixtures all read
it rather than restating the values.

The outline file emits **no** `TF.FilePolarity`. File polarity is not meaningful
for a Profile, and #209/#210 build independently, so the omission has to be
stated on both sides — in the IR type (`filePolarity: null`) and here — or one
side emits an attribute the other's fixtures do not expect.

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
%TF.Part,Other,Decorative front panel - copper is artwork not a circuit*%
%TF.SameCoordinates*%
```

- `TF.Part,Other,…` puts the decorative-copper caveat **inside every file**, so
  it survives the file being separated from both the zip's `README.txt` and the
  app's export UI. This is an addition beyond what #207's body listed, for the
  same reason #207 insisted the limitation appear in the UI. (#231 retired the
  original `…artwork - no drill data` wording — the export ships Excellon
  drill files now, but the copper is still artwork, not nets.)
- `TF.CreationDate` is **an explicit parameter of the pure emitter**, never read
  from `Date.now()` inside it. `download.ts` splits pure `panelConfigJson` from
  DOM `downloadPanelConfig` precisely so the exact output string is assertable;
  an ambient timestamp would destroy that for the Gerber writer. Tests inject a
  fixed date.
- `TF.SameCoordinates` asserts all emitted files share one origin — one line,
  and the direct guard against a per-file origin mistake. If the independent
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
`(0,0)–(panelWidthMm(hp), panelHeightMm(format))` in doc space, subject to the
same clip as everything else (Decision 7).

Accepted tradeoff, stated explicitly: mask registration tolerance means a
mask-opening that stops exactly at the profile can leave a hairline of mask at
the very panel edge, where a bleed would not. Accepted, because the panel edge
is routed away, the artwork is decorative, and a bleed would be the only piece
of geometry in the entire export that violates Decision 7's single clip rule.

This table is a required test matrix for #209/#210 — all three rows.

The same matrix governs the FR-4 **back** mask container (`b-solder-mask`,
`.GBS`) once #236 projects `doc.backLayers` through it — an empty back mask
still means full coverage, which is also why the #231 stub's zero-region back
mask is the correct physical default for an untouched back. The alumi `.GBS`
is NOT this matrix: it carries Decision 12's screw-hole openings only, and
those arrive as #235 injections, not extraction.

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
  round caps and round joins as cubic arcs subdivided per Decision 6.1 (a round
  cap on a wide stroke is an arc like any other and gets the same 2.5 µm bound).
  It feeds the boolean pipeline, so it must not be pre-flattened.
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
  → clip to the pattern square      ← pattern layers ONLY, per layer
  → union per material (kernel)
  → clip to profile (kernel)
  → adaptive flatten (Decision 6)
  → IR polygons
```

Flattening is **last**, after all boolean work, so precision is not spent twice
and the kernel's exact `cubicSignedArea` still applies to the real curves.

### 5.1 The per-pattern square clip is mandatory and is NOT the profile clip

`renderer.ts:405-411` applies `ctx.rect(0, 0, size, size); ctx.clip()`
**around** the generator call, before the panel clip — a separate clip op
composing to `panel ∩ square`. A `PatternLayer`'s square need not cover the
panel (`types.ts:24-28`: it is a positioned square since #96, and a panel HP
change deliberately leaves it un-resized), and generators routinely draw
through their square's edges.

So the profile clip alone is **not** sufficient: geometry outside the pattern
square but inside the panel is invisible in the editor and would still be
manufactured. Each pattern layer is intersected with its own
`(x, y, size, size)` square, as a real boolean intersection via the #206
kernel, **after stroke expansion** (Canvas clips the rasterised stroke, so an
expanded stroke that crosses the square edge is cut, not kept) and **before**
the material union.

Two clips, two purposes, both required: the square clip is per pattern layer;
the profile clip (Decision 7) is per material layer.

---

## Decision 6 — Coordinate format and flattening tolerance

Format: `%FSLAX46Y46*%` + `%MOMM*%` (Decision 3.4).

**Total geometric error budget: 5 µm (0.005 mm), split in two.**

| Stage | Budget |
|---|---|
| Arc → cubic approximation (Decision 6.1) | ≤ 2.5 µm |
| Cubic → polyline flattening (Decision 6.2) | ≤ 2.5 µm |

The split exists because these two errors **add**, and the second one is where
everybody looks. A 5 µm flattener downstream of an arc approximation that is
itself 17 µm off does not produce 5 µm geometry.

### 6.1 Arc → cubic approximation

Applies to **every** circular or elliptical arc in the pipeline: `ShapeLayer`
ellipses (Decision 9), the stroker's round caps and round joins (Decision 5),
and the pattern recorder's `ctx.arc` (#211 — 32 call sites).

The classic 4-cubic KAPPA circle has a peak radial error of ≈ `2.725e-4 × r`,
which is **1.7 µm at r = 6.4 mm but 17.4 µm at r = 64 mm** — a full-panel-height
ellipse blows the whole budget on its own, before the flattener runs. The
approximation error also falls as `θ⁶`, so halving the arc angle divides it by
64.

Pinned rule:

- Start at **8 cubics per full ellipse / 2 per quadrant** (45° arcs). That alone
  puts a 64 mm radius at ≈ 0.27 µm, i.e. every ellipse that fits a 128.5 mm
  panel is already inside budget at the starting value.
- Then **verify by measurement, not by formula**: evaluate each cubic at
  `t = 0.5` and compare against the true arc point at the corresponding
  parameter. While the deviation exceeds **2.5 µm**, halve the arc angle and
  re-measure. Cap at 256 segments per full ellipse. Measuring beats a
  transcribed error formula — it cannot be mistyped, and it is the assertion the
  test wants anyway.
- Exact renderer parity is impossible here in principle and that is fine:
  `ctx.ellipse`'s internal approximation is browser-defined and not specified
  anywhere. We target the **true** ellipse to within 2.5 µm; whatever the
  browser drew is within a few µm of that. The raster-parity tolerance in
  Decision 10 must accommodate this, rather than demanding pixel equality.

### 6.2 Cubic → polyline flattening, max chord deviation ≤ 2.5 µm

- `core/src/path-geometry.ts:54`'s `DEFAULT_FLATTEN_SEGMENTS = 24` is a fixed
  segment count per cubic *regardless of arc length*. Correct for hit-testing;
  wrong for fabrication — it over-samples a 0.1 mm curve and under-samples a
  120 mm one by the same factor. **#209 writes its own adaptive flattener and
  does not reuse it.** The core constant stays untouched; hit-testing is fine.
- The 5 µm total is ~0.004% of the panel height and roughly an order of
  magnitude below any fab's minimum feature size, while staying 5000× the 1 nm
  coordinate quantum so the tolerance is never lost to rounding.
- Recursion bound: **24 subdivision levels**, and a minimum emitted segment
  length of **1 µm**. Degenerate/cusped cubics must terminate rather than
  subdivide forever.
- Subdivision criterion: recursive flatness test against the control polygon
  (standard de Casteljau flatness), not uniform-`t` sampling — uniform `t` does
  not bound chord error on a cubic with unevenly distributed control points.
- Consecutive vertices closer than 1 µm are collapsed; a ring left with fewer
  than 3 vertices is dropped.
- Test (from #209's acceptance): max chord deviation ≤ 2.5 µm on a
  high-curvature fixture, measured against the analytic curve — plus an
  end-to-end assertion that an r = 64 mm ellipse lands within 5 µm of the true
  ellipse, which is the check that catches an in-budget flattener sitting on
  top of an out-of-budget arc approximation.

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

This is **not** the only clip. Pattern layers are additionally clipped to their
own square earlier in the pipeline (Decision 5.1); the profile clip does not
subsume it, because a pattern square can be smaller than the panel.

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

A build-IR seam (#236's back extraction) reports refusals through `ir.ts`'s
`RefusalSink` into the SAME collection — it runs before the refusal gate, so
back-side problems land in the one shared dialog and a seam never builds its
own `GerberRefusal[]`.

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

Ellipses are extracted as cubic arcs starting at **8 segments**, subdivided
until the measured radial error is ≤ 2.5 µm — **not** the 4-cubic KAPPA form.
The kernel exports `KAPPA` and 4 cubics is the reflex answer, but its
`2.725e-4 × r` peak error is 17 µm on a full-panel-height ellipse, over three
times the entire budget. See Decision 6.1.

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
2. **Two raster diffs, not one.** These are separate checks with separate
   coverage, and conflating them leaves the writer untested:

   - **2a — IR vs editor (validates the EXTRACTOR).** Render the IR to a canvas
     and diff against `preview/surface-maps.ts` / `paintInvertedPanelStack` for
     the same document. Catches dropped layers, a missing pattern-square clip,
     bad normalisation. Works precisely because the IR is in document space
     (Decision 0.1), so no flip has to be undone. **It cannot catch a Y-flip or
     polarity bug, because it never runs the writer** — do not claim otherwise.
   - **2b — emitted Gerber vs editor (validates the WRITER).** Plot the actual
     `.GTL`/`.GTS`/`.GTO`/`.GKO` bytes with a third-party plotter and diff the
     result against the same editor raster. This is the only automated check
     that sees a missing, doubled, or half-applied Y flip, a swapped
     `%LPD*%`/`%LPC*%`, or geometry lost during serialisation.

   For 2b use the tracespace plotter/renderer chain (`@tracespace/plotter` +
   `@tracespace/renderer` → SVG → raster) as a `devDependency` if it installs
   and plots cleanly. If it does not, move 2b to #216 as a scripted
   `gerbv --export=png` step and say so in a code comment — **do not delete it
   and do not substitute 2a for it.** Allow a few-µm tolerance in both diffs per
   Decision 6.1.

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

## Decision 11 — Panel screw holes: derived, PTH on FR-4, NPTH on alumi

(New in #231; implemented by #235.)

**Holes are derived, not stored.** Every document gets the template holes for
its `(format, hp)` from `panelHoles(format, hp)`
(`core/src/panel-templates.ts`) at export time. The document model carries no
hole data; free-form user-placed holes are a future extension. The template
coordinates are already canonical fabrication coords — front view, doc space —
so #235 never mirrors or flips anything itself.

**Plating is per material, and it is a per-FILE split.**

- **FR-4 screw holes are plated (PTH).** Copper beside an unplated hole edge
  trips fab DRC, and plating puts the HASL finish on the barrel too — exactly
  the requested "gold around the hole".
- **Alumi screw holes are non-plated (NPTH)**, per the ordered reference data.
- Excellon expresses plating as two files with two `TF.FileFunction` headers
  (`Plated,1,2,PTH` / `NonPlated,1,2,NPTH`), never a per-hit flag — hence
  `DrillIr`'s `pth`/`npth` pair, and exactly one side ever has content for a
  given material.

**Both drill files are always emitted**; the empty side ships header-only,
byte-modelled on the ordered reference sets:

```
M48
; #@! TF.CreationDate,<ISO-8601 with timezone>
; #@! TF.GenerationSoftware,zudolab,zudo-panel-designer,<pkgVersion>
; #@! TF.FileFunction,Plated,1,2,PTH        (or NonPlated,1,2,NPTH)
FMAT,2
METRIC
%
G90
G05
M30
```

LF-terminated ASCII, same discipline as the Gerber bodies (Decision 3.4).
Filenames share `gerberFileSet`'s stem: `zpd-panel-<hp>hp-PTH.drl` /
`zpd-panel-<hp>hp-NPTH.drl` (Decision 2.2).

**Body emission is #235's** — tool table (`T<code>C<diameter>`), `X…Y…` round
hits, `G00`/`M15`/`G01`/`M16` routed slots (the ordered reference sets' exact
idiom), with the Y flip through `coordinate-frame.ts` (Decision 1). A
`DrillSlot`'s `start`/`end` are the endpoint CENTRES of the routed span, which
for a template slot is `slotLength − drillDiameter` long — NOT the finished
overall stadium length. #235 implements this in `gerber/excellon.ts` (a pure
emitter parallel to `writer.ts`), which still REFUSES (throws) on drill
content that references a tool absent from the tool table: silently dropping
drill content is exactly the failure mode Decision 8 exists to prevent.

**Hole artwork is injected, not extracted.** `injectHoleFabrication(...)`
(`gerber/holes.ts`) returns, per layer role, regions build-ir APPENDS after
the artwork union+clip: mask openings on `solder-mask`/`b-solder-mask` (both
materials), copper rings on `copper`/`b-copper` (FR-4 only). Appended regions
follow Decision 0's ring rules and paint after the artwork — safe, because a
ring region whose hole is the drill barrel only ever `%LPC*%`-clears copper
that is drilled away regardless. The #231 stub returns no injections and an
empty drill pair; the zip already ships the full per-material manifest with
that stub content.

---

## Decision 12 — Alumi back convention: B.Mask openings only, bare metal

(New in #231; epic #226 decision 2. Implemented across #235/#236.)

**The alumi export replicates the ordered reference convention**: its back
file set is `.GBS` alone, carrying ONLY the screw-hole mask openings — that
exact data produced bare-metal backs on the real orders. No `.GBL`, no `.GBO`
for alumi: aluminum-core boards have no back copper or legend to design, and
shipping empty ones would invite the fab to ask. The app and preview show the
alumi back as bare metal (#232's preview contract).

FR-4 ships the full back trio (`b-copper`, `b-solder-mask`, `b-silkscreen`) —
a real, user-editable back (`doc.backLayers`, projected by #236).

`ir.ts` pins both role lists as data with one owner:

- `MATERIAL_BACK_ROLES` — fr4: `['b-copper', 'b-solder-mask',
  'b-silkscreen']`; alumi: `['b-solder-mask']`.
- `MATERIAL_LAYER_ROLES` — front, back, outline; `GerberIr.layers` carries one
  entry per role in that order, and the zip manifest follows it entry for
  entry (Decision 2.1).

The alumi `b-solder-mask` layer stays EMPTY at extraction permanently: its
screw-hole openings are #235's injections (Decision 11), not #236's
extraction. `extractBackLayers` returns it with zero regions even after #236
is done.

---

## Decision 13 — Back-side X mirror: once, in doc space, at the build-IR boundary

(New in #231; implemented by #236. FABRICATION-CRITICAL, same class as
Decision 1.)

The IR's canonical fabrication frame is **front view, doc space** for every
layer, back roles included. Back-side content is authored as seen from the
BACK (`doc.backLayers`); projecting it into the front-view frame requires an X
mirror:

```
x → panel.widthMm − x        // in doc space, y untouched
```

**Applied exactly once, inside `extractBackLayers` (`gerber/back-extract.ts`),
at the build-IR boundary — never in the writer.** By the time a `b-*`
`IrLayer` exists, its regions are already mirrored; the writer treats a back
layer byte-for-byte like its front counterpart and applies only the same
single Y flip every layer gets (Decision 1). A writer-side mirror would
double-transform — the back of every board mirrored into scrap, the exact
failure mode Decision 1 guards against on the Y axis.

Consequences, pinned by tests:

- `test-ir.ts`'s `BACK_COPPER_LAYER` deliberately reuses `COPPER_LAYER`'s
  asymmetric regions, and `writer.test.ts` asserts the emitted operations are
  byte-identical — any writer-side mirror or flip fails that fixture.
- #235's hole injections never mirror: template hole coordinates are already
  front-view canonical (Decision 11), valid for front and back roles alike.
- Winding survives: an X mirror alone would invert signed area, so #236
  re-normalises to Decision 0.2's winding (positive outers) as part of
  extraction — mirrored regions still satisfy the same ring rules as front
  regions.

---

## Summary — one line each

0. **IR contract**: flattened polygon rings in document mm (y-down), `IrRegion
   {outer, holes}` grouped into `MATERIAL_LAYER_ROLES[material]`-ordered
   `IrLayer`s plus a `DrillIr` pair, outer rings positive signed area, disjoint
   and outer-before-contained, unsupported layers signalled by a typed
   `IrLayerResult` discriminated union.
1. **Y flip**: `gerberY = panelHeightMm(format) − docY`, applied once in
   `gerber/coordinate-frame.ts` and nowhere else; no Gerber-level transforms.
2. **Fileset**: the per-material manifest — FR-4
   `.GTL`/`.GTS`/`.GTO`/`.GBL`/`.GBS`/`.GBO`/`.GKO`, alumi
   `.GTL`/`.GTS`/`.GTO`/`.GBS`/`.GKO`, plus both drill files — always written,
   empty side header-only; the export-scope statement appears in the export UI
   before download.
3. **Attributes**: exact X2 strings as listed; solder mask is uncomplemented
   geometry in a `Negative`-polarity file; the outline file emits no
   `TF.FilePolarity` at all; creation date is injected, not ambient.
4. **Hidden mask container**: emit a full-panel opening rectangle — an empty
   `.GTS` would mean the opposite (full coverage).
5. **Stroker**: implement a real one (round/butt/square caps, round/miter joins,
   miter limit 10); apertures cannot express what the pattern generators use —
   and every pattern layer is separately clipped to its own square, which the
   profile clip does not cover.
6. **Format/tolerance**: `%FSLAX46Y46*%` + `%MOMM*%`, 5 µm total error split
   ≤2.5 µm arc→cubic and ≤2.5 µm adaptive flattening, flattened last after all
   boolean work.
7. **Clipping**: real boolean intersection with the board outline, honouring the
   editor's 0.35-alpha "this will not be manufactured" promise.
8. **Refusals**: unlisted HP, visible image layer, non-curated font, missing
   glyph, unknown pattern id, complexity overrun (20,000 rings/layer,
   2,000,000 vertices total) — refuse, do not offload to a worker; hidden layers
   never trigger a refusal.
9. **Normalisation**: `normalizeRect` before extraction; never recompute the
   cached text pivot.
10. **Oracles**: third-party parser in CI + two raster diffs (IR-vs-editor for
    the extractor, plotted-Gerber-vs-editor for the writer) + one human check in
    an independent viewer on an asymmetric design.
11. **Screw holes**: derived from the template catalog per `(format, hp)`,
    never stored; FR-4 plated (`PTH.drl`), alumi non-plated (`NPTH.drl`); mask
    openings and FR-4 copper rings are appended injections, and the Excellon
    emitter refuses content that references a tool absent from its table.
12. **Alumi back**: `.GBS` with screw-hole openings only — no B.Cu, no B.Silk,
    bare-metal back; FR-4 ships the full editable back trio.
13. **Back X mirror**: `x → widthMm − x`, applied once in doc space at the
    build-IR boundary (`back-extract.ts`), never in the writer.
