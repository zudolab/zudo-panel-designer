import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoColorSpace, SRGBColorSpace, type ExtrudeGeometry } from 'three';
import {
  PANEL_THICKNESS_MM,
  panelHeightMm,
  panelHoles,
  panelWidthMm,
  type PanelHole,
  type PcbMaterial,
} from '@zpd/core';
import {
  PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS,
  PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS,
  PREVIEW_BACK_MATERIAL_INDEX,
  PREVIEW_BACK_TEXTURE_MIRROR,
  PREVIEW_BUMP_SCALE,
  PREVIEW_ENVIRONMENT_INTENSITY,
  PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS,
  PREVIEW_FR4_HOLE_WALL_MATERIAL_PARAMETERS,
  PREVIEW_FRONT_MATERIAL_INDEX,
  PREVIEW_GOLD_MATERIAL_PARAMETERS,
  PREVIEW_HOLE_WALL_MATERIAL_INDEX,
  PREVIEW_SIDE_MATERIAL_INDEX,
  createPreviewBoardGeometry,
  createPreviewBoardModel,
  createPreviewBoardShape,
  createPreviewTextureSet,
} from './board-model';
import {
  PREVIEW_BACK_FACE_ORIENTATION,
  PREVIEW_FRONT_FACE_ORIENTATION,
  createPreviewSurfaceSnapshot,
  type PreviewCanvasSource,
  type PreviewSurfaceSnapshot,
} from './contracts';

const FIXTURE_HOLES: readonly PanelHole[] = [
  {
    cx: 10.16,
    cy: 3,
    shape: 'slot',
    drillDiameter: 3.2,
    slotLength: 10.28,
    opening: { width: 4, length: 11.08 },
  },
];

function canvas(width = 120, height = 257): PreviewCanvasSource {
  return { width, height } as PreviewCanvasSource;
}

function canvasSet() {
  return { baseColor: canvas(), metalness: canvas(), roughness: canvas(), height: canvas() };
}

function snapshot(
  surfaceRevision: number,
  dimensions = { widthMm: 60, heightMm: 128.5, thicknessMm: 2.5 },
  material: PcbMaterial = 'fr4',
  holes: readonly PanelHole[] = FIXTURE_HOLES,
): PreviewSurfaceSnapshot {
  return createPreviewSurfaceSnapshot({
    surfaceRevision,
    material,
    ...dimensions,
    holes,
    rasterSize: {
      widthPx: 120,
      heightPx: 257,
      effectivePixelsPerMm: Math.min(120 / dimensions.widthMm, 257 / dimensions.heightMm),
    },
    canvases: canvasSet(),
    backCanvases: material === 'alumi' ? null : canvasSet(),
  });
}

// Finds the unique lid vertex at an exact model-space position whose normal
// faces the given z direction (+1 front, −1 back).
function faceVertexAt(
  geometry: ExtrudeGeometry,
  direction: 1 | -1,
  x: number,
  y: number,
  z: number,
): number {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    if (
      position.getX(vertex) === x &&
      position.getY(vertex) === y &&
      position.getZ(vertex) === z &&
      normal.getZ(vertex) * direction > 0.5
    ) {
      return vertex;
    }
  }
  throw new Error(`no face vertex at (${x}, ${y}, ${z}) toward ${direction}z`);
}

// True when any triangle of the ±z lid covers (x, y) in model space —
// point-in-triangle over the non-indexed position stream.
function faceCoversPoint(
  geometry: ExtrudeGeometry,
  direction: 1 | -1,
  x: number,
  y: number,
): boolean {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let vertex = 0; vertex < position.count; vertex += 3) {
    if (normal.getZ(vertex) * direction < 0.5) continue;
    const ax = position.getX(vertex);
    const ay = position.getY(vertex);
    const bx = position.getX(vertex + 1);
    const by = position.getY(vertex + 1);
    const cx = position.getX(vertex + 2);
    const cy = position.getY(vertex + 2);
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNegative && hasPositive)) return true;
  }
  return false;
}

