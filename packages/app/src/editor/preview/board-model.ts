import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { PcbMaterial } from '@zpd/core';
import {
  disposePreviewTextureSet,
  swapPreviewTextureSet,
  type PreviewCanvasSource,
  type PreviewPhysicalDimensions,
  type PreviewSurfaceMaps,
  type PreviewSurfaceSnapshot,
  type PreviewTextureSet,
} from './contracts';
import { PCB_SUBSTRATE_SURFACE_MATERIALS, PCB_SURFACE_MATERIALS } from './surface-maps';

export const PREVIEW_FRONT_MATERIAL_INDEX = 0;
export const PREVIEW_SIDE_MATERIAL_INDEX = 1;
export const PREVIEW_BACK_MATERIAL_INDEX = 2;
export const PREVIEW_ENVIRONMENT_INTENSITY = 1.35;

// Bump strength for the combined height map (epic #176). Board world units
// are millimeters, and the height field spans 0..~1 (substrate..mask over
// copper), so 0.3 reads as an exaggerated ~0.2-0.4 mm copper emboss under
// the draping mask. Tune this single constant to calibrate visually — bump
// perturbs shading normals only, never silhouette geometry.
export const PREVIEW_BUMP_SCALE = 0.3;

export const PREVIEW_GOLD_MATERIAL_PARAMETERS = Object.freeze({
  metalness: PCB_SURFACE_MATERIALS[1].metalness,
  roughness: PCB_SURFACE_MATERIALS[1].roughness,
  environmentIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
  bumpScale: PREVIEW_BUMP_SCALE,
});

function materialColorHex(cssHex: string): number {
  return Number.parseInt(cssHex.slice(1), 16);
}

// FR-4's routed laminate edge — pinned pre-#232 values, a regression
// contract: existing FR-4 documents must render exactly as before.
export const PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS = Object.freeze({
  color: 0x8a723c,
  metalness: 0,
  roughness: 0.62,
  envMapIntensity: 0.7,
});

// Alumi edge and back: polished bare metal, color fed from the shared
// substrate authority (never a second hardcoded aluminum hex). The milled
// edge is slightly duller than the big showcase back face. Tune roughness
// here to calibrate how hard the aluminum shines.
export const PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS = Object.freeze({
  color: materialColorHex(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi.baseColor),
  metalness: 1,
  roughness: 0.3,
  envMapIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
});

export const PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS = Object.freeze({
  color: materialColorHex(PCB_SUBSTRATE_SURFACE_MATERIALS.alumi.baseColor),
  metalness: 1,
  roughness: 0.2,
  envMapIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
});

// Implements contracts.PREVIEW_BACK_FACE_ORIENTATION: with the texture
// transform mirrored around u = 0.5 the back face samples u' = 1 − u, so
// canonically painted back artwork lands at its true physical x and the
// back display mirrors like every 2D back-side consumer (width − x).
export const PREVIEW_BACK_TEXTURE_MIRROR = Object.freeze({ repeatX: -1, centerX: 0.5 });

export type PreviewCanvasTexture = CanvasTexture<PreviewCanvasSource>;

export interface PreviewBoardModel {
  readonly mesh: Mesh<BoxGeometry, MeshStandardMaterial[]>;
  readonly dimensions: PreviewPhysicalDimensions;
  readonly surfaceRevision: number;
  readonly textures: PreviewTextureSet<PreviewCanvasTexture>;
  readonly backTextures: PreviewTextureSet<PreviewCanvasTexture> | null;
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
  maps: PreviewSurfaceMaps,
  options: { readonly mirrorX?: boolean } = {},
): PreviewTextureSet<PreviewCanvasTexture> {
  const owned: PreviewCanvasTexture[] = [];
  try {
    const baseColor = new CanvasTexture<PreviewCanvasSource>(maps.baseColor.source);
    owned.push(baseColor);
    const metalness = new CanvasTexture<PreviewCanvasSource>(maps.metalness.source);
    owned.push(metalness);
    const roughness = new CanvasTexture<PreviewCanvasSource>(maps.roughness.source);
    owned.push(roughness);
    const height = new CanvasTexture<PreviewCanvasSource>(maps.height.source);
    owned.push(height);

    baseColor.colorSpace = SRGBColorSpace;
    metalness.colorSpace = NoColorSpace;
    roughness.colorSpace = NoColorSpace;
    height.colorSpace = NoColorSpace;
    for (const texture of owned) {
      texture.flipY = true;
      texture.generateMipmaps = true;
      if (options.mirrorX) {
        texture.center.x = PREVIEW_BACK_TEXTURE_MIRROR.centerX;
        texture.repeat.x = PREVIEW_BACK_TEXTURE_MIRROR.repeatX;
      }
      texture.needsUpdate = true;
    }

    return Object.freeze({ baseColor, metalness, roughness, height });
  } catch (error) {
    disposeAllSafely(owned.map((texture) => () => texture.dispose()));
    throw error;
  }
}

