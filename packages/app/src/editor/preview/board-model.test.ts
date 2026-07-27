import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoColorSpace, SRGBColorSpace } from 'three';
import type { PcbMaterial } from '@zpd/core';
import {
  PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS,
  PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS,
  PREVIEW_BACK_MATERIAL_INDEX,
  PREVIEW_BACK_TEXTURE_MIRROR,
  PREVIEW_BUMP_SCALE,
  PREVIEW_ENVIRONMENT_INTENSITY,
  PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS,
  PREVIEW_FRONT_MATERIAL_INDEX,
  PREVIEW_GOLD_MATERIAL_PARAMETERS,
  PREVIEW_SIDE_MATERIAL_INDEX,
  createPreviewBoardModel,
  createPreviewTextureSet,
} from './board-model';
import {
  PREVIEW_FRONT_FACE_ORIENTATION,
  createPreviewSurfaceSnapshot,
  type PreviewCanvasSource,
  type PreviewSurfaceSnapshot,
} from './contracts';

const FIXTURE_HOLES = [
  {
    cx: 10.16,
    cy: 3,
    shape: 'slot',
    drillDiameter: 3.2,
    slotLength: 10.28,
    opening: { width: 4, length: 11.08 },
  },
] as const;

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
): PreviewSurfaceSnapshot {
  return createPreviewSurfaceSnapshot({
    surfaceRevision,
    material,
    ...dimensions,
    holes: FIXTURE_HOLES,
    rasterSize: {
      widthPx: 120,
      heightPx: 257,
      effectivePixelsPerMm: Math.min(120 / dimensions.widthMm, 257 / dimensions.heightMm),
    },
    canvases: canvasSet(),
    backCanvases: material === 'alumi' ? null : canvasSet(),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('preview PCB board model', () => {
  it('uses exact millimeter dimensions and distinct +z front, edge, and back groups', () => {
    const source = snapshot(1);
    const model = createPreviewBoardModel(source);
    const { geometry } = model.mesh;

    expect(geometry.parameters).toMatchObject({ width: 60, height: 128.5, depth: 2.5 });
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([
      PREVIEW_SIDE_MATERIAL_INDEX,
      PREVIEW_SIDE_MATERIAL_INDEX,
      PREVIEW_SIDE_MATERIAL_INDEX,
      PREVIEW_SIDE_MATERIAL_INDEX,
      PREVIEW_FRONT_MATERIAL_INDEX,
      PREVIEW_BACK_MATERIAL_INDEX,
    ]);

    const frontGroup = geometry.groups.find(
      (group) => group.materialIndex === PREVIEW_FRONT_MATERIAL_INDEX,
    );
    const index = geometry.index;
    const normal = geometry.attributes.normal;
    expect(frontGroup).toBeTruthy();
    expect(index).toBeTruthy();
    for (let offset = 0; offset < frontGroup!.count; offset += 1) {
      expect(normal.getZ(index!.getX(frontGroup!.start + offset))).toBe(1);
    }
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const topLeftVertex = Array.from({ length: position.count }, (_, vertex) => vertex).find(
      (vertex) =>
        position.getX(vertex) === -30 &&
        position.getY(vertex) === 64.25 &&
        position.getZ(vertex) === 1.25 &&
        normal.getZ(vertex) === 1,
    );
    expect(topLeftVertex).toBeDefined();
    expect([uv.getX(topLeftVertex!), uv.getY(topLeftVertex!)]).toEqual([0, 1]);
    expect(PREVIEW_FRONT_FACE_ORIENTATION.outwardNormal).toBe('+z');
    model.dispose();
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
