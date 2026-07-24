import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoColorSpace, SRGBColorSpace } from 'three';
import {
  PREVIEW_BACK_MATERIAL_INDEX,
  PREVIEW_BUMP_SCALE,
  PREVIEW_ENVIRONMENT_INTENSITY,
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

function canvas(width = 120, height = 257): PreviewCanvasSource {
  return { width, height } as PreviewCanvasSource;
}

function snapshot(
  surfaceRevision: number,
  dimensions = { widthMm: 60, heightMm: 128.5, thicknessMm: 2.5 },
): PreviewSurfaceSnapshot {
  return createPreviewSurfaceSnapshot({
    surfaceRevision,
    ...dimensions,
    rasterSize: {
      widthPx: 120,
      heightPx: 257,
      effectivePixelsPerMm: Math.min(120 / dimensions.widthMm, 257 / dimensions.heightMm),
    },
    canvases: { baseColor: canvas(), metalness: canvas(), roughness: canvas(), height: canvas() },
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
    const textures = createPreviewTextureSet(snapshot(1));
    expect(textures.baseColor.colorSpace).toBe(SRGBColorSpace);
    expect(textures.metalness.colorSpace).toBe(NoColorSpace);
    expect(textures.roughness.colorSpace).toBe(NoColorSpace);
    expect(textures.height.colorSpace).toBe(NoColorSpace);
    expect(Object.values(textures).every((texture) => texture.flipY)).toBe(true);
    for (const texture of Object.values(textures)) texture.dispose();
  });

  it('keeps the front opaque and exposes physically distinct gold, black, and white values', () => {
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
    expect(side.map).toBeNull();
    expect(side.metalness).toBe(0);
    expect(back.map).toBeNull();
    expect(back.metalness).toBe(0);
    model.dispose();
  });

  it('swaps and disposes textures without rebuilding geometry for a surface-only update', () => {
    const model = createPreviewBoardModel(snapshot(1));
    const geometry = model.mesh.geometry;
    const oldTextures = model.textures;
    const disposals = Object.values(oldTextures).map((texture) => vi.spyOn(texture, 'dispose'));

    expect(model.applySnapshot(snapshot(2))).toEqual({ dimensionsChanged: false });
    expect(model.mesh.geometry).toBe(geometry);
    expect(model.surfaceRevision).toBe(2);
    expect(model.mesh.material[0].map).toBe(model.textures.baseColor);
    expect(model.mesh.material[0].bumpMap).toBe(model.textures.height);
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
    const textureDisposals = Object.values(model.textures).map((texture) =>
      vi.spyOn(texture, 'dispose'),
    );

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
    const textureDisposals = Object.values(model.textures).map((texture) =>
      vi.spyOn(texture, 'dispose'),
    );

    expect(() => model.dispose()).not.toThrow();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of textureDisposals) expect(dispose).toHaveBeenCalledOnce();
  });
});
