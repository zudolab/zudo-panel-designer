/**
 * The geometry orchestrator: `DocState` → `GerberIr` (Decisions 4, 5, 7, 8).
 *
 * Pipeline order is fixed by Decision 5 and is not free to rearrange:
 *
 *   extract (cubics, doc mm) → bake rotation → stroke-expand (cubics)
 *     → clip to the pattern square (pattern layers only, #211)
 *     → union per material → clip to profile → adaptive flatten → IR polygons
 *
 * Flattening is LAST, after all boolean work, so precision is not spent twice
 * and the kernel's exact `cubicSignedArea` still applies to the real curves.
 *
 * Two things this module deliberately does NOT do:
 *
 *  - It does not re-flatten the layer tree. It reads through
 *    `projectPcbLayerSlices`, which already folds container/group `hidden` onto
 *    leaves and is WeakMap-memoised. An ad-hoc re-projection bumps
 *    `text-geometry`'s document incarnation and can make rotated text jump on
 *    screen mid-session (`flat-projection.ts`, Decision 9).
 *  - It does not complement solder-mask geometry. A mask leaf ALREADY means an
 *    opening (`palette.ts:1-3,17`, `mask-sheet.ts:2-3,38` —
 *    `globalCompositeOperation = 'destination-out'`). `README.md:45-46`'s
 *    "positive coverage" prose is stale and inverted (#216). Declaring
 *    `%TF.FilePolarity,Negative*%` is the writer's job (#210); the geometry
 *    passes through untouched.
 */

import {
  PANEL_HEIGHT_MM,
  PANEL_SIZES,
  panelWidthMm,
  projectPcbLayerSlices,
  type DocState,
  type Layer,
} from '@zpd/core';
import type { BooleanEngine, KernelInput, KernelRing } from '../geometry-kernel';
import { createBooleanEngine } from '../geometry-kernel';
import { BUILTIN_GEOMETRY_SOURCES } from './extract';
import { createPatternGeometrySource } from './pattern-source';
import { UNION_UNRELIABLE_PATTERN_IDS } from './pattern-union-unreliable.generated';
import type {
  GerberIr,
  GerberRefusal,
  GerberRefusalCode,
  IrExtractContext,
  IrLayer,
  IrLayerCubicResult,
  IrLayerRole,
  IrPanel,
  IrRegion,
  IrUnsupportedReason,
  LayerGeometrySource,
} from './ir';
import { polygonToRing, rectToRing } from './primitives';
import { countRegionVertices, ringsToRegions } from './regions';
import {
  DEFAULT_IR_LIMITS,
  DEFAULT_IR_TOLERANCE,
  type IrComplexityLimits,
  type IrTolerance,
} from './tolerance';

type MaterialRole = Exclude<IrLayerRole, 'outline'>;

const MATERIAL_ROLES: readonly MaterialRole[] = ['copper', 'solder-mask', 'silkscreen'];

const FILE_POLARITY: Record<IrLayerRole, IrLayer['filePolarity']> = {
  copper: 'positive',
  // Negative polarity is DECLARATIVE. The geometry stays uncomplemented.
  'solder-mask': 'negative',
  silkscreen: 'positive',
  outline: null,
};

/** Reasons that mean "another extractor owns this", not "this is an error". */
const HANDOFF_REASONS: ReadonlySet<IrUnsupportedReason> = new Set(['pattern-layer', 'text-layer']);

/**
 * Pattern ids `path-bool` is measured to corrupt end-to-end (#218). GENERATED
 * — see pattern-union-unreliable.generated.ts's header. Checked ahead of
 * extraction (Decision 8: refuse, don't ship a plausible-looking wrong file),
 * so a corrupted-by-measurement layer never spends time being recorded and
 * unioned only to have its result discarded.
 */
const UNION_UNRELIABLE_PATTERN_ID_SET: ReadonlySet<string> = new Set(UNION_UNRELIABLE_PATTERN_IDS);

const REFUSAL_CODE_FOR_REASON: Record<IrUnsupportedReason, GerberRefusalCode> = {
  'pattern-layer': 'unsupported-layer-type',
  'text-layer': 'unsupported-layer-type',
  'image-layer': 'image-layer-present',
  'unknown-pattern-id': 'unknown-pattern-id',
  'non-curated-font': 'non-curated-font',
  'missing-glyph': 'missing-glyph',
  'complexity-overrun': 'complexity-overrun',
};