// (Re)targets the edge and back materials at one document material's look.
// FR-4 keeps its pinned laminate edge and textures the back from the back
// map set; alumi (backTextures null, enforced by the snapshot contract)
// turns both into polished bare metal.
function configureEdgeAndBackMaterials(
  side: MeshStandardMaterial,
  back: MeshStandardMaterial,
  material: PcbMaterial,
  backTextures: PreviewTextureSet<Texture> | null,
): void {
  const edge =
    material === 'alumi'
      ? PREVIEW_ALUMI_EDGE_MATERIAL_PARAMETERS
      : PREVIEW_FR4_EDGE_MATERIAL_PARAMETERS;
  side.color.setHex(edge.color);
  side.metalness = edge.metalness;
  side.roughness = edge.roughness;
  side.envMapIntensity = edge.envMapIntensity;
  side.needsUpdate = true;

  if (backTextures) {
    back.color.setHex(0xffffff);
    back.map = backTextures.baseColor;
    back.metalness = 1;
    back.metalnessMap = backTextures.metalness;
    back.roughness = 1;
    back.roughnessMap = backTextures.roughness;
    back.bumpMap = backTextures.height;
    back.bumpScale = PREVIEW_BUMP_SCALE;
    back.envMapIntensity = PREVIEW_ENVIRONMENT_INTENSITY;
  } else {
    back.color.setHex(PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.color);
    back.map = null;
    back.metalness = PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.metalness;
    back.metalnessMap = null;
    back.roughness = PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.roughness;
    back.roughnessMap = null;
    back.bumpMap = null;
    back.envMapIntensity = PREVIEW_ALUMI_BACK_MATERIAL_PARAMETERS.envMapIntensity;
  }
  back.needsUpdate = true;
}

export function createPreviewBoardMaterials(
  textures: PreviewTextureSet<Texture>,
  material: PcbMaterial,
  backTextures: PreviewTextureSet<Texture> | null,
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
      bumpMap: textures.height,
      bumpScale: PREVIEW_BUMP_SCALE,
      envMapIntensity: PREVIEW_ENVIRONMENT_INTENSITY,
      transparent: false,
      opacity: 1,
    });
    owned.push(front);
    const side = new MeshStandardMaterial();
    owned.push(side);
    const back = new MeshStandardMaterial({ transparent: false, opacity: 1 });
    owned.push(back);
    configureEdgeAndBackMaterials(side, back, material, backTextures);
    return owned;
  } catch (error) {
    disposeAllSafely(owned.map((ownedMaterial) => () => ownedMaterial.dispose()));
    throw error;
  }
}

function installTextures(front: MeshStandardMaterial, textures: PreviewTextureSet<Texture>): void {
  front.map = textures.baseColor;
  front.metalnessMap = textures.metalness;
  front.roughnessMap = textures.roughness;
  front.bumpMap = textures.height;
  front.needsUpdate = true;
}

export function createPreviewBoardModel(snapshot: PreviewSurfaceSnapshot): PreviewBoardModel {
  let dimensions = Object.freeze({ ...snapshot.physicalDimensions });
  let surfaceRevision = snapshot.surfaceRevision;
  let textures = createPreviewTextureSet(snapshot.maps);
  try {
    let backTextures = snapshot.backMaps
      ? createPreviewTextureSet(snapshot.backMaps, { mirrorX: true })
      : null;
    try {
      const materials = createPreviewBoardMaterials(textures, snapshot.material, backTextures);
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
          get backTextures() {
            return backTextures;
          },
          applySnapshot(nextSnapshot) {
            if (disposed) throw new Error('Preview board model is disposed');
            const replacementTextures = createPreviewTextureSet(nextSnapshot.maps);
            textures = swapPreviewTextureSet(textures, replacementTextures, (replacement) => {
              installTextures(materials[PREVIEW_FRONT_MATERIAL_INDEX], replacement);
            });

            // The edge/back look follows the snapshot's document material, so
            // an fr4 ↔ alumi switch retargets the same owned material slots.
            const side = materials[PREVIEW_SIDE_MATERIAL_INDEX];
            const back = materials[PREVIEW_BACK_MATERIAL_INDEX];
            if (nextSnapshot.backMaps) {
              const replacementBack = createPreviewTextureSet(nextSnapshot.backMaps, {
                mirrorX: true,
              });
              backTextures = swapPreviewTextureSet(backTextures, replacementBack, (replacement) => {
                configureEdgeAndBackMaterials(side, back, nextSnapshot.material, replacement);
              });
            } else {
              configureEdgeAndBackMaterials(side, back, nextSnapshot.material, null);
              const previousBack = backTextures;
              backTextures = null;
              if (previousBack) disposePreviewTextureSet(previousBack);
            }

            const dimensionsChanged = !sameDimensions(dimensions, nextSnapshot.physicalDimensions);
            if (dimensionsChanged) {
              const replacementGeometry = createPreviewBoardGeometry(
                nextSnapshot.physicalDimensions,
              );
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
              () => {
                if (backTextures) disposePreviewTextureSet(backTextures);
              },
            ]);
          },
        };

        return Object.freeze(model);
      } catch (error) {
        disposeAllSafely(materials.map((material) => () => material.dispose()));
        throw error;
      }
    } catch (error) {
      if (backTextures) disposePreviewTextureSet(backTextures);
      throw error;
    }
  } catch (error) {
    disposePreviewTextureSet(textures);
    throw error;
  }
}
