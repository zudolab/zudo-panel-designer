import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MOUSE,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  TOUCH,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  PREVIEW_GOLD_MATERIAL_PARAMETERS,
  createPreviewBoardModel,
  type PreviewBoardModel,
} from './board-model';
import {
  PREVIEW_CAMERA_FAR_MM,
  PREVIEW_CAMERA_NEAR_MM,
  PREVIEW_CAMERA_VERTICAL_FOV_DEGREES,
  calculatePreviewCameraFit,
  clampPreviewCameraDistance,
  type PreviewCameraFit,
} from './camera-fit';
import { resetPreviewOrbitView, setPreviewPrimaryPanMode } from './camera-controls';
import type {
  PreviewCameraControls,
  PreviewDebugSummary,
  PreviewPhysicalDimensions,
  PreviewSurfaceSnapshot,
} from './contracts';
import { createPreviewDebugPublisher } from './debug-state';

const MAX_DEVICE_PIXEL_RATIO = 2;

export interface PreviewSceneRuntime {
  readonly cameraControls: PreviewCameraControls;
  readonly maximumTextureSizePx: number;
  applySnapshot(snapshot: PreviewSurfaceSnapshot): void;
  getDebugSummary(): PreviewDebugSummary;
  dispose(): void;
}

export interface PreviewSceneRuntimeOptions {
  readonly container: HTMLElement;
  readonly dimensions: PreviewPhysicalDimensions;
}

function finiteContainerSize(container: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(container.clientWidth || 1)),
    height: Math.max(1, Math.round(container.clientHeight || 1)),
  };
}

