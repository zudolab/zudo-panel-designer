// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcbLayerStack } from '@zpd/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { DocState } from '@zpd/core';
import type { PreviewSurfaceSnapshot } from './contracts';
import type { PreviewSceneRuntime } from './scene-runtime';
import type { PreviewSurfaceController } from './surface-controller';
import { PreviewViewerWithDependencies, type PreviewViewerDependencies } from './viewer';

afterEach(cleanup);

const dimensions = { widthMm: 60.6, heightMm: 128.5, thicknessMm: 2.5 };
const doc: DocState = { panelHp: 12, guides: [], layers: createPcbLayerStack() };

function fakeRuntime(events: string[] = []): PreviewSceneRuntime {
  return {
    maximumTextureSizePx: 4096,
    cameraControls: { dollyBy: vi.fn(), setPanMode: vi.fn(), resetView: vi.fn() },
    applySnapshot: vi.fn(),
    getDebugSummary: vi.fn(),
    dispose: vi.fn(() => events.push('runtime:dispose')),
  };
}

function dependencies(overrides: Partial<PreviewViewerDependencies> = {}) {
  const runtime = fakeRuntime();
  const surfaceController: PreviewSurfaceController = {
    update: vi.fn(),
    close: vi.fn(),
  };
  const value: PreviewViewerDependencies = {
    isWebGLAvailable: () => true,
    createRuntime: vi.fn(() => runtime),
    createSurfaceController: vi.fn(() => surfaceController),
    ...overrides,
  };
  return { value, runtime, surfaceController };
}

describe('dynamic preview viewer', () => {
  it('renders the deterministic fallback without constructing a scene when WebGL2 is unavailable', async () => {
    const setup = dependencies({ isWebGLAvailable: () => false });
    const onCameraControlsChange = vi.fn();
    render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={onCameraControlsChange}
        dependencies={setup.value}
      />,
    );

    expect(await screen.findByText('3D preview unavailable')).toBeTruthy();
    expect(screen.getByText(/WebGL 2 is unavailable/)).toBeTruthy();
    expect(setup.value.createRuntime).not.toHaveBeenCalled();
    expect(onCameraControlsChange).toHaveBeenLastCalledWith(null);
  });

  it('transitions from preparing to ready after a complete surface publishes', async () => {
    let ready: ((snapshot: PreviewSurfaceSnapshot) => void) | null = null;
    const setup = dependencies({
      createSurfaceController: vi.fn((options) => {
        ready = options.onReady;
        return { update: vi.fn(), close: vi.fn() };
      }),
    });
    const { container } = render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={vi.fn()}
        dependencies={setup.value}
      />,
    );

    expect(container.firstElementChild?.getAttribute('data-preview-state')).toBe('preparing');
    await act(async () => {
      ready!({} as PreviewSurfaceSnapshot);
      await Promise.resolve();
    });
    expect(container.firstElementChild?.getAttribute('data-preview-state')).toBe('ready');
  });

  it('preserves one scene runtime across surface-only document updates', () => {
    const setup = dependencies();
    const onCameraControlsChange = vi.fn();
    const { rerender } = render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={onCameraControlsChange}
        dependencies={setup.value}
      />,
    );
    const updatedDoc = { ...doc, layers: createPcbLayerStack() };
    rerender(
      <PreviewViewerWithDependencies
        doc={updatedDoc}
        dimensions={dimensions}
        onCameraControlsChange={onCameraControlsChange}
        dependencies={setup.value}
      />,
    );

    expect(setup.value.createRuntime).toHaveBeenCalledOnce();
    expect(setup.surfaceController.update).toHaveBeenCalledWith(updatedDoc);
  });

  it('nulls the camera API before teardown and remains StrictMode-clean', () => {
    const events: string[] = [];
    const runtimes: PreviewSceneRuntime[] = [];
    const setup = dependencies({
      createRuntime: vi.fn(() => {
        const runtime = fakeRuntime(events);
        runtimes.push(runtime);
        return runtime;
      }),
      createSurfaceController: vi.fn(() => ({
        update: vi.fn(),
        close: vi.fn(() => events.push('surface:close')),
      })),
    });
    const onCameraControlsChange = vi.fn((controls) => {
      events.push(controls ? 'camera:ready' : 'camera:null');
    });
    const { unmount } = render(
      <StrictMode>
        <PreviewViewerWithDependencies
          doc={doc}
          dimensions={dimensions}
          onCameraControlsChange={onCameraControlsChange}
          dependencies={setup.value}
        />
      </StrictMode>,
    );
    unmount();

    expect(runtimes).toHaveLength(2);
    for (const runtime of runtimes) expect(runtime.dispose).toHaveBeenCalledOnce();
    for (let index = 0; index < events.length; index += 1) {
      if (events[index] === 'runtime:dispose') {
        expect(events[index - 1]).toBe('camera:null');
      }
    }
  });

  it('continues through camera and renderer cleanup if surface close throws', () => {
    const events: string[] = [];
    const runtime = fakeRuntime(events);
    const setup = dependencies({
      createRuntime: () => runtime,
      createSurfaceController: () => ({
        update: vi.fn(),
        close: () => {
          events.push('surface:close');
          throw new Error('surface close failed');
        },
      }),
    });
    const { unmount } = render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={(controls) =>
          events.push(controls ? 'camera:ready' : 'camera:null')
        }
        dependencies={setup.value}
      />,
    );

    expect(() => unmount()).not.toThrow();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(events.indexOf('surface:close')).toBeLessThan(events.lastIndexOf('camera:null'));
    expect(events.lastIndexOf('camera:null')).toBeLessThan(events.indexOf('runtime:dispose'));
  });

  it('tears down a partially ready runtime and presents an error state on surface failure', async () => {
    let fail: ((error: unknown) => void) | null = null;
    const events: string[] = [];
    const runtime = fakeRuntime(events);
    const setup = dependencies({
      createRuntime: () => runtime,
      createSurfaceController: vi.fn((options) => {
        fail = options.onError;
        return { update: vi.fn(), close: vi.fn(() => events.push('surface:close')) };
      }),
    });
    const onCameraControlsChange = vi.fn((controls) =>
      events.push(controls ? 'camera:ready' : 'camera:null'),
    );
    render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={onCameraControlsChange}
        dependencies={setup.value}
      />,
    );
    await act(async () => {
      fail!(new Error('failed'));
      await Promise.resolve();
    });

    expect(screen.getByText('3D preview unavailable')).toBeTruthy();
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(events.indexOf('camera:null')).toBeLessThan(events.indexOf('runtime:dispose'));
  });

  it('presents a safe error state if scene construction throws', async () => {
    const setup = dependencies({
      createRuntime: () => {
        throw new Error('renderer failed');
      },
    });
    render(
      <PreviewViewerWithDependencies
        doc={doc}
        dimensions={dimensions}
        onCameraControlsChange={vi.fn()}
        dependencies={setup.value}
      />,
    );
    expect(await screen.findByText('3D preview unavailable')).toBeTruthy();
    expect(screen.getByText(/could not prepare/)).toBeTruthy();
  });
});
