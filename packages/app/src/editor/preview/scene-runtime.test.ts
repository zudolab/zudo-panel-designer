// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;

    constructor(x = 0, y = 0, z = 0) {
      this.set(x, y, z);
    }

    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }

    clone() {
      return new Vector3(this.x, this.y, this.z);
    }

    sub(other: Vector3) {
      this.x -= other.x;
      this.y -= other.y;
      this.z -= other.z;
      return this;
    }

    add(other: Vector3) {
      this.x += other.x;
      this.y += other.y;
      this.z += other.z;
      return this;
    }

    copy(other: Vector3) {
      return this.set(other.x, other.y, other.z);
    }

    lengthSq() {
      return this.x ** 2 + this.y ** 2 + this.z ** 2;
    }

    length() {
      return Math.sqrt(this.lengthSq());
    }

    setLength(length: number) {
      const current = this.length();
      if (current !== 0) {
        const scale = length / current;
        this.x *= scale;
        this.y *= scale;
        this.z *= scale;
      }
      return this;
    }

    distanceTo(other: Vector3) {
      return this.clone().sub(other).length();
    }
  }

  const state = {
    renderers: [] as FakeRenderer[],
    controls: [] as FakeOrbitControls[],
    pmrems: [] as FakePmrem[],
    rooms: [] as FakeRoomEnvironment[],
    geometries: [] as FakeDisposable[],
    materials: [] as FakeDisposable[],
    lights: [] as Array<FakeAmbientLight | FakeDirectionalLight>,
    boards: [] as FakeBoard[],
    resizeObservers: [] as FakeResizeObserver[],
    frameRequests: 0,
    cancelledFrames: [] as number[],
    throwOnFrameRequest: false,
    throwOnGeometryDispose: false,
    contextLosses: 0,
  };

  class FakeDisposable {
    disposeCalls = 0;
    dispose() {
      this.disposeCalls += 1;
    }
  }

  class FakeScene {
    background: unknown = null;
    environment: unknown = null;
    children: unknown[] = [];
    add(...objects: unknown[]) {
      this.children.push(...objects);
    }
    clear() {
      this.children = [];
    }
  }

  class FakePerspectiveCamera {
    position = new Vector3();
    up = new Vector3(0, 1, 0);
    aspect: number;
    near: number;
    far: number;
    projectionUpdates = 0;
    constructor(_fov: number, aspect: number, near: number, far: number) {
      this.aspect = aspect;
      this.near = near;
      this.far = far;
    }
    lookAt() {}
    updateProjectionMatrix() {
      this.projectionUpdates += 1;
    }
  }

  class FakeOrbitControls {
    target = new Vector3();
    cursor = new Vector3();
    enableDamping = false;
    dampingFactor = 0;
    enableZoom = false;
    zoomSpeed = 0;
    enablePan = false;
    panSpeed = 0;
    enableRotate = false;
    rotateSpeed = 0;
    screenSpacePanning = false;
    zoomToCursor = false;
    autoRotate = false;
    mouseButtons: Record<string, number | null | undefined> = {};
    touches: Record<string, number | null | undefined> = {};
    minDistance = 0;
    maxDistance = Infinity;
    minTargetRadius = 0;
    maxTargetRadius = Infinity;
    updateCalls = 0;
    disposeCalls = 0;
    addedListeners = 0;
    removedListeners = 0;
    constructor(
      readonly camera: FakePerspectiveCamera,
      readonly element: HTMLCanvasElement,
    ) {
      state.controls.push(this);
    }
    update() {
      this.updateCalls += 1;
      return false;
    }
    addEventListener() {
      this.addedListeners += 1;
    }
    removeEventListener() {
      this.removedListeners += 1;
    }
    dispose() {
      this.disposeCalls += 1;
    }
  }

  class FakeRenderer {
    readonly domElement: HTMLCanvasElement;
    readonly constructorOptions: Record<string, unknown>;
    outputColorSpace: unknown;
    toneMapping: unknown;
    toneMappingExposure = 0;
    shadowMap = { enabled: false, type: 0 };
    renderLists = { disposeCalls: 0, dispose: () => (this.renderLists.disposeCalls += 1) };
    capabilities = { maxTextureSize: 2048, getMaxAnisotropy: () => 16 };
    disposeCalls = 0;
    forceContextLossCalls = 0;
    renderCalls = 0;
    sizes: Array<[number, number, boolean]> = [];
    pixelRatios: number[] = [];
    constructor(options: Record<string, unknown>) {
      this.constructorOptions = options;
      this.domElement = options.canvas as HTMLCanvasElement;
      state.renderers.push(this);
    }
    setPixelRatio(value: number) {
      this.pixelRatios.push(value);
    }
    setSize(width: number, height: number, updateStyle: boolean) {
      this.sizes.push([width, height, updateStyle]);
    }
    render() {
      this.renderCalls += 1;
    }
    dispose() {
      this.disposeCalls += 1;
    }
    forceContextLoss() {
      this.forceContextLossCalls += 1;
    }
  }

  class FakePmrem extends FakeDisposable {
    target = { texture: {}, disposeCalls: 0, dispose: () => (this.target.disposeCalls += 1) };
    constructor(readonly renderer: FakeRenderer) {
      super();
      state.pmrems.push(this);
    }
    fromScene() {
      return this.target;
    }
  }

  class FakeRoomEnvironment extends FakeDisposable {
    constructor() {
      super();
      state.rooms.push(this);
    }
  }

  class FakeAmbientLight extends FakeDisposable {
    constructor(
      readonly color: number,
      readonly intensity: number,
    ) {
      super();
      state.lights.push(this);
    }
  }

  class FakeDirectionalLight extends FakeDisposable {
    castShadow = false;
    position = new Vector3();
    target = {};
    shadow = {
      mapSize: { set() {} },
      bias: 0,
      normalBias: 0,
      radius: 0,
      camera: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        near: 0,
        far: 0,
        projectionUpdates: 0,
        updateProjectionMatrix() {
          this.projectionUpdates += 1;
        },
      },
    };
    constructor(
      readonly color: number,
      readonly intensity: number,
    ) {
      super();
      state.lights.push(this);
    }
  }

  class FakeMesh {
    receiveShadow = false;
    rotation = { x: 0 };
    scale = new Vector3(1, 1, 1);
    position = new Vector3();
    removeCalls = 0;
    constructor(
      readonly geometry: unknown,
      readonly material: unknown,
    ) {}
    removeFromParent() {
      this.removeCalls += 1;
    }
  }

  class FakePlaneGeometry extends FakeDisposable {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      super();
      state.geometries.push(this);
    }
    override dispose() {
      super.dispose();
      if (state.throwOnGeometryDispose) throw new Error('geometry dispose failed');
    }
  }

  class FakeShadowMaterial extends FakeDisposable {
    depthWrite = true;
    constructor(readonly options: Record<string, unknown>) {
      super();
      state.materials.push(this);
    }
  }

  class FakeBoard {
    mesh = {};
    textures = {
      baseColor: { anisotropy: 0 },
      metalness: { anisotropy: 0 },
      roughness: { anisotropy: 0 },
      height: { anisotropy: 0 },
    };
    dimensions: { widthMm: number; heightMm: number; thicknessMm: number };
    surfaceRevision: number;
    applyCalls = 0;
    disposeCalls = 0;
    constructor(snapshot: {
      surfaceRevision: number;
      physicalDimensions: { widthMm: number; heightMm: number; thicknessMm: number };
    }) {
      this.dimensions = { ...snapshot.physicalDimensions };
      this.surfaceRevision = snapshot.surfaceRevision;
      state.boards.push(this);
    }
    applySnapshot(snapshot: {
      surfaceRevision: number;
      physicalDimensions: { widthMm: number; heightMm: number; thicknessMm: number };
    }) {
      this.applyCalls += 1;
      const dimensionsChanged =
        this.dimensions.widthMm !== snapshot.physicalDimensions.widthMm ||
        this.dimensions.heightMm !== snapshot.physicalDimensions.heightMm ||
        this.dimensions.thicknessMm !== snapshot.physicalDimensions.thicknessMm;
      this.dimensions = { ...snapshot.physicalDimensions };
      this.surfaceRevision = snapshot.surfaceRevision;
      return { dimensionsChanged };
    }
    dispose() {
      this.disposeCalls += 1;
    }
  }

  class FakeResizeObserver {
    observeCalls = 0;
    disconnectCalls = 0;
    constructor(readonly callback: ResizeObserverCallback) {
      state.resizeObservers.push(this);
    }
    observe() {
      this.observeCalls += 1;
    }
    disconnect() {
      this.disconnectCalls += 1;
    }
  }

  const reset = () => {
    state.renderers.length = 0;
    state.controls.length = 0;
    state.pmrems.length = 0;
    state.rooms.length = 0;
    state.geometries.length = 0;
    state.materials.length = 0;
    state.lights.length = 0;
    state.boards.length = 0;
    state.resizeObservers.length = 0;
    state.frameRequests = 0;
    state.cancelledFrames.length = 0;
    state.throwOnFrameRequest = false;
    state.throwOnGeometryDispose = false;
    state.contextLosses = 0;
  };

  return {
    state,
    reset,
    Vector3,
    FakeAmbientLight,
    FakeDirectionalLight,
    FakeMesh,
    FakeOrbitControls,
    FakePerspectiveCamera,
    FakePlaneGeometry,
    FakePmrem,
    FakeRenderer,
    FakeResizeObserver,
    FakeRoomEnvironment,
    FakeScene,
    FakeShadowMaterial,
    FakeBoard,
  };
});

