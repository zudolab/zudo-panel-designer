// The back-side extraction seam (#231 contract, #236 implementation).
//
// `doc.backLayers` is projected through the SAME pipeline the front runs —
// every registered `LayerGeometrySource` in front-consultation order (shape,
// path, pattern replay, text outlining), the same hidden/refusal rules, the
// same union → profile-clip → adaptive-flatten tail — and every extracted
// `KernelInput` is X-MIRRORED into canonical fabrication coordinates (front
// view, doc space: `x → panel.widthMm − x`) HERE, at the build-IR boundary.
// That mirror happens exactly once and never in the writer (Decision 13) —
// the writer treats a `b-*` layer byte-for-byte like its front counterpart.
//
// The seam also owns the BACK hole fabrication (Decisions 11/12): mask-opening
// stadiums on `b-solder-mask` for both materials, copper stadiums on
// `b-copper` for FR-4, computed from the canonical `panelHoles()` coordinates
// directly — template coordinates are already front-view fabrication coords,
// so they are NEVER mirrored, and never derived from #235's front injections.
//
// The SIGNATURE here is final: build-ir.ts is already wired to it, so #236
// never edits that shared file. That freeze is also why the small consultation
// walk below (extractLayerCubics and its two lookup tables) mirrors build-ir's
// private copy instead of importing it — build-ir imports THIS module, so the
// helpers cannot be exported from there without editing it mid-wave.
import {
  panelHoles,
  projectPcbLayerSlices,
  type DocState,
  type Layer,
  type PanelHole,
  type PcbMaterial,
} from '@zpd/core';
import type {
  BooleanEngine,
  KernelCubic,
  KernelInput,
  KernelPoint,
  KernelRing,
} from '../geometry-kernel';
import { reverseRing } from '../geometry-kernel';
import { ellipseToRing, ellipticalArcToCubics } from './arc';
import type {
  BackLayerRole,
  GerberRefusalCode,
  IrExtractContext,
  IrLayer,
  IrLayerCubicResult,
  IrPanel,
  IrRegion,
  IrUnsupportedReason,
  LayerGeometrySource,
  RefusalSink,
} from './ir';
import { MATERIAL_BACK_ROLES, ROLE_FILE_POLARITY } from './ir';
import { UNION_UNRELIABLE_PATTERN_IDS } from './pattern-union-unreliable.generated';
import { degenerateCubic, polygonToRing, rectToRing } from './primitives';
import { ringsToRegions } from './regions';
import type { IrComplexityLimits, IrTolerance } from './tolerance';

export interface BackExtractContext {
  /** Carries `backLayers` and `material` — the two doc facts the seam reads. */
  readonly doc: DocState;
  readonly panel: IrPanel;
  /** The shared kernel engine, already constructed — same instance as the front. */
  readonly engine: BooleanEngine;
  /** Every registered source, in front-extraction consultation order. */
  readonly sources: readonly LayerGeometrySource[];
  readonly tolerance: IrTolerance;
  readonly limits: IrComplexityLimits;
}

/**
 * #236's seam: the material's back layers (MATERIAL_BACK_ROLES order),
 * regions already X-mirrored into front-view doc space. Refusals from back
 * extraction go through `refusals` so Decision 8's single collected dialog
 * holds front and back problems together.
 *
 * FR-4 gets the full editable back: user artwork per role, the Decision 4
 * matrix on the back mask container, plus the hole fabrication. The alumi
 * back is bare metal (Decision 12) — `doc.backLayers` is not manufactured, so
 * user back artwork is never consulted (and can never refuse); its
 * `b-solder-mask` carries the screw-hole openings ONLY, the exact data that
 * produced bare-metal backs on the real orders.
 */
