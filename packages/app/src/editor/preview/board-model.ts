import {
  CanvasTexture,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Path,
  SRGBColorSpace,
  Shape,
  type Texture,
} from 'three';
import type { PanelHole, PcbMaterial } from '@zpd/core';
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
  readonly mesh: Mesh<ExtrudeGeometry, MeshStandardMaterial[]>;
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

function samePanelHole(a: PanelHole, b: PanelHole): boolean {
  return (
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.shape === b.shape &&
    a.drillDiameter === b.drillDiameter &&
    a.slotLength === b.slotLength &&
    a.opening.width === b.opening.width &&
    a.opening.length === b.opening.length
  );
}

function samePanelHoles(a: readonly PanelHole[], b: readonly PanelHole[]): boolean {
  return a.length === b.length && a.every((hole, index) => samePanelHole(hole, b[index]));
}

// Arc flattening resolution for the drilled hole loops: each absarc becomes
// this many segments, keeping a 3.2mm barrel visually round at preview scale.
export const PREVIEW_HOLE_CURVE_SEGMENTS = 32;

// Builds the panel outline in centered model coordinates (+x right, +y up)
// with one hole loop per catalog entry: circles for round holes, stadiums for
// slots (overall length = slotLength, so the flat routed span is
// slotLength − drillDiameter, long axis horizontal). Catalog coordinates are
// canonical fabrication mm — top-left origin, +y down — hence the cy flip.
export function createPreviewBoardShape(
  dimensions: PreviewPhysicalDimensions,
  holes: readonly PanelHole[],
): Shape {
  const halfWidth = dimensions.widthMm / 2;
  const halfHeight = dimensions.heightMm / 2;
  const shape = new Shape();
  shape.moveTo(-halfWidth, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.lineTo(halfWidth, halfHeight);
  shape.lineTo(-halfWidth, halfHeight);
  shape.closePath();

  for (const hole of holes) {
    const cx = hole.cx - halfWidth;
    const cy = halfHeight - hole.cy;
    const radius = hole.drillDiameter / 2;
    const loop = new Path();
    if (hole.shape === 'round') {
      loop.absarc(cx, cy, radius, 0, Math.PI * 2, false);
    } else {
      const halfSpan = Math.max(
        0,
        ((hole.slotLength ?? hole.drillDiameter) - hole.drillDiameter) / 2,
      );
      loop.absarc(cx + halfSpan, cy, radius, -Math.PI / 2, Math.PI / 2, false);
      loop.absarc(cx - halfSpan, cy, radius, Math.PI / 2, (3 * Math.PI) / 2, false);
      loop.closePath();
    }
    shape.holes.push(loop);
  }
  return shape;
}

// The extrusion is non-indexed with per-face normals, so a triangle's first
// vertex normal classifies its material slot: +z lid → front, −z lid → back,
// anything else → side. Hole barrels are walls, so they take the side
// material — bare metal on alumi, gold on FR-4 (the plated PTH barrel, epic
// decision 11).
function faceMaterialIndexAt(
  normal: { getZ(index: number): number },
  triangle: number,
): number {
  const nz = normal.getZ(triangle * 3);
  if (nz > 0.5) return PREVIEW_FRONT_MATERIAL_INDEX;
  if (nz < -0.5) return PREVIEW_BACK_MATERIAL_INDEX;
  return PREVIEW_SIDE_MATERIAL_INDEX;
}

function assignFaceMaterialGroups(geometry: ExtrudeGeometry): void {
  const normal = geometry.getAttribute('normal');
  const triangleCount = normal.count / 3;
  geometry.clearGroups();
  let runStart = 0;
  let runMaterialIndex = faceMaterialIndexAt(normal, 0);
  for (let triangle = 1; triangle < triangleCount; triangle += 1) {
    const materialIndex = faceMaterialIndexAt(normal, triangle);
    if (materialIndex === runMaterialIndex) continue;
    geometry.addGroup(runStart * 3, (triangle - runStart) * 3, runMaterialIndex);
    runStart = triangle;
    runMaterialIndex = materialIndex;
  }
  geometry.addGroup(runStart * 3, (triangleCount - runStart) * 3, runMaterialIndex);
}

// Re-derives both lids' UVs from the model-space rectangle so the orientation
// contract survives the extrusion (ExtrudeGeometry's generator emits raw mm
// UVs): the front face keeps documentTopLeftUv (0, 1) and the back face
// (1, 1), which PREVIEW_BACK_TEXTURE_MIRROR's sampling transform maps back
// onto the canonically painted canvases (contracts.ts). Wall UVs stay as
// generated — the side material is untextured.
function regenerateFaceUvs(
  geometry: ExtrudeGeometry,
  dimensions: PreviewPhysicalDimensions,
): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const nz = normal.getZ(vertex);
    if (Math.abs(nz) <= 0.5) continue;
    const u = position.getX(vertex) / dimensions.widthMm + 0.5;
    const v = position.getY(vertex) / dimensions.heightMm + 0.5;
    uv.setXY(vertex, nz > 0 ? u : 1 - u, v);
  }
}

export function createPreviewBoardGeometry(
  dimensions: PreviewPhysicalDimensions,
  holes: readonly PanelHole[],
): ExtrudeGeometry {
  const geometry = new ExtrudeGeometry(createPreviewBoardShape(dimensions, holes), {
    depth: dimensions.thicknessMm,
    bevelEnabled: false,
    curveSegments: PREVIEW_HOLE_CURVE_SEGMENTS,
  });
  geometry.translate(0, 0, -dimensions.thicknessMm / 2);
  assignFaceMaterialGroups(geometry);
  regenerateFaceUvs(geometry, dimensions);
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
  let holes = snapshot.holes;
  let surfaceRevision = snapshot.surfaceRevision;
  let textures = createPreviewTextureSet(snapshot.maps);
  try {
    let backTextures = snapshot.backMaps
      ? createPreviewTextureSet(snapshot.backMaps, { mirrorX: true })
      : null;
    try {
      const materials = createPreviewBoardMaterials(textures, snapshot.material, backTextures);
      try {
        const geometry = createPreviewBoardGeometry(dimensions, holes);
        let mesh: Mesh<ExtrudeGeometry, MeshStandardMaterial[]>;
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
            // Both dims and holes derive from (format, hp), so they normally
            // change together — comparing the hole list too keeps the cut
            // honest if a hole-catalog revision ever moves holes at an
            // unchanged panel size. dimensionsChanged alone stays the camera
            // refit signal.
            if (dimensionsChanged || !samePanelHoles(holes, nextSnapshot.holes)) {
              const replacementGeometry = createPreviewBoardGeometry(
                nextSnapshot.physicalDimensions,
                nextSnapshot.holes,
              );
              const previousGeometry = mesh.geometry;
              mesh.geometry = replacementGeometry;
              disposeAllSafely([() => previousGeometry.dispose()]);
              dimensions = Object.freeze({ ...nextSnapshot.physicalDimensions });
              holes = nextSnapshot.holes;
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