function holeLoopBounds(shape: ReturnType<typeof createPreviewBoardShape>, index: number) {
  const points = shape.holes[index].getPoints(64);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    centerX: (Math.max(...xs) + Math.min(...xs)) / 2,
    centerY: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('preview PCB board model', () => {
  it('extrudes exact millimeter dimensions with normal-consistent front, edge, and back groups', () => {
    const source = snapshot(1);
    const model = createPreviewBoardModel(source);
    const { geometry } = model.mesh;

    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.x).toBeCloseTo(-30, 10);
    expect(geometry.boundingBox!.max.x).toBeCloseTo(30, 10);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-64.25, 10);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(64.25, 10);
    expect(geometry.boundingBox!.min.z).toBeCloseTo(-1.25, 10);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(1.25, 10);
    expect(geometry.userData.previewDimensions).toEqual({
      widthMm: 60,
      heightMm: 128.5,
      thicknessMm: 2.5,
    });

    // Groups tile the whole non-indexed vertex stream gaplessly, carry all
    // four material slots, and each triangle's slot matches its face normal
    // and position: +z front, −z back, outline walls side, interior walls
    // (drilled barrels) the hole-wall slot.
    const groups = [...geometry.groups].sort((a, b) => a.start - b.start);
    const normal = geometry.attributes.normal;
    const position = geometry.attributes.position;
    let cursor = 0;
    for (const group of groups) {
      expect(group.start).toBe(cursor);
      cursor += group.count;
    }
    expect(cursor).toBe(position.count);
    expect(new Set(groups.map((group) => group.materialIndex))).toEqual(
      new Set([
        PREVIEW_FRONT_MATERIAL_INDEX,
        PREVIEW_SIDE_MATERIAL_INDEX,
        PREVIEW_BACK_MATERIAL_INDEX,
        PREVIEW_HOLE_WALL_MATERIAL_INDEX,
      ]),
    );
    for (const group of groups) {
      for (let offset = 0; offset < group.count; offset += 3) {
        const vertex = group.start + offset;
        const nz = normal.getZ(vertex);
        let expected: number;
        if (nz > 0.5) expected = PREVIEW_FRONT_MATERIAL_INDEX;
        else if (nz < -0.5) expected = PREVIEW_BACK_MATERIAL_INDEX;
        else {
          const centroidX =
            (position.getX(vertex) + position.getX(vertex + 1) + position.getX(vertex + 2)) / 3;
          const centroidY =
            (position.getY(vertex) + position.getY(vertex + 1) + position.getY(vertex + 2)) / 3;
          const onOutline =
            Math.abs(Math.abs(centroidX) - 30) < 1e-6 ||
            Math.abs(Math.abs(centroidY) - 64.25) < 1e-6;
          expected = onOutline ? PREVIEW_SIDE_MATERIAL_INDEX : PREVIEW_HOLE_WALL_MATERIAL_INDEX;
        }
        expect(group.materialIndex).toBe(expected);
      }
    }
    expect(PREVIEW_FRONT_FACE_ORIENTATION.outwardNormal).toBe('+z');
    model.dispose();
  });

  it('pins the UV orientation contract on both regenerated faces', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const { geometry } = model.mesh;
    const uv = geometry.attributes.uv;

    // Front face: document top-left = model (−30, 64.25, +1.25) → uv (0, 1).
    const frontTopLeft = faceVertexAt(geometry, 1, -30, 64.25, 1.25);
    const frontBottomRight = faceVertexAt(geometry, 1, 30, -64.25, 1.25);
    expect([uv.getX(frontTopLeft), uv.getY(frontTopLeft)]).toEqual([0, 1]);
    expect([uv.getX(frontBottomRight), uv.getY(frontBottomRight)]).toEqual([1, 0]);
    expect(PREVIEW_FRONT_FACE_ORIENTATION.documentTopLeftUv).toEqual({ u: 0, v: 1 });

    // Back face: document top-left lands at raw uv (1, 1); the mirrored
    // sampling transform (PREVIEW_BACK_TEXTURE_MIRROR) maps it back onto the
    // canonically painted canvas's top-left.
    const backTopLeft = faceVertexAt(geometry, -1, -30, 64.25, -1.25);
    const backBottomRight = faceVertexAt(geometry, -1, 30, -64.25, -1.25);
    expect([uv.getX(backTopLeft), uv.getY(backTopLeft)]).toEqual([1, 1]);
    expect([uv.getX(backBottomRight), uv.getY(backBottomRight)]).toEqual([0, 0]);
    expect(PREVIEW_BACK_FACE_ORIENTATION.documentTopLeftUv).toEqual({ u: 1, v: 1 });
    model.dispose();
  });

  it('cuts one hole loop per catalog entry: circles for round, stadiums for slots', () => {
    const shapeFor = (format: '1U' | '3U', hp: number) =>
      createPreviewBoardShape(
        {
          widthMm: panelWidthMm(hp),
          heightMm: panelHeightMm(format),
          thicknessMm: PANEL_THICKNESS_MM,
        },
        panelHoles(format, hp),
      );

    // 3U/1hp: two round holes, loop bbox = drill diameter both ways.
    const roundShape = shapeFor('3U', 1);
    expect(roundShape.holes).toHaveLength(2);
    for (const index of [0, 1]) {
      const bounds = holeLoopBounds(roundShape, index);
      expect(bounds.width).toBeCloseTo(3.2, 2);
      expect(bounds.height).toBeCloseTo(3.2, 2);
    }

    // 3U/12hp: four slots, stadium bbox = slotLength × drill diameter.
    const fourSlotShape = shapeFor('3U', 12);
    expect(fourSlotShape.holes).toHaveLength(4);
    for (const index of [0, 1, 2, 3]) {
      const bounds = holeLoopBounds(fourSlotShape, index);
      expect(bounds.width).toBeCloseTo(10.28, 2);
      expect(bounds.height).toBeCloseTo(3.2, 2);
    }

    // Loop centers sit at the catalog position mapped into centered model
    // space (+y up): 1U/4hp keeps its deliberate bottom-row asymmetry.
    const oneUShape = shapeFor('1U', 4);
    expect(oneUShape.holes).toHaveLength(2);
    const width = panelWidthMm(4);
    const height = panelHeightMm('1U');
    const [top, bottom] = panelHoles('1U', 4);
    expect(holeLoopBounds(oneUShape, 0).centerX).toBeCloseTo(top.cx - width / 2, 6);
    expect(holeLoopBounds(oneUShape, 0).centerY).toBeCloseTo(height / 2 - top.cy, 6);
    expect(holeLoopBounds(oneUShape, 1).centerX).toBeCloseTo(bottom.cx - width / 2, 6);
    expect(holeLoopBounds(oneUShape, 1).centerY).toBeCloseTo(height / 2 - bottom.cy, 6);
  });

  it('plates FR-4 barrels gold against the pinned laminate edge, and bares alumi barrels', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const barrel = model.mesh.material[PREVIEW_HOLE_WALL_MATERIAL_INDEX];
    const side = model.mesh.material[PREVIEW_SIDE_MATERIAL_INDEX];

    // PTH plating (epic decision 11): the barrel reads as the shared gold
    // authority, while the outer routed edge keeps the laminate regression
    // pin — two different slots by design.
    expect(PREVIEW_FR4_HOLE_WALL_MATERIAL_PARAMETERS.metalness).toBe(1);
    expect(barrel.color.getHex()).toBe(PREVIEW_FR4_HOLE_WALL_MATERIAL_PARAMETERS.color);
    expect(barrel.metalness).toBe(PREVIEW_FR4_HOLE_WALL_MATERIAL_PARAMETERS.metalness);
    expect(barrel.roughness).toBe(PREVIEW_FR4_HOLE_WALL_MATERIAL_PARAMETERS.roughness);
    expect(barrel.envMapIntensity).toBe(PREVIEW_ENVIRONMENT_INTENSITY);
    expect(side.color.getHex()).toBe(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.color);
    expect(barrel.color.getHex()).not.toBe(side.color.getHex());

    // NPTH alumi barrels retarget the same slot to the bare-metal edge look.
    model.applySnapshot(snapshot(2, undefined, 'alumi'));
    expect(barrel.color.getHex()).toBe(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.color);
    expect(barrel.metalness).toBe(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.metalness);
    expect(barrel.roughness).toBe(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.roughness);
    model.dispose();
  });

  it('cuts drill interiors out of both faces so artwork there is never sampled', () => {
    const geometry = createPreviewBoardGeometry(
      { widthMm: 60, heightMm: 128.5, thicknessMm: 2.5 },
      FIXTURE_HOLES,
    );
    // FIXTURE slot at canonical (10.16, 3) → model (−19.84, 61.25).
    const holeCenterX = 10.16 - 30;
    const holeCenterY = 64.25 - 3;
    for (const direction of [1, -1] as const) {
      // Slot center and an end-cap interior point are cut on both lids…
      expect(faceCoversPoint(geometry, direction, holeCenterX, holeCenterY)).toBe(false);
      expect(faceCoversPoint(geometry, direction, holeCenterX + 3.54, holeCenterY)).toBe(false);
      // …while the panel face right outside the slot stays solid.
      expect(faceCoversPoint(geometry, direction, holeCenterX, holeCenterY - 3)).toBe(true);
      expect(faceCoversPoint(geometry, direction, holeCenterX - 6.5, holeCenterY)).toBe(true);
    }
    geometry.dispose();
  });

  it('assigns sRGB only to base color and keeps scalar material masks linear', () => {
    const textures = createPreviewTextureSet(snapshot(1).maps);
    expect(textures.baseColor.colorSpace).toBe(SRGBColorSpace);
    expect(textures.metalness.colorSpace).toBe(NoColorSpace);
    expect(textures.roughness.colorSpace).toBe(NoColorSpace);
    expect(textures.height.colorSpace).toBe(NoColorSpace);
    expect(Object.values(textures).every((texture) => texture.flipY)).toBe(true);
    // A front set keeps three.js's identity texture transform.
    expect(Object.values(textures).every((texture) => texture.repeat.x === 1)).toBe(true);
    for (const texture of Object.values(textures)) texture.dispose();
  });

  it('keeps the front opaque and pins the FR-4 look: gold params, laminate edge, textured back', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const front = model.mesh.material[PREVIEW_FRONT_MATERIAL_INDEX];
    const side = model.mesh.material[PREVIEW_SIDE_MATERIAL_INDEX];
    const back = model.mesh.material[PREVIEW_BACK_MATERIAL_INDEX];

    expect(front.transparent).toBe(false);
    expect(front.opacity).toBe(1);
    expect(front.metalness).toBe(1);
    expect(front.roughness).toBe(1);
    expect(front.envMapIntensity).toBe(PREVIEW_ENVIRONMENT_INTENSITY);
    expect(front.bumpMap).toBe(model.textures.height);
    expect(front.bumpScale).toBe(PREVIEW_BUMP_SCALE);
    expect(PREVIEW_GOLD_MATERIAL_PARAMETERS.bumpScale).toBe(PREVIEW_BUMP_SCALE);
    expect(PREVIEW_GOLD_MATERIAL_PARAMETERS.metalness).toBeGreaterThanOrEqual(0.9);
    expect(PREVIEW_GOLD_MATERIAL_PARAMETERS.roughness).toBeGreaterThanOrEqual(0.15);
    expect(PREVIEW_GOLD_MATERIAL_PARAMETERS.roughness).toBeLessThanOrEqual(0.4);

    // FR-4 regression pins (#232): the pre-existing laminate edge must not
    // drift, and the back face now hosts the back map set.
    expect(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS).toEqual({
      color: 0x8a723c,
      metalness: 0,
      roughness: 0.62,
      envMapIntensity: 0.7,
    });
    expect(side.map).toBeNull();
    expect(side.color.getHex()).toBe(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.color);
    expect(side.metalness).toBe(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.metalness);
    expect(side.roughness).toBe(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.roughness);
    expect(side.envMapIntensity).toBe(PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.envMapIntensity);

    expect(model.backTextures).not.toBeNull();
    expect(back.map).toBe(model.backTextures!.baseColor);
    expect(back.metalnessMap).toBe(model.backTextures!.metalness);
    expect(back.roughnessMap).toBe(model.backTextures!.roughness);
    expect(back.bumpMap).toBe(model.backTextures!.height);
    expect(back.metalness).toBe(1);
    expect(back.roughness).toBe(1);
    expect(back.bumpScale).toBe(PREVIEW_BUMP_SCALE);
    expect(back.envMapIntensity).toBe(PREVIEW_ENVIRONMENT_INTENSITY);
    model.dispose();
  });

  it('mirrors back textures in u per the back-face orientation contract', () => {
    const model = createPreviewBoardModel(snapshot(1));
    expect(PREVIEW_BACK_TEXTURE_MIRROR).toEqual({ repeatX: -1, centerX: 0.5 });
    for (const texture of Object.values(model.backTextures!)) {
      expect(texture.repeat.x).toBe(PREVIEW_BACK_TEXTURE_MIRROR.repeatX);
      expect(texture.center.x).toBe(PREVIEW_BACK_TEXTURE_MIRROR.centerX);
      expect(texture.flipY).toBe(true);
    }
    // Front textures stay unmirrored.
    for (const texture of Object.values(model.textures)) {
      expect(texture.repeat.x).toBe(1);
    }
    model.dispose();
  });

  it('turns the edges and back into polished bare metal for an alumi document', () => {
    const model = createPreviewBoardModel(snapshot(1, undefined, 'alumi'));
    const side = model.mesh.material[PREVIEW_SIDE_MATERIAL_INDEX];
    const back = model.mesh.material[PREVIEW_BACK_MATERIAL_INDEX];

    // The "shining gray" contract: full metalness, low roughness, and the
    // full environment intensity so the metal actually picks up reflections.
    expect(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.metalness).toBe(1);
    expect(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.roughness).toBeLessThanOrEqual(0.35);
    expect(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.metalness).toBe(1);
    expect(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.roughness).toBeLessThanOrEqual(0.25);
    expect(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.envMapIntensity).toBe(
      PREVIEW_ENVIRONMENT_INTENSITY,
    );
    expect(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.envMapIntensity).toBe(
      PREVIEW_ENVIRONMENT_INTENSITY,
    );
    // Color feeds from the shared substrate authority (PCB_SUBSTRATE_ALUMI
    // #b3b6ba), never a second hardcoded aluminum hex.
    expect(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.color).toBe(0xb3b6ba);
    expect(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.color).toBe(0xb3b6ba);

    expect(model.backTextures).toBeNull();
    expect(side.color.getHex()).toBe(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.color);
    expect(side.metalness).toBe(1);
    expect(side.roughness).toBe(PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.roughness);
    expect(back.map).toBeNull();
    expect(back.metalnessMap).toBeNull();
    expect(back.roughnessMap).toBeNull();
    expect(back.bumpMap).toBeNull();
    expect(back.color.getHex()).toBe(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.color);
    expect(back.metalness).toBe(1);
    expect(back.roughness).toBe(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.roughness);
    model.dispose();
  });

  it('retargets the same material slots when the document material switches', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const materials = model.mesh.material;
    const fr4BackTextures = model.backTextures!;
    const backDisposals = Object.values(fr4BackTextures).map((texture) =>
      vi.spyOn(texture, 'dispose'),
    );

    model.applySnapshot(snapshot(2, undefined, 'alumi'));
    expect(model.mesh.material).toBe(materials);
    expect(model.backTextures).toBeNull();
    for (const dispose of backDisposals) expect(dispose).toHaveBeenCalledOnce();
    const back = materials[PREVIEW_BACK_MATERIAL_INDEX];
    expect(back.map).toBeNull();
    expect(back.metalness).toBe(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.metalness);
    expect(materials[PREVIEW_SIDE_MATERIAL_INDEX].color.getHex()).toBe(
      PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS.color,
    );

    model.applySnapshot(snapshot(3));
    expect(model.backTextures).not.toBeNull();
    expect(back.map).toBe(model.backTextures!.baseColor);
    expect(back.metalness).toBe(1);
    expect(back.roughness).toBe(1);
    expect(materials[PREVIEW_SIDE_MATERIAL_INDEX].color.getHex()).toBe(
      PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS.color,
    );
    model.dispose();
  });

  it('swaps and disposes textures without rebuilding geometry for a surface-only update', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const geometry = model.mesh.geometry;
    const oldTextures = model.textures;
    const oldBackTextures = model.backTextures!;
    const disposals = [...Object.values(oldTextures), ...Object.values(oldBackTextures)].map(
      (texture) => vi.spyOn(texture, 'dispose'),
    );

    expect(model.applySnapshot(snapshot(2))).toEqual({ dimensionsChanged: false });
    expect(model.mesh.geometry).toBe(geometry);
    expect(model.surfaceRevision).toBe(2);
    expect(model.mesh.material[0].map).toBe(model.textures.baseColor);
    expect(model.mesh.material[0].bumpMap).toBe(model.textures.height);
    expect(model.mesh.material[PREVIEW_BACK_MATERIAL_INDEX].map).toBe(
      model.backTextures!.baseColor,
    );
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    model.dispose();
  });

  it('replaces and disposes geometry only when physical dimensions change', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const originalGeometry = model.mesh.geometry;
    const dispose = vi.spyOn(originalGeometry, 'dispose');

    expect(
      model.applySnapshot(snapshot(2, { widthMm: 80, heightMm: 128.5, thicknessMm: 2.5 })),
    ).toEqual({ dimensionsChanged: true });
    expect(model.mesh.geometry).not.toBe(originalGeometry);
    expect(dispose).toHaveBeenCalledOnce();
    expect(model.dimensions).toEqual({ widthMm: 80, heightMm: 128.5, thicknessMm: 2.5 });
    model.dispose();
  });

  it('rebuilds geometry when the hole catalog changes at identical dimensions', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const originalGeometry = model.mesh.geometry;
    const dispose = vi.spyOn(originalGeometry, 'dispose');
    const movedHoles: readonly PanelHole[] = [
      ...FIXTURE_HOLES,
      { cx: 50, cy: 125.5, shape: 'round', drillDiameter: 3.2, opening: { width: 4, length: 4 } },
    ];

    // Same dims + moved holes rebuilds the cut without a camera refit signal.
    expect(model.applySnapshot(snapshot(2, undefined, 'fr4', movedHoles))).toEqual({
      dimensionsChanged: false,
    });
    expect(model.mesh.geometry).not.toBe(originalGeometry);
    expect(dispose).toHaveBeenCalledOnce();
    // A value-equal hole list (fresh array identity per snapshot) does not.
    const rebuiltGeometry = model.mesh.geometry;
    expect(model.applySnapshot(snapshot(3, undefined, 'fr4', [...movedHoles]))).toEqual({
      dimensionsChanged: false,
    });
    expect(model.mesh.geometry).toBe(rebuiltGeometry);
    model.dispose();
  });

  it('disposes geometry, materials, and currently owned textures exactly once', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const geometryDispose = vi.spyOn(model.mesh.geometry, 'dispose');
    const materialDisposals = model.mesh.material.map((material) => vi.spyOn(material, 'dispose'));
    const textureDisposals = [
      ...Object.values(model.textures),
      ...Object.values(model.backTextures!),
    ].map((texture) => vi.spyOn(texture, 'dispose'));

    model.dispose();
    model.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('continues final teardown when an earlier owned disposer throws', () => {
    const model = createPreviewBoardModel(snapshot(1));
    vi.spyOn(model.mesh.geometry, 'dispose').mockImplementation(() => {
      throw new Error('geometry dispose failed');
    });
    const materialDisposals = model.mesh.material.map((material) => vi.spyOn(material, 'dispose'));
    const textureDisposals = [
      ...Object.values(model.textures),
      ...Object.values(model.backTextures!),
    ].map((texture) => vi.spyOn(texture, 'dispose'));

    expect(() => model.dispose()).not.toThrow();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledOnce();
  });
});