export async function extractBackLayers(
  ctx: BackExtractContext,
  refusals: RefusalSink,
): Promise<readonly IrLayer[]> {
  const profile = rectToRing(0, 0, ctx.panel.widthMm, ctx.panel.heightMm);
  const holes = panelHoles(ctx.panel.format, ctx.panel.hp);
  const layers: IrLayer[] = [];
  for (const role of MATERIAL_BACK_ROLES[ctx.doc.material]) {
    const inputs =
      ctx.doc.material === 'fr4' ? await collectBackArtworkInputs(ctx, role, refusals) : [];
    for (const input of holeFabricationInputs(role, ctx.doc.material, holes, ctx.tolerance)) {
      inputs.push(input);
    }
    layers.push({
      role,
      filePolarity: ROLE_FILE_POLARITY[role],
      renderAs: 'filled-region',
      regions: backRegions(ctx.engine, inputs, profile, ctx.tolerance),
    });
  }
  return layers;
}

// ─── Decision 13 — the exactly-once X mirror ────────────────────────────────

function mirrorPoint(p: KernelPoint, widthMm: number): KernelPoint {
  return { x: widthMm - p.x, y: p.y };
}

function mirrorCubic(c: KernelCubic, widthMm: number): KernelCubic {
  return {
    p0: mirrorPoint(c.p0, widthMm),
    c1: mirrorPoint(c.c1, widthMm),
    c2: mirrorPoint(c.c2, widthMm),
    p3: mirrorPoint(c.p3, widthMm),
  };
}

/**
 * Back-view doc space → canonical front-view doc space (`x → widthMm − x`,
 * y untouched). Each mirrored ring is also REVERSED: a mirror alone negates
 * every signed area, and reversing restores the traversal orientation, so
 * mirrored inputs enter the kernel with the same winding semantics the front
 * pipeline feeds it (Decision 13's re-normalisation; `ringsToRegions` then
 * pins the emitted winding by shoelace sign exactly as it does for the front).
 */
function mirrorInput(input: KernelInput, widthMm: number): KernelInput {
  return {
    contours: input.contours.map((ring) => reverseRing(ring.map((c) => mirrorCubic(c, widthMm)))),
    fillRule: input.fillRule,
  };
}

// ─── Back artwork extraction (FR-4 only) ────────────────────────────────────

/** Reasons that mean "another extractor owns this", not "this is an error". */
const HANDOFF_REASONS: ReadonlySet<IrUnsupportedReason> = new Set(['pattern-layer', 'text-layer']);

const REFUSAL_CODE_FOR_REASON: Record<IrUnsupportedReason, GerberRefusalCode> = {
  'pattern-layer': 'unsupported-layer-type',
  'text-layer': 'unsupported-layer-type',
  'image-layer': 'image-layer-present',
  'unknown-pattern-id': 'unknown-pattern-id',
  'non-curated-font': 'non-curated-font',
  'missing-glyph': 'missing-glyph',
  'complexity-overrun': 'complexity-overrun',
};

/** #218's measured-corrupt generator set — the same gate the front runs. */
const UNION_UNRELIABLE_PATTERN_ID_SET: ReadonlySet<string> = new Set(UNION_UNRELIABLE_PATTERN_IDS);

function regionsToGroups(regions: readonly IrRegion[]): KernelInput[] {
  const contours: KernelRing[] = [];
  for (const region of regions) {
    const outer = polygonToRing(region.outer);
    if (outer.length > 0) contours.push(outer);
    for (const hole of region.holes) {
      const ring = polygonToRing(hole);
      if (ring.length > 0) contours.push(ring);
    }
  }
  return contours.length > 0 ? [{ contours, fillRule: 'nonzero' }] : [];
}

/**
 * Consult every source registered for the layer's type in order — a hand-off
 * reason means "the next source owns it", a terminal reason stops the walk
 * (Decision 0.4). Mirrors build-ir's private walk; see the header for why it
 * is duplicated rather than shared.
 */