vi.mock('three', () => ({
  ACESFilmicToneMapping: 4,
  AmbientLight: fakes.FakeAmbientLight,
  Color: class Color {
    constructor(readonly value: number) {}
  },
  DirectionalLight: fakes.FakeDirectionalLight,
  Mesh: fakes.FakeMesh,
  MOUSE: { ROTATE: 0, DOLLY: 1, PAN: 2 },
  PCFSoftShadowMap: 2,
  PMREMGenerator: fakes.FakePmrem,
  PerspectiveCamera: fakes.FakePerspectiveCamera,
  PlaneGeometry: fakes.FakePlaneGeometry,
  Scene: fakes.FakeScene,
  ShadowMaterial: fakes.FakeShadowMaterial,
  SRGBColorSpace: 'srgb',
  TOUCH: { ROTATE: 0, PAN: 1, DOLLY_PAN: 2 },
  WebGLRenderer: fakes.FakeRenderer,
}));

vi.mock('three/addons/controls/OrbitControls.js', () => ({
  OrbitControls: fakes.FakeOrbitControls,
}));

vi.mock('three/addons/environments/RoomEnvironment.js', () => ({
  RoomEnvironment: fakes.FakeRoomEnvironment,
}));

vi.mock('./board-model', () => ({
  PREVIEW_GOLD_MATERIAL_PARAMETERS: {
    metalness: 1,
    roughness: 0.24,
    environmentIntensity: 1.35,
    bumpScale: 0.3,
  },
  createPreviewBoardModel: (snapshot: ConstructorParameters<typeof fakes.FakeBoard>[0]) =>
    new fakes.FakeBoard(snapshot),
}));

