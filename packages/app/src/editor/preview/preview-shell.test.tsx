// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocState } from '@zpd/core';
import type { PreviewCameraControls, PreviewPhysicalDimensions } from './contracts';
import {
  LazyPreviewViewer,
  PreviewCameraControlGroup,
  PreviewRendererUnavailable,
  PreviewShell,
} from './preview-shell';
import type { PreviewViewerModule, PreviewViewerProps } from './viewer-types';

afterEach(cleanup);

const dimensions: PreviewPhysicalDimensions = {
  widthMm: 60.6,
  heightMm: 128.5,
  thicknessMm: 2.5,
};
const doc: DocState = { panelHp: 12, guides: [], layers: [] };

function deferredViewerModule() {
  let resolve!: (module: PreviewViewerModule) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<PreviewViewerModule>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cameraApi(): PreviewCameraControls {
  return {
    dollyBy: vi.fn(),
    setPanMode: vi.fn(),
    resetView: vi.fn(),
  };
}

describe('PreviewCameraControlGroup', () => {
  it('names and disables every 44px keyboard-visible control until an API is ready', () => {
    render(<PreviewCameraControlGroup controls={null} />);

    expect(screen.getByRole('group', { name: '3D preview camera controls' })).toBeTruthy();
    const buttons = [
      screen.getByRole('button', { name: 'Zoom in 3D preview' }),
      screen.getByRole('button', { name: 'Zoom out 3D preview' }),
      screen.getByRole('button', { name: 'Pan 3D preview' }),
      screen.getByRole('button', { name: 'Reset 3D preview view' }),
    ];

    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
      expect(button.className).toContain('focus-visible:outline-2');
      expect(button.className).toContain('[@media(hover:hover)]:hover:');
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }
  });

  it('dispatches exact dolly factors and Reset to the ready API', () => {
    const controls = cameraApi();
    render(<PreviewCameraControlGroup controls={controls} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in 3D preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out 3D preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset 3D preview view' }));

    expect(controls.dollyBy).toHaveBeenNthCalledWith(1, 0.8);
    expect(controls.dollyBy).toHaveBeenNthCalledWith(2, 1.25);
    expect(controls.resetView).toHaveBeenCalledTimes(1);
  });

  it('retains Pan state and reapplies it when the camera API is replaced', async () => {
    const first = cameraApi();
    const { rerender } = render(<PreviewCameraControlGroup controls={first} />);
    const pan = screen.getByRole('button', { name: 'Pan 3D preview' });

    await waitFor(() => expect(first.setPanMode).toHaveBeenCalledWith(false));
    vi.mocked(first.setPanMode).mockClear();
    fireEvent.click(pan);

    expect(pan.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(first.setPanMode).toHaveBeenCalledWith(true));

    const replacement = cameraApi();
    rerender(<PreviewCameraControlGroup controls={replacement} />);
    await waitFor(() => expect(replacement.setPanMode).toHaveBeenCalledWith(true));
    expect(
      screen.getByRole('button', { name: 'Pan 3D preview' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

describe('PreviewShell', () => {
  it('shows a safe loading shell, manufacturing summary, full instructions, and shrink-safe stage', () => {
    const deferred = deferredViewerModule();
    render(
      <PreviewShell
        doc={doc}
        dimensions={dimensions}
        close={vi.fn()}
        loadViewer={() => deferred.promise}
      />,
    );

    expect(screen.getByText('Loading 3D preview…')).toBeTruthy();
    expect(screen.getByText(/60\.6 mm wide by 128\.5 mm high by 2\.5 mm thick/)).toBeTruthy();
    expect(screen.getByText(/exposed gold is metallic/i)).toBeTruthy();
    const instructions = screen.getByText(/Drag to rotate/).textContent ?? '';
    expect(instructions).toContain('wheel, pinch, or plus and minus');
    expect(instructions).toContain('One-finger touch rotates by default');

    const stage = screen.getByRole('region', { name: '3D PCB preview stage' });
    expect(stage.className).toContain('touch-none');
    expect(stage.className).toContain('min-w-0');
    expect(stage.className).not.toContain('pb-32');
    expect(stage.getAttribute('aria-describedby')).toContain('preview-3d-summary');
    expect(screen.getByRole('group', { name: '3D preview camera controls' }).className).toContain(
      'max-w-[calc(100%-1.5rem)]',
    );
  });

  it('hands the current document and physical dimensions to the loaded viewer', async () => {
    const seen: PreviewViewerProps[] = [];
    function ReadyViewer(props: PreviewViewerProps) {
      seen.push(props);
      return <div>Renderer ready</div>;
    }

    render(
      <LazyPreviewViewer
        doc={doc}
        dimensions={dimensions}
        loadViewer={() => Promise.resolve({ default: ReadyViewer })}
        onCameraControlsChange={vi.fn()}
      />,
    );

    expect(await screen.findByText('Renderer ready')).toBeTruthy();
    expect(seen.at(-1)?.doc).toBe(doc);
    expect(seen.at(-1)?.dimensions).toBe(dimensions);
  });

  it('presents a non-crashing chunk failure and can retry the same boundary', async () => {
    const loadViewer = vi
      .fn<() => Promise<PreviewViewerModule>>()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ default: () => <div>Retry succeeded</div> });

    render(
      <PreviewShell doc={doc} dimensions={dimensions} close={vi.fn()} loadViewer={loadViewer} />,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load the 3D preview',
    );
    expect(screen.getByRole('alert').textContent).toContain('Your panel is safe');
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(await screen.findByText('Retry succeeded')).toBeTruthy();
    expect(loadViewer).toHaveBeenCalledTimes(2);
  });

  it('provides the deterministic renderer/WebGL-unavailable presentation', async () => {
    render(
      <PreviewShell
        doc={doc}
        dimensions={dimensions}
        close={vi.fn()}
        loadViewer={() =>
          Promise.resolve({
            default: () => (
              <PreviewRendererUnavailable detail="WebGL is unavailable on this device." />
            ),
          })
        }
      />,
    );

    expect(await screen.findByText('3D preview unavailable')).toBeTruthy();
    expect(screen.getByText('WebGL is unavailable on this device.')).toBeTruthy();
    expect(screen.getByText(/Your panel remains unchanged/)).toBeTruthy();
  });

  it('ignores a stale dynamic completion after unmount', async () => {
    const deferred = deferredViewerModule();
    const Viewer = vi.fn(() => <div>stale renderer</div>);
    const { unmount } = render(
      <PreviewShell
        doc={doc}
        dimensions={dimensions}
        close={vi.fn()}
        loadViewer={() => deferred.promise}
      />,
    );

    unmount();
    await act(async () => deferred.resolve({ default: Viewer }));
    expect(Viewer).not.toHaveBeenCalled();
  });
});

describe('eager import boundary', () => {
  it('reaches the eventual renderer only through the dynamic shim and has no Three.js import', () => {
    const directory = resolve(process.cwd(), 'packages/app/src/editor/preview');
    const shellSource = readFileSync(`${directory}/preview-shell.tsx`, 'utf8');
    const loaderSource = readFileSync(`${directory}/load-viewer.ts`, 'utf8');
    const dialogSource = readFileSync(
      resolve(process.cwd(), 'packages/app/src/editor/dialogs/preview-3d.tsx'),
      'utf8',
    );
    const eagerSources = `${shellSource}\n${loaderSource}\n${dialogSource}`;

    expect(shellSource).not.toMatch(/from\s+['"]\.\/viewer['"]/);
    expect(dialogSource).not.toMatch(/from\s+['"].*\/viewer['"]/);
    expect(loaderSource).toMatch(/return import\(['"]\.\/viewer['"]\)/);
    expect(eagerSources).not.toMatch(/from\s+['"]three(?:\/|['"])/);
  });
});