async function extractLayerCubics(
  layer: Layer,
  sources: readonly LayerGeometrySource[],
  ctx: IrExtractContext,
): Promise<IrLayerCubicResult> {
  let last: IrLayerCubicResult | null = null;
  for (const source of sources) {
    if (source.handles !== layer.type) continue;
    const result: IrLayerCubicResult = source.extractCubics
      ? await source.extractCubics(layer, ctx)
      : await (async () => {
          const flat = await source.extract(layer, ctx);
          return flat.kind === 'regions'
            ? ({
                kind: 'cubics',
                layerId: flat.layerId,
                groups: regionsToGroups(flat.regions),
              } as const)
            : flat;
        })();
    if (result.kind !== 'unsupported') return result;
    last = result;
    if (!HANDOFF_REASONS.has(result.reason)) break;
  }
  return (
    last ?? {
      kind: 'unsupported',
      layerId: layer.id,
      layerName: layer.name,
      reason: 'pattern-layer',
    }
  );
}

/**
 * The FR-4 back artwork for one role: the front loop's extraction rules
 * applied to `doc.backLayers` — hidden layers never extract and never refuse,
 * the #218 union-unreliable gate refuses ahead of extraction, the Decision 8
 * ring ceiling is a running total — with every extracted group mirrored at
 * this one boundary. The Decision 4 matrix governs the back mask container
 * identically to the front: hidden ⇒ ONE full-panel opening (canonical
 * geometry, symmetric — nothing to mirror), empty-but-visible ⇒ no artwork
 * (full coverage), leaves ⇒ those openings, mirrored and uncomplemented.
 */
async function collectBackArtworkInputs(
  ctx: BackExtractContext,
  role: BackLayerRole,
  refusals: RefusalSink,
): Promise<KernelInput[]> {
  const slices = projectPcbLayerSlices(ctx.doc.backLayers);
  if (role === 'b-solder-mask' && slices.solderMaskHidden) {
    return [
      {
        contours: [rectToRing(0, 0, ctx.panel.widthMm, ctx.panel.heightMm)],
        fillRule: 'nonzero',
      },
    ];
  }

  const sliceLayers =
    role === 'b-copper'
      ? slices.copper
      : role === 'b-solder-mask'
        ? slices.solderMask
        : slices.silkscreen;
  const extractCtx: IrExtractContext = {
    panel: ctx.panel,
    role,
    engine: ctx.engine,
    tolerance: ctx.tolerance,
  };
  const inputs: KernelInput[] = [];
  let ringCount = 0;
  for (const layer of sliceLayers) {
    if (layer.hidden) continue;
    if (layer.type === 'pattern' && UNION_UNRELIABLE_PATTERN_ID_SET.has(layer.patternType)) {
      refusals.add('pattern-union-unreliable', {
        id: layer.id,
        name: `${layer.name} (pattern "${layer.patternType}")`,
      });
      continue;
    }
    const result = await extractLayerCubics(layer, ctx.sources, extractCtx);
    if (result.kind === 'unsupported') {
      refusals.add(REFUSAL_CODE_FOR_REASON[result.reason], { id: layer.id, name: layer.name });
      continue;
    }
    for (const group of result.groups) {
      if (group.contours.length === 0) continue;
      inputs.push(mirrorInput(group, ctx.panel.widthMm));
      ringCount += group.contours.length;
    }
    if (ringCount > ctx.limits.maxRingsPerLayer) {
      refusals.add('complexity-overrun', { id: layer.id, name: layer.name });
    }
  }
  return inputs;
}

// ─── Hole fabrication (Decisions 11/12) ─────────────────────────────────────

/**
 * The screw-hole fabrication a back role carries, from the canonical
 * `panelHoles()` coordinates: mask-opening stadiums on `b-solder-mask` (both
 * materials), and on FR-4 a copper stadium of the SAME shape on `b-copper`
 * (the drill void pierces it; the plated barrel takes the HASL finish — the
 * "gold around the hole" result, Decision 11). Template coordinates are
 * already front-view canonical, so nothing here is mirrored.
 *
 * These enter the boolean union as INPUTS rather than post-union appends, so
 * a Decision 4 full-panel opening subsumes them and overlapping user artwork
 * merges instead of double-painting — the same interaction rule #235 applies
 * on the front.
 */
