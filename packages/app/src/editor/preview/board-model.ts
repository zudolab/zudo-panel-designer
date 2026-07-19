import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
} from 'three';
import {
  disposePreviewTextureSet,
  swapPreviewTextureSet,
  type PreviewCanvasSource,
  type PreviewPhysicalDimensions,
  type PreviewSurfaceSnapshot,
  type PreviewTextureSet,
} from './contracts';
import { PCB_SURFACE_MATERIALS } from './surface-maps';

export const PREVIEW_FRONT_MATERIAL_INDEX = 0;
export const PREVIEW_SIDE_MATERIAL_INDEX = 1;
export const PREVIEW_BACK_MATERIAL_INDEX = 2;
export const PREVIEW_ENVIRONMENT_INTENSITY = 1.35;

export const PREVIEW_GOLD_MATERIAL_PARAMETERS = Object.freeze({
  metalness: PCB_SURFACE_MATERIALS[1].metalness,
  roughness: PCB_SURFACE_MATERIALS[1].roughness,
  environmentIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
});

export type PreviewCanvasTexture = CanvasTexture<PreviewCanvasSource>;

export interface PreviewBoardModel {
  readonly mesh: Mesh<BoxGeometry, MeshStandardMaterial[]>;
  readonly dimensions: PreviewPhysicalDimensions;
  readonly surfaceRevision: number;
  readonly textures: PreviewTextureSet<PreviewCanvasTexture>;
  applySnapshot(snapshot: PreviewSurfaceSnapshot): { readonly dimensionsChanged: boolean };
  dispose(): void;
}

function disposeAllSafely(disposers: Iterable<() => void>): void {
  for (const dispose of disposers) {
    try {
      dispose();
    } catch {
      // Teardown continues across independently owned GPU resources.
    }
  }
}

function sameDimensions(a: PreviewPhysicalDimensions, b: PreviewPhysicalDimensions): boolean {
  return a.widthMm === b.widthMm && a.heightMm === b.heightMm && a.thicknessMm === b.thicknessMm;
}

export function createPreviewBoardGeometry(dimensions: PreviewPhysicalDimensions): BoxGeometry {
  const geometry = new BoxGeometry(dimensions.widthMm, dimensions.heightMm, dimensions.thicknessMm);

  // BoxGeometry creates +x, -x, +y, -y, +z, -z groups in that order.
  // Preserve the group ranges while collapsing them into front/side/back
  // material ownership. Only +z receives the generated front artwork.
  for (const group of geometry.groups) {
    if (group.materialIndex === 4) group.materialIndex = PREVIEW_FRONT_MATERIAL_INDEX;
    else if (group.materialIndex === 5) group.materialIndex = PREVIEW_BACK_MATERIAL_INDEX;
    else group.materialIndex = PREVIEW_SIDE_MATERIAL_INDEX;
  }
  geometry.userData.previewDimensions = Object.freeze({ ...dimensions });
  return geometry;
}

export function createPreviewTextureSet(
  snapshot: PreviewSurfaceSnapshot,
): PreviewTextureSet<PreviewCanvasTexture> {
  const owned: PreviewCanvasTexture[] = [];
  try {
    const baseColor = new CanvasTexture<PreviewCanvasSource>(snapshot.maps.baseColor.source);
    owned.push(baseColor);
    const metalness = new CanvasTexture<PreviewCanvasSource>(snapshot.maps.metalness.source);
    owned.push(metalness);
    const roughness = new CanvasTexture<PreviewCanvasSource>(snapshot.maps.roughness.source);
    owned.push(roughness);

    baseColor.colorSpace = SRGBColorSpace;
    metalness.colorSpace = NoColorSpace;
    roughness.colorSpace = NoColorSpace;
    for (const texture of owned) {
      texture.flipY = true;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
    }

    return Object.freeze({ baseColor, metalness, roughness });
  } catch (error) {
    disposeAllSafely(owned.map((texture) => () => texture.dispose()));
    throw error;
  }
}

export function createPreviewBoardMaterials(
  textures: PreviewTextureSet<Texture>,
): MeshStandardMaterial[] {
  const owned: MeshStandardMaterial[] = [];
  try {
    const front = new MeshStandardMaterial({
      color: 0xffffff,
      map: textures.baseColor,
      metalness: 1,
      metalnessMap: textures.metalness,
      roughness: 1,
      roughnessMap: textures.roughness,
      envMapIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
      transparent: false,
      opacity: 1,
    });
    owned.push(front);
    const side = new MeshStandardMaterial({
      color: 0x8a723c,
      metalness: 0,
      roughness: 0.62,
      envMapIntensity: 0.7,
    });
    owned.push(side);
    const back = new MeshStandardMaterial({
      color: 0x11120f,
      metalness: 0,
      roughness: 0.68,
      envMapIntensity: 0.8,
    });
    owned.push(back);
    return owned;
  } catch (error) {
    disposeAllSafely(owned.map((material) => () => material.dispose()));
    throw error;
  }
}

function installTextures(front: MeshStandardMaterial, textures: PreviewTextureSet<Texture>): void {
  front.map = textures.baseColor;
  front.metalnessMap = textures.metalness;
  front.roughnessMap = textures.roughness;
  front.needsUpdate = true;
}

export function createPreviewBoardModel(snapshot: PreviewSurfaceSnapshot): PreviewBoardModel {
  let dimensions = Object.freeze({ ...snapshot.physicalDimensions });
  let surfaceRevision = snapshot.surfaceRevision;
  let textures = createPreviewTextureSet(snapshot);
  try {
    const materials = createPreviewBoardMaterials(textures);
    try {
      const geometry = createPreviewBoardGeometry(dimensions);
      let mesh: Mesh<BoxGeometry, MeshStandardMaterial[]>;
      try {
        mesh = new Mesh(geometry, materials);
      } catch (error) {
        disposeAllSafely([() => geometry.dispose()]);
        throw error;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let disposed = false;

      const model: PreviewBoardModel = {
        mesh,
        get dimensions() {
          return dimensions;
        },
        get surfaceRevision() {
          return surfaceRevision;
        },
        get textures() {
          return textures;
        },
        applySnapshot(nextSnapshot) {
          if (disposed) throw new Error('Preview board model is disposed');
          const replacementTextures = createPreviewTextureSet(nextSnapshot);
          textures = swapPreviewTextureSet(textures, replacementTextures, (replacement) => {
            installTextures(materials[PREVIEW_FRONT_MATERIAL_INDEX], replacement);
          });

          const dimensionsChanged = !sameDimensions(dimensions, nextSnapshot.physicalDimensions);
          if (dimensionsChanged) {
            const replacementGeometry = createPreviewBoardGeometry(nextSnapshot.physicalDimensions);
            const previousGeometry = mesh.geometry;
            mesh.geometry = replacementGeometry;
            disposeAllSafely([() => previousGeometry.dispose()]);
            dimensions = Object.freeze({ ...nextSnapshot.physicalDimensions });
          }
          surfaceRevision = nextSnapshot.surfaceRevision;
          return Object.freeze({ dimensionsChanged });
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          disposeAllSafely([
            () => mesh.removeFromParent(),
            () => mesh.geometry.dispose(),
            ...materials.map((material) => () => material.dispose()),
            () => disposePreviewTextureSet(textures),
          ]);
        },
      };

      return Object.freeze(model);
    } catch (error) {
      disposeAllSafely(materials.map((material) => () => material.dispose()));
      throw error;
    }
  } catch (error) {
    disposePreviewTextureSet(textures);
    throw error;
  }
}
