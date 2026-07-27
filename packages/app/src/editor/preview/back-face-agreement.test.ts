// The cross-surface back-face check Wave 6 (#238) recorded as missing.
//
// Three consumers render the same back stack and every one of them uses a
// different frame: the 2D composer's Back view draws layer content at raw
// back-view doc x, the exported `.GBL` carries canonical fabrication x, and
// the 3D preview paints a canonical canvas that its sampling contract mirrors
// back to a rear view. Each was unit-pinned in isolation, and the preview's
// back artwork was still mirrored against the other two for an entire epic —
// nothing compared them. #238 noted the same shape of gap for the template
// holes, whose agreement rested only on all three sharing `panelHoles()`.
//
// So the fixture here is deliberately ASYMMETRIC: a symmetric one is fixed by
// `x → widthMm − x` and would pass in either direction, proving nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDefaultDoc,
  createPcbLayerContainer,
  panelHoles,
  panelWidthMm,
  type DocState,
  type ShapeLayer,
} from '@zpd/core';
import { createBooleanEngine, type BooleanEngine } from '../geometry-kernel';
import { holeDisplayCx } from '../renderer';
import { buildGerberIr } from '../gerber/build-ir';
import { createPreviewBoardGeometry, PREVIEW_BACK_TEXTURE_MIRROR } from './board-model';
import { PREVIEW_BACK_FACE_ORIENTATION, type PreviewCanvasSource } from './contracts';
import { createPreviewSurfaceMapGenerator, type PreviewCanvasFactory } from './surface-maps';

const HP = 12;
const FORMAT = '3U';
const PANEL_WIDTH_MM = panelWidthMm(HP);

// Off-centre in x, and in a y band the screw-hole rows never reach, so the
// artwork region is unambiguous in the emitted IR.
const ARTWORK = { x: 5, y: 60, width: 3, height: 3 } as const;

// ─── a transform-aware recorder, reduced to "which rects got filled" ────────