function holeFabricationInputs(
  role: BackLayerRole,
  material: PcbMaterial,
  holes: readonly PanelHole[],
  tolerance: IrTolerance,
): KernelInput[] {
  const carries = role === 'b-solder-mask' || (role === 'b-copper' && material === 'fr4');
  if (!carries) return [];
  return holes.map((hole) => ({
    contours: [openingStadiumRing(hole, tolerance.arcMm)],
    fillRule: 'nonzero' as const,
  }));
}

function snapArcEnds(arc: KernelCubic[], start: KernelPoint, end: KernelPoint): KernelCubic[] {
  if (arc.length === 0) return arc;
  arc[0] = { ...arc[0], p0: start };
  arc[arc.length - 1] = { ...arc[arc.length - 1], p3: end };
  return arc;
}

/**
 * A hole's `opening` as one closed cubic ring: a round-ended stadium centred
 * on the hole, long axis horizontal (`panel-templates.ts`'s opening contract),
 * traversed with increasing arc parameter — clockwise on screen, POSITIVE
 * shoelace area, Decision 0.2's outer sign. A round hole's square opening
 * (`width === length`) degenerates to the circle of that diameter. Cap arcs
 * go through the measured Decision 6.1 subdivision; their endpoints are
 * snapped to the exact cap extremes so the straight edges close the ring
 * without a float-noise seam.
 */
function openingStadiumRing(hole: PanelHole, arcToleranceMm: number): KernelRing {
  const radius = hole.opening.width / 2;
  const span = hole.opening.length - hole.opening.width;
  if (!(radius > 0)) return [];
  if (span <= 0) return ellipseToRing(hole.cx, hole.cy, radius, radius, arcToleranceMm);

  const half = span / 2;
  const rightTop = { x: hole.cx + half, y: hole.cy - radius };
  const rightBottom = { x: hole.cx + half, y: hole.cy + radius };
  const leftBottom = { x: hole.cx - half, y: hole.cy + radius };
  const leftTop = { x: hole.cx - half, y: hole.cy - radius };
  const rightCap = snapArcEnds(
    ellipticalArcToCubics(
      hole.cx + half,
      hole.cy,
      radius,
      radius,
      -Math.PI / 2,
      Math.PI,
      arcToleranceMm,
    ),
    rightTop,
    rightBottom,
  );
  const leftCap = snapArcEnds(
    ellipticalArcToCubics(
      hole.cx - half,
      hole.cy,
      radius,
      radius,
      Math.PI / 2,
      Math.PI,
      arcToleranceMm,
    ),
    leftBottom,
    leftTop,
  );
  return [
    ...rightCap,
    degenerateCubic(rightBottom, leftBottom),
    ...leftCap,
    degenerateCubic(leftTop, rightTop),
  ];
}

// ─── The shared union → clip → flatten tail ─────────────────────────────────

/**
 * The front pipeline's union+clip tail, applied to the assembled back inputs
 * (mirrors build-ir's private `unionAndClip` — same duplication rationale as
 * the consultation walk above). A real boolean intersection with the profile,
 * not a bbox reject: a mirrored shape straddling the panel edge is cut, and
 * every emitted coordinate stays non-negative for the writer's rounding.
 */
function backRegions(
  engine: BooleanEngine,
  inputs: readonly KernelInput[],
  profile: KernelRing,
  tolerance: IrTolerance,
): readonly IrRegion[] {
  if (inputs.length === 0) return [];
  const united = engine.arrange(inputs.map((g) => ({ ...g }))).unite();
  if (united.length === 0) return [];
  const clipped = engine
    .arrange([
      { contours: united, fillRule: 'nonzero' },
      { contours: [profile], fillRule: 'nonzero' },
    ])
    .intersect();
  return ringsToRegions(clipped, tolerance);
}