const REFUSAL_MESSAGE: Record<GerberRefusalCode, string> = {
  'unlisted-panel-hp':
    'This panel HP has no entry in the blank-panel spec table, so its width is only an approximation — not an order-ready dimension.',
  'image-layer-present':
    'A raster image cannot be manufactured on the panel. Trace it to vector layers, or hide it, before exporting.',
  'non-curated-font': 'This text layer uses a font with no local file to outline.',
  'missing-glyph':
    'This text layer contains text the export cannot resolve to an outline in the resolved font subset.',
  'unknown-pattern-id': 'This pattern layer names a generator that is not registered.',
  'complexity-overrun':
    'This design is too dense to export: the boolean pipeline would have to process more geometry than the export can handle.',
  'unsupported-layer-type':
    'No geometry extractor is registered for this layer type, so its artwork cannot be exported.',
  'pattern-union-unreliable':
    'The boolean union this export depends on is measured to corrupt this pattern generator — a #206/path-bool backend defect tracked in #218, not a caller bug. Refusing rather than shipping fabrication data already known to be wrong.',
};

export interface BuildGerberIrOptions {
  /**
   * Extra sources, consulted BEFORE the built-ins — this is how #211 and #212
   * take over the `pattern-layer` / `text-layer` hand-offs.
   */
  readonly sources?: readonly LayerGeometrySource[];
  /** Reuse an engine instead of constructing one (tests, batched exports). */
  readonly engine?: BooleanEngine;
  readonly tolerance?: Partial<IrTolerance>;
  readonly limits?: Partial<IrComplexityLimits>;
}

export type BuildGerberIrResult =
  | { readonly ok: true; readonly ir: GerberIr }
  | { readonly ok: false; readonly refusals: readonly GerberRefusal[] };

/** What the collector needs to name an offending layer — any `Layer` qualifies. */
type RefusalLayerRef = { readonly id: string; readonly name: string };

class RefusalCollector {
  private readonly byCode = new Map<GerberRefusalCode, { id: string; name: string }[]>();

  add(code: GerberRefusalCode, layer?: RefusalLayerRef): void {
    const layers = this.byCode.get(code) ?? [];
    if (layer && !layers.some((l) => l.id === layer.id)) {
      layers.push({ id: layer.id, name: layer.name });
    }
    this.byCode.set(code, layers);
  }

  addMany(code: GerberRefusalCode, layers: readonly RefusalLayerRef[]): void {
    for (const layer of layers) this.add(code, layer);
    if (layers.length === 0) this.add(code);
  }

  get empty(): boolean {
    return this.byCode.size === 0;
  }

  /** All refusals, reported together — never one dialog at a time (Decision 8). */
  build(): GerberRefusal[] {
    return [...this.byCode.entries()].map(([code, layers]) => ({
      code,
      message: REFUSAL_MESSAGE[code],
      layers,
    }));
  }
}

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
  // Outer rings are positive and holes negative, so nonzero reads the nesting
  // correctly at any depth.
  return contours.length > 0 ? [{ contours, fillRule: 'nonzero' }] : [];
}