export function createPreviewSceneRuntime({
  container,
  dimensions: initialDimensions,
}: PreviewSceneRuntimeOptions): PreviewSceneRuntime {
  const canvas = document.createElement('canvas');
  const contextAttributes: WebGLContextAttributes = {
    alpha: false,
    antialias: true,
    depth: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false,
  };
  const context = canvas.getContext('webgl2', contextAttributes);
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error('WebGL 2 became unavailable while opening the preview');
  }

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      context: context as unknown as WebGLRenderingContext,
      ...contextAttributes,
    });
  } catch (error) {
    try {
      context.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Constructor failure still owns the canvas even if context loss fails.
    } finally {
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
    }
    throw error;
  }

  const constructionDisposers: Array<() => void> = [];
  const disposeConstruction = (): void => {
    for (const dispose of constructionDisposers.reverse()) {
      try {
        dispose();
      } catch {
        // Preserve the construction error while still attempting every owner.
      }
    }
    constructionDisposers.length = 0;
  };
  constructionDisposers.push(() => {
    renderer.domElement.width = 0;
    renderer.domElement.height = 0;
  });
  constructionDisposers.push(() => renderer.domElement.remove());
  constructionDisposers.push(() => renderer.forceContextLoss());
  constructionDisposers.push(() => renderer.dispose());
  constructionDisposers.push(() => renderer.renderLists.dispose());

  try {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    renderer.domElement.dataset.testid = 'preview-webgl-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.width = '100%';
    container.append(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x171717);
    const camera = new PerspectiveCamera(
      PREVIEW_CAMERA_VERTICAL_FOV_DEGREES,
      1,
      PREVIEW_CAMERA_NEAR_MM,
      PREVIEW_CAMERA_FAR_MM,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    constructionDisposers.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enableZoom = true;
    controls.zoomSpeed = 0.9;
    controls.enablePan = true;
    controls.panSpeed = 0.85;
    controls.enableRotate = true;
    controls.rotateSpeed = 0.75;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = false;
    controls.autoRotate = false;
    controls.mouseButtons.LEFT = MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = MOUSE.PAN;
    controls.touches.ONE = TOUCH.ROTATE;
    controls.touches.TWO = TOUCH.DOLLY_PAN;

    const pmrem = new PMREMGenerator(renderer);
    constructionDisposers.push(() => pmrem.dispose());
    const roomEnvironment = new RoomEnvironment();
    constructionDisposers.push(() => roomEnvironment.dispose());
    let environmentTarget: WebGLRenderTarget | null = pmrem.fromScene(roomEnvironment, 0.04);
    constructionDisposers.push(() => environmentTarget?.dispose());
    scene.environment = environmentTarget.texture;

    const ambientLight = new AmbientLight(0xffffff, 0.25);
    constructionDisposers.push(() => ambientLight.dispose());
    const keyLight = new DirectionalLight(0xfff7e8, 2.1);
    constructionDisposers.push(() => keyLight.dispose());
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 4;
    scene.add(ambientLight, keyLight, keyLight.target);

    let dimensions = Object.freeze({ ...initialDimensions });
    const contactShadowGeometry = new PlaneGeometry(1, 1);
    constructionDisposers.push(() => contactShadowGeometry.dispose());
    const contactShadowMaterial = new ShadowMaterial({ color: 0x000000, opacity: 0.24 });
    constructionDisposers.push(() => contactShadowMaterial.dispose());
    contactShadowMaterial.depthWrite = false;
    const contactShadow = new Mesh(contactShadowGeometry, contactShadowMaterial);
    contactShadow.receiveShadow = true;
    contactShadow.rotation.x = -Math.PI / 2;
    scene.add(contactShadow);

    let board: PreviewBoardModel | null = null;
    let currentSnapshot: PreviewSurfaceSnapshot | null = null;
    let panModeEnabled = false;
    let disposed = false;
    let frameId: number | null = null;
    let fit: PreviewCameraFit;
    const debugPublisher = createPreviewDebugPublisher();
    constructionDisposers.push(() => debugPublisher.clear());

    const publishDebug = (): PreviewDebugSummary => {
      const position = camera.position;
      const target = controls.target;
      const summary: PreviewDebugSummary = {
        sceneInstanceCount: 1,
        activeCanvasCount: 1,
        surfaceRevision: currentSnapshot?.surfaceRevision ?? null,
        physicalDimensions: dimensions,
        camera: {
          position: { x: position.x, y: position.y, z: position.z },
          target: { x: target.x, y: target.y, z: target.z },
          distance: position.distanceTo(target),
          panModeEnabled,
        },
        materialParameters: PREVIEW_GOLD_MATERIAL_PARAMETERS,
      };
      debugPublisher.publish(summary, currentSnapshot);
      return summary;
    };

    const resetView = (): void => {
      resetPreviewOrbitView(camera, controls, fit);
      publishDebug();
    };

    const applyFit = (reset: boolean): void => {
      const size = finiteContainerSize(container);
      fit = calculatePreviewCameraFit(dimensions, size.width / size.height);
      camera.near = fit.near;
      camera.far = fit.far;
      camera.updateProjectionMatrix();
      controls.minDistance = fit.minimumDistance;
      controls.maxDistance = fit.maximumDistance;
      controls.cursor.set(fit.target.x, fit.target.y, fit.target.z);
      controls.minTargetRadius = 0;
      controls.maxTargetRadius = fit.maximumTargetOffset;
      if (reset) {
        resetView();
        return;
      }

      const offset = camera.position.clone().sub(controls.target);
      const distance = clampPreviewCameraDistance(offset.length(), fit);
      if (offset.lengthSq() === 0) {
        offset.set(fit.resetDirection.x, fit.resetDirection.y, fit.resetDirection.z);
      }
      offset.setLength(distance);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    };

    const updatePhysicalScene = (reset: boolean): void => {
      const radius = Math.hypot(dimensions.widthMm, dimensions.heightMm) / 2;
      const floorSize = radius * 4;
      contactShadow.scale.set(floorSize, floorSize, 1);
      contactShadow.position.set(0, -dimensions.heightMm / 2 - 0.5, 0);
      keyLight.position.set(radius * 0.9, radius * 1.25, radius * 1.5);
      const shadowExtent = radius * 1.5;
      keyLight.shadow.camera.left = -shadowExtent;
      keyLight.shadow.camera.right = shadowExtent;
      keyLight.shadow.camera.top = shadowExtent;
      keyLight.shadow.camera.bottom = -shadowExtent;
      keyLight.shadow.camera.near = 0.1;
      keyLight.shadow.camera.far = radius * 6;
      keyLight.shadow.camera.updateProjectionMatrix();
      applyFit(reset);
    };

    const measure = (): void => {
      if (disposed) return;
      const size = finiteContainerSize(container);
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      applyFit(false);
      publishDebug();
    };

    const cameraControls: PreviewCameraControls = Object.freeze({
      dollyBy(factor: number) {
        if (disposed || !Number.isFinite(factor) || factor <= 0) return;
        const offset = camera.position.clone().sub(controls.target);
        const nextDistance = clampPreviewCameraDistance(offset.length() * factor, fit);
        if (offset.lengthSq() === 0) {
          offset.set(fit.resetDirection.x, fit.resetDirection.y, fit.resetDirection.z);
        }
        offset.setLength(nextDistance);
        camera.position.copy(controls.target).add(offset);
        controls.update();
        publishDebug();
      },
      setPanMode(enabled: boolean) {
        if (disposed) return;
        panModeEnabled = enabled;
        setPreviewPrimaryPanMode(controls, enabled);
        publishDebug();
      },
      resetView() {
        if (!disposed) resetView();
      },
    });

    const handleControlsChange = (): void => {
      if (!disposed) publishDebug();
    };
    controls.addEventListener('change', handleControlsChange);
    constructionDisposers.push(() => controls.removeEventListener('change', handleControlsChange));

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    constructionDisposers.push(() => resizeObserver?.disconnect());
    resizeObserver?.observe(container);
    const initialSize = finiteContainerSize(container);
    renderer.setSize(initialSize.width, initialSize.height, false);
    camera.aspect = initialSize.width / initialSize.height;
    updatePhysicalScene(true);

    const renderFrame = (): void => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderFrame);
    };
    frameId = requestAnimationFrame(renderFrame);
    constructionDisposers.push(() => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    });
    publishDebug();

    const runtime: PreviewSceneRuntime = {
      cameraControls,
      maximumTextureSizePx: renderer.capabilities.maxTextureSize,
      applySnapshot(snapshot) {
        if (disposed) throw new Error('Preview scene runtime is disposed');
        if (
          currentSnapshot !== null &&
          snapshot.surfaceRevision < currentSnapshot.surfaceRevision
        ) {
          return;
        }

        let dimensionsChanged = false;
        if (board) {
          dimensionsChanged = board.applySnapshot(snapshot).dimensionsChanged;
        } else {
          board = createPreviewBoardModel(snapshot);
          scene.add(board.mesh);
          dimensionsChanged =
            dimensions.widthMm !== snapshot.physicalDimensions.widthMm ||
            dimensions.heightMm !== snapshot.physicalDimensions.heightMm ||
            dimensions.thicknessMm !== snapshot.physicalDimensions.thicknessMm;
        }
        const maximumAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        for (const texture of Object.values(board.textures)) texture.anisotropy = maximumAnisotropy;
        currentSnapshot = snapshot;
        if (dimensionsChanged) {
          dimensions = Object.freeze({ ...snapshot.physicalDimensions });
          updatePhysicalScene(true);
        }
        publishDebug();
        renderer.render(scene, camera);
      },
      getDebugSummary: publishDebug,
      dispose() {
        if (disposed) return;
        disposed = true;
        currentSnapshot = null;
        const teardownSteps: Array<() => void> = [
          () => {
            const activeFrame = frameId;
            frameId = null;
            if (activeFrame !== null) cancelAnimationFrame(activeFrame);
          },
          () => resizeObserver?.disconnect(),
          () => controls.removeEventListener('change', handleControlsChange),
          () => controls.dispose(),
          () => {
            const ownedBoard = board;
            board = null;
            ownedBoard?.dispose();
          },
          () => contactShadow.removeFromParent(),
          () => contactShadowGeometry.dispose(),
          () => contactShadowMaterial.dispose(),
          () => keyLight.dispose(),
          () => ambientLight.dispose(),
          () => {
            scene.environment = null;
          },
          () => {
            const ownedEnvironment = environmentTarget;
            environmentTarget = null;
            ownedEnvironment?.dispose();
          },
          () => roomEnvironment.dispose(),
          () => pmrem.dispose(),
          () => scene.clear(),
          () => renderer.renderLists.dispose(),
          () => renderer.dispose(),
          () => renderer.forceContextLoss(),
          () => renderer.domElement.remove(),
          () => {
            renderer.domElement.width = 0;
            renderer.domElement.height = 0;
          },
          () => debugPublisher.clear(),
        ];
        for (const teardown of teardownSteps) {
          try {
            teardown();
          } catch {
            // Cleanup is best-effort per owner so one faulty disposer cannot
            // retain the remaining GPU/context/DOM resources.
          }
        }
      },
    };

    constructionDisposers.length = 0;
    return Object.freeze(runtime);
  } catch (error) {
    disposeConstruction();
    throw error;
  }
}