type Affine = readonly [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function compose(outer: Affine, inner: Affine): Affine {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function applyAffine(m: Affine, x: number, y: number): readonly [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface FilledRect {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

// Reports every rect that was actually FILLED, in the panel-mm frame the
// enclosing setTransform establishes — which for both faces is canonical
// fabrication space. The panel clip rect is excluded for free: it ends in
// clip(), not fill().
function filledRectsInPanelSpace(): {
  readonly context: CanvasRenderingContext2D;
  readonly rects: readonly FilledRect[];
} {
  const rects: FilledRect[] = [];
  let pending: readonly number[] | null = null;
  // Relative to the most recent setTransform, so it reads out as panel mm.
  let panelLocal: Affine = IDENTITY;
  const stack: Affine[] = [];
  const context = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'measureText') return () => ({ width: 0 });
        return (...args: unknown[]) => {
          const n = args as number[];
          if (property === 'save') stack.push(panelLocal);
          if (property === 'restore') panelLocal = stack.pop() ?? panelLocal;
          if (property === 'setTransform') panelLocal = IDENTITY;
          if (property === 'translate')
            panelLocal = compose(panelLocal, [1, 0, 0, 1, n[0]!, n[1]!]);
          if (property === 'scale') panelLocal = compose(panelLocal, [n[0]!, 0, 0, n[1]!, 0, 0]);
          if (property === 'beginPath') pending = null;
          if (property === 'rect') pending = n;
          if (property === 'fill' && pending) {
            const [x0, y0] = applyAffine(panelLocal, pending[0]!, pending[1]!);
            const [x1, y1] = applyAffine(
              panelLocal,
              pending[0]! + pending[2]!,
              pending[1]! + pending[3]!,
            );
            rects.push({
              xMin: Math.min(x0, x1),
              xMax: Math.max(x0, x1),
              yMin: Math.min(y0, y1),
              yMax: Math.max(y0, y1),
            });
            pending = null;
          }
          return undefined;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { context, rects };
}

// ─── fixtures ───────────────────────────────────────────────────────────────

function backArtwork(id: string): ShapeLayer {
  return { id, name: id, type: 'shape', shape: 'rect', color: 1, ...ARTWORK };
}

function docFixture(): DocState {
  return {
    ...createDefaultDoc(HP),
    format: FORMAT,
    material: 'fr4',
    panelHp: HP,
    layers: [
      createPcbLayerContainer('copper', []),
      createPcbLayerContainer('solder-mask', []),
      createPcbLayerContainer('silkscreen', []),
    ],
    backLayers: [
      createPcbLayerContainer('back', 'copper', [backArtwork('back-copper')]),
      createPcbLayerContainer('back', 'solder-mask', []),
      createPcbLayerContainer('back', 'silkscreen', []),
    ],
    guides: [],
  };
}

function previewBackCopperRects(): readonly FilledRect[] {
  const recorders = new Map<PreviewCanvasSource, ReturnType<typeof filledRectsInPanelSpace>>();
  const factory: PreviewCanvasFactory = (widthPx, heightPx) => {
    const recorder = filledRectsInPanelSpace();
    const canvas = {
      width: widthPx,
      height: heightPx,
      getContext: (id: string) => (id === '2d' ? recorder.context : null),
    } as unknown as PreviewCanvasSource;
    recorders.set(canvas, recorder);
    return canvas;
  };
  const generator = createPreviewSurfaceMapGenerator({ canvasFactory: factory });
  const snapshot = generator.generate({
    doc: docFixture(),
    ticket: { surfaceRevision: 1, signal: new AbortController().signal },
    preferredPixelsPerMm: 1,
    maximumTextureSizePx: 512,
  });
  const backBaseColor = snapshot.backMaps!.baseColor.source;
  generator.close();
  return recorders.get(backBaseColor)!.rects;
}

let engine: BooleanEngine;
beforeAll(async () => {
  engine = await createBooleanEngine();
}, 30_000);

describe('back-face agreement across the composer, the preview, and the exported Gerber', () => {
  it('paints back artwork at the canonical x the .GBL exports it at', async () => {
    const previewRects = previewBackCopperRects();
    // Only the artwork fills a rect on this map: screw-hole copper rings are
    // traced as arcs, and the panel rect is a clip.
    expect(previewRects).toHaveLength(1);
    const preview = previewRects[0]!;

    const result = await buildGerberIr(docFixture(), { engine });
    if (!result.ok) throw new Error(`unexpected refusal: ${result.refusals.map((r) => r.code)}`);
    const backCopper = result.ir.layers.find((layer) => layer.role === 'b-copper')!;
    const artworkRegions = backCopper.regions.filter((region) =>
      region.outer.every((point) => point.y > ARTWORK.y - 1 && point.y < ARTWORK.y + 4),
    );
    expect(artworkRegions).toHaveLength(1);
    const gerberXs = artworkRegions[0]!.outer.map((point) => point.x);

    // THE CROSS-SURFACE CLAIM: one physical position, two subsystems.
    expect(preview.xMin).toBeCloseTo(Math.min(...gerberXs), 9);
    expect(preview.xMax).toBeCloseTo(Math.max(...gerberXs), 9);

    // …and it is genuinely the reflected position, not the authored one, so
    // an asymmetric fixture cannot pass by coincidence.
    expect(preview.xMin).toBeCloseTo(PANEL_WIDTH_MM - (ARTWORK.x + ARTWORK.width), 9);
    expect(preview.xMin).not.toBeCloseTo(ARTWORK.x, 3);
  }, 30_000);

  it('agrees with the composer Back view once the sampling contract mirrors the face', () => {
    const preview = previewBackCopperRects()[0]!;
    // The rear view flips canonical x back for display; the composer draws
    // back layer content at raw doc x (holeDisplayCx covers template holes
    // only, never artwork — see renderer.ts).
    expect(PANEL_WIDTH_MM - preview.xMax).toBeCloseTo(ARTWORK.x, 9);
    expect(PANEL_WIDTH_MM - preview.xMin).toBeCloseTo(ARTWORK.x + ARTWORK.width, 9);
  }, 30_000);

  it('composes the back lid UV and the texture mirror to identity, so canvas x IS physical x', () => {
    // The two mirrors in the sampling chain — the −z lid's uv.x = 1 − u and
    // PREVIEW_BACK_TEXTURE_MIRROR — cancel. That is what makes a CANONICAL
    // back canvas correct and is why the fix belongs in the paint: flipping
    // either half here would break the screw holes, which are canonical too.
    const dimensions = { widthMm: PANEL_WIDTH_MM, heightMm: 128.5, thicknessMm: 1.6 };
    const geometry = createPreviewBoardGeometry(dimensions, []);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');

    // The mirror three.js applies around centerX, as installed on the back
    // texture set (board-model's createPreviewTextureSet({ mirrorX: true })).
    const sampled = (u: number) =>
      PREVIEW_BACK_TEXTURE_MIRROR.centerX +
      (u - PREVIEW_BACK_TEXTURE_MIRROR.centerX) * PREVIEW_BACK_TEXTURE_MIRROR.repeatX;

    let checked = 0;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (normal.getZ(vertex) >= -0.5) continue;
      const physicalX = position.getX(vertex) + dimensions.widthMm / 2;
      // 5 decimals, not more: UVs live in a Float32 buffer attribute, so a
      // panel-width round trip carries ~1e-6 mm of storage error.
      expect(sampled(uv.getX(vertex)) * dimensions.widthMm).toBeCloseTo(physicalX, 5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    geometry.dispose();

    // Document top-left samples at u = 1 raw, which the mirror sends to 0 —
    // the canonical canvas' own left edge.
    expect(PREVIEW_BACK_FACE_ORIENTATION.documentTopLeftUv.u).toBe(1);
    expect(sampled(1)).toBe(0);
  });

  it('places template holes at one canonical x for every consumer', async () => {
    const holes = panelHoles(FORMAT, HP);
    const result = await buildGerberIr(docFixture(), { engine });
    if (!result.ok) throw new Error(`unexpected refusal: ${result.refusals.map((r) => r.code)}`);
    const backMask = result.ir.layers.find((layer) => layer.role === 'b-solder-mask')!;

    for (const hole of holes) {
      // The exported back mask opens a stadium centred on the UNMIRRORED
      // catalog x: template coordinates are already canonical for both faces.
      const stadium = backMask.regions.find((region) =>
        region.outer.every(
          (point) =>
            Math.abs(point.x - hole.cx) <= hole.opening.length / 2 + 1e-6 &&
            Math.abs(point.y - hole.cy) <= hole.opening.length / 2 + 1e-6,
        ),
      );
      expect(stadium).toBeDefined();
      // The composer mirrors the same catalog x for DISPLAY only, which is
      // exactly what the preview's rear view does to its canonical canvas.
      expect(holeDisplayCx(hole.cx, 'back', PANEL_WIDTH_MM)).toBeCloseTo(
        PANEL_WIDTH_MM - hole.cx,
        9,
      );
    }
    expect(holes.length).toBeGreaterThan(0);
  }, 30_000);
});