/**
 * Consult every source registered for the layer's type in order. A hand-off
 * reason means "the next source owns it"; a terminal reason stops the walk
 * (Decision 0.4).
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

function unionAndClip(
  engine: BooleanEngine,
  inputs: readonly KernelInput[],
  profile: KernelRing,
): KernelRing[] {
  if (inputs.length === 0) return [];
  const united = engine.arrange(inputs.map((g) => ({ ...g }))).unite();
  if (united.length === 0) return [];
  // A real boolean intersection, not a bbox reject: a shape straddling the
  // panel edge is cut, not dropped and not kept whole (Decision 7). This is
  // also what guarantees the non-negative coordinates #210's rounding relies on.
  return engine
    .arrange([
      { contours: united, fillRule: 'nonzero' },
      { contours: [profile], fillRule: 'nonzero' },
    ])
    .intersect();
}

export async function buildGerberIr(
  doc: DocState,
  options: BuildGerberIrOptions = {},
): Promise<BuildGerberIrResult> {
  const tolerance: IrTolerance = { ...DEFAULT_IR_TOLERANCE, ...options.tolerance };
  const limits: IrComplexityLimits = { ...DEFAULT_IR_LIMITS, ...options.limits };
  // The pattern source is rebuilt with THIS call's ceilings when they differ
  // from the defaults. `IrExtractContext` carries only what every extractor
  // needs (Decision 0.4) and so cannot carry limits, and the pattern recorder
  // is the one extractor that does unbounded work before returning — a caller
  // asking for a stricter ceiling for DoS reasons would otherwise get the
  // default one applied to the very step it was trying to bound.
  const sources = [
    ...(options.sources ?? []),
    ...(options.limits ? [createPatternGeometrySource({ limits })] : []),
    ...BUILTIN_GEOMETRY_SOURCES,
  ];
  const refusals = new RefusalCollector();

  // `panelWidthMm` falls back to hp * 5.08 for an unlisted HP, self-documented
  // as "an approximation, not an order-ready dimension" (`panel-sizes.ts:31-35`),
  // and `serialize.ts:130-133` lets 7, 9 and 13.5 through (Decision 8).
  if (!PANEL_SIZES.some((size) => size.hp === doc.panelHp)) {
    refusals.add('unlisted-panel-hp');
  }
  const panel: IrPanel = {
    hp: doc.panelHp,
    widthMm: panelWidthMm(doc.panelHp),
    heightMm: PANEL_HEIGHT_MM,
  };
  const profile = rectToRing(0, 0, panel.widthMm, panel.heightMm);

  const slices = projectPcbLayerSlices(doc.layers);
  const engine = options.engine ?? (await createBooleanEngine());

  const inputsByRole = new Map<MaterialRole, KernelInput[]>();
  for (const role of MATERIAL_ROLES) {
    const ctx: IrExtractContext = { panel, role, engine, tolerance };
    const inputs: KernelInput[] = [];

    if (role === 'solder-mask' && slices.solderMaskHidden) {
      // Decision 4, row 1: a hidden mask container means NO mask anywhere. An
      // empty .GTS would conventionally mean FULL coverage — the exact
      // inverse — so emit one full-panel opening instead. Its leaves are all
      // folded hidden by the projection and contribute nothing.
      inputs.push({
        contours: [rectToRing(0, 0, panel.widthMm, panel.heightMm)],
        fillRule: 'nonzero',
      });
      inputsByRole.set(role, inputs);
      continue;
    }

    const sliceLayers =
      role === 'copper'
        ? slices.copper
        : role === 'solder-mask'
          ? slices.solderMask
          : slices.silkscreen;
    const overrun: Layer[] = [];
    // Running total, not a re-scan per layer: the ceiling is 20,000 rings, and
    // re-counting every accumulated input after each extraction is quadratic
    // in the layer count right where the limit lives.
    let ringCount = 0;
    for (const layer of sliceLayers) {
      // Hidden layers never reach extraction and never trigger a refusal —
      // the identical guard every existing manufacturing pass uses.
      if (layer.hidden) continue;
      // #218: path-bool corrupts the union for this pattern id, measured
      // end-to-end (pattern-union-unreliable.generated.ts). Checked ahead of
      // extraction, not folded into extractLayerCubics's hand-off machinery —
      // this is a product-level "known wrong" refusal (Decision 8), not an
      // unsupported layer type, and the layer's own extractor would otherwise
      // happily record and union geometry only for it to be discarded here.
      if (layer.type === 'pattern' && UNION_UNRELIABLE_PATTERN_ID_SET.has(layer.patternType)) {
        refusals.add('pattern-union-unreliable', {
          id: layer.id,
          name: `${layer.name} (pattern "${layer.patternType}")`,
        });
        continue;
      }
      const result = await extractLayerCubics(layer, sources, ctx);
      if (result.kind === 'unsupported') {
        refusals.add(REFUSAL_CODE_FOR_REASON[result.reason], layer);
        continue;
      }
      for (const group of result.groups) {
        if (group.contours.length === 0) continue;
        inputs.push(group);
        ringCount += group.contours.length;
      }
      if (ringCount > limits.maxRingsPerLayer) overrun.push(layer);
    }
    if (overrun.length > 0) refusals.addMany('complexity-overrun', overrun);
    inputsByRole.set(role, inputs);
  }

  if (!refusals.empty) return { ok: false, refusals: refusals.build() };

  const materialLayers: IrLayer[] = [];
  let vertices = 0;
  for (const role of MATERIAL_ROLES) {
    const rings = unionAndClip(engine, inputsByRole.get(role) ?? [], profile);
    const regions = ringsToRegions(rings, tolerance);
    vertices += countRegionVertices(regions);
    materialLayers.push({
      role,
      filePolarity: FILE_POLARITY[role],
      renderAs: 'filled-region',
      regions,
    });
  }

  // The outline IS the clip boundary, so it is not itself clipped, and it is a
  // cut path rather than a fill — a filled region on a profile layer is
  // ambiguous about which side is board (Decision 2.3).
  const outlineRegions = ringsToRegions([profile], tolerance);
  vertices += countRegionVertices(outlineRegions);
  const outline: IrLayer = {
    role: 'outline',
    filePolarity: FILE_POLARITY.outline,
    renderAs: 'stroked-contour',
    regions: outlineRegions,
  };

  if (vertices > limits.maxTotalVertices) {
    refusals.add('complexity-overrun');
    return { ok: false, refusals: refusals.build() };
  }

  return {
    ok: true,
    ir: {
      panel,
      layers: [materialLayers[0], materialLayers[1], materialLayers[2], outline],
    },
  };
}