import { MOUSE, TOUCH } from 'three';
import { createPreviewSurfaceSnapshot, type PreviewCanvasSource } from './contracts';
import { getPreviewDebugSummary } from './debug-state';
import { createPreviewSceneRuntime } from './scene-runtime';

function snapshot(
  surfaceRevision: number,
  dimensions = { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
) {
  const source = { width: 121, height: 257 } as PreviewCanvasSource;
  return createPreviewSurfaceSnapshot({
    surfaceRevision,
    ...dimensions,
    rasterSize: {
      widthPx: 121,
      heightPx: 257,
      effectivePixelsPerMm: Math.min(121 / dimensions.widthMm, 257 / dimensions.heightMm),
    },
    canvases: { baseColor: source, metalness: source, roughness: source, height: source },
  });
}

function container(): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  document.body.append(element);
  return element;
}

beforeEach(() => {
  fakes.reset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (contextId) {
    if (contextId !== 'webgl2') return null;
    return {
      getExtension: () => ({ loseContext: () => (fakes.state.contextLosses += 1) }),
    } as unknown as WebGL2RenderingContext;
  });
  vi.stubGlobal('ResizeObserver', fakes.FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', () => {
    if (fakes.state.throwOnFrameRequest) throw new Error('RAF unavailable');
    fakes.state.frameRequests += 1;
    return fakes.state.frameRequests;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => fakes.state.cancelledFrames.push(id));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('preview scene runtime lifecycle', () => {
  it('owns exactly one scene/canvas and exhaustively tears down every resource', () => {
    const host = container();
    const runtime = createPreviewSceneRuntime({
      container: host,
      dimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
    });
    runtime.applySnapshot(snapshot(1));

    const renderer = fakes.state.renderers[0];
    const controls = fakes.state.controls[0];
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(controls.mouseButtons.MIDDLE).toBe(MOUSE.DOLLY);
    expect(controls.mouseButtons.RIGHT).toBe(MOUSE.PAN);
    expect(controls.touches.ONE).toBe(TOUCH.ROTATE);
    expect(controls.touches.TWO).toBe(TOUCH.DOLLY_PAN);
    expect(renderer.constructorOptions).toMatchObject({
      antialias: true,
      failIfMajorPerformanceCaveat: false,
    });
    expect(renderer.pixelRatios[0]).toBeLessThanOrEqual(2);
    expect(getPreviewDebugSummary()).toMatchObject({
      sceneInstanceCount: 1,
      activeCanvasCount: 1,
      surfaceRevision: 1,
      physicalDimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
      materialParameters: { bumpScale: 0.3 },
    });
    // Every owned texture — including the height/bump map — picks up the
    // renderer-capped anisotropy on snapshot application.
    const boardTextures = Object.values(fakes.state.boards[0].textures);
    expect(boardTextures).toHaveLength(4);
    expect(boardTextures.every((texture) => texture.anisotropy === 8)).toBe(true);

    fakes.state.throwOnGeometryDispose = true;
    expect(() => runtime.dispose()).not.toThrow();
    runtime.dispose();

    expect(fakes.state.cancelledFrames).toEqual([1]);
    expect(fakes.state.resizeObservers[0].disconnectCalls).toBe(1);
    expect(controls.removedListeners).toBe(1);
    expect(controls.disposeCalls).toBe(1);
    expect(fakes.state.boards[0].disposeCalls).toBe(1);
    expect(fakes.state.geometries[0].disposeCalls).toBe(1);
    expect(fakes.state.materials[0].disposeCalls).toBe(1);
    expect(fakes.state.pmrems[0].target.disposeCalls).toBe(1);
    expect(fakes.state.pmrems[0].disposeCalls).toBe(1);
    expect(fakes.state.rooms[0].disposeCalls).toBe(1);
    for (const light of fakes.state.lights) expect(light.disposeCalls).toBe(1);
    expect(renderer.renderLists.disposeCalls).toBe(1);
    expect(renderer.disposeCalls).toBe(1);
    expect(renderer.forceContextLossCalls).toBe(1);
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    expect(renderer.domElement.width).toBe(0);
    expect(renderer.domElement.height).toBe(0);
    expect(getPreviewDebugSummary()).toMatchObject({
      sceneInstanceCount: 0,
      activeCanvasCount: 0,
      surfaceRevision: null,
    });
  });

  it('keeps camera/geometry stable for surface revisions and refits only dimensions', () => {
    const runtime = createPreviewSceneRuntime({
      container: container(),
      dimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
    });
    const controls = fakes.state.controls[0];
    runtime.applySnapshot(snapshot(1));
    const afterInitialUpdate = controls.updateCalls;

    runtime.applySnapshot(snapshot(2));
    expect(fakes.state.boards[0].applyCalls).toBe(1);
    expect(controls.updateCalls).toBe(afterInitialUpdate);

    runtime.applySnapshot(snapshot(3, { widthMm: 80.9, heightMm: 128.5, thicknessMm: 2.5 }));
    expect(controls.updateCalls).toBeGreaterThan(afterInitialUpdate);
    expect(getPreviewDebugSummary().physicalDimensions).toEqual({
      widthMm: 80.9,
      heightMm: 128.5,
      thicknessMm: 2.5,
    });

    const applyCalls = fakes.state.boards[0].applyCalls;
    runtime.applySnapshot(snapshot(2));
    expect(fakes.state.boards[0].applyCalls).toBe(applyCalls);
    runtime.dispose();
  });

  it('failure-atomically disposes fully constructed resources when RAF setup throws', () => {
    const host = container();
    fakes.state.throwOnFrameRequest = true;
    fakes.state.throwOnGeometryDispose = true;

    expect(() =>
      createPreviewSceneRuntime({
        container: host,
        dimensions: { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 },
      }),
    ).toThrow('RAF unavailable');

    const renderer = fakes.state.renderers[0];
    expect(fakes.state.resizeObservers[0].disconnectCalls).toBe(1);
    expect(fakes.state.controls[0].removedListeners).toBe(1);
    expect(fakes.state.controls[0].disposeCalls).toBe(1);
    expect(fakes.state.geometries[0].disposeCalls).toBe(1);
    expect(fakes.state.materials[0].disposeCalls).toBe(1);
    expect(fakes.state.pmrems[0].target.disposeCalls).toBe(1);
    expect(fakes.state.pmrems[0].disposeCalls).toBe(1);
    expect(fakes.state.rooms[0].disposeCalls).toBe(1);
    for (const light of fakes.state.lights) expect(light.disposeCalls).toBe(1);
    expect(renderer.disposeCalls).toBe(1);
    expect(renderer.forceContextLossCalls).toBe(1);
    expect(host.querySelectorAll('canvas')).toHaveLength(0);
    expect(getPreviewDebugSummary()).toMatchObject({
      sceneInstanceCount: 0,
      activeCanvasCount: 0,
    });
  });
});
