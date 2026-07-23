// Shared helpers for the Wave 6 (#13) smoke suite. Every flow reads state
// through the window.__zpdTest bridge (see src/editor/test-bridge.ts) instead
// of pixel-probing the canvas.
import { type Page } from '@playwright/test';
import type { Camera } from '../src/editor/camera';
import type { ZpdTestBridge } from '../src/editor/test-bridge';

declare global {
  interface Window {
    __zpdTest?: ZpdTestBridge;
  }
}

// Linux/Windows (incl. CI) use Control; macOS local runs use Meta.
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// `?e2e=1` flips on the bridge in the production build the suite runs
// against (playwright.config.ts's webServer runs `vite build` + `vite
// preview`, where import.meta.env.DEV is false — see test-bridge.ts).
export async function openEditor(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => window.__zpdTest !== undefined);
}

// Playwright's locator.dragTo() targets the destination's pre-drag center.
// Layer-list rows add a live drop affordance during dragover, so that shortcut
// can finish without delivering a legal drop to the intended row. Dispatch
// the browser's HTML5 DnD sequence with one shared DataTransfer instead. This
// still exercises the production dragstart/dragover/drop handlers; it never
// writes through the read-only test bridge.
export async function dragLayerRowAfter(
  page: Page,
  sourceName: string,
  targetName: string,
): Promise<void> {
  await page.evaluate(
    ({ sourceName, targetName }) => {
      const rowFor = (name: string): HTMLLIElement => {
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
          (candidate) => candidate.getAttribute('aria-label') === `Select layer ${name}`,
        );
        const row = button?.closest<HTMLLIElement>('li[draggable="true"]');
        if (!row) throw new Error(`draggable layer row not found: ${name}`);
        return row;
      };

      const source = rowFor(sourceName);
      const target = rowFor(targetName);
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
      );

      const rect = target.getBoundingClientRect();
      const position = {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height * 0.75,
      };
      target.dispatchEvent(
        new DragEvent('dragenter', {
          ...position,
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
      const accepted = !target.dispatchEvent(
        new DragEvent('dragover', {
          ...position,
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
      if (!accepted) throw new Error(`layer row rejected drop: ${sourceName} -> ${targetName}`);
      target.dispatchEvent(
        new DragEvent('drop', {
          ...position,
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
      source.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }),
      );
    },
    { sourceName, targetName },
  );
}

export function bridge(page: Page) {
  return {
    getDoc: () => page.evaluate(() => window.__zpdTest!.getDoc()),
    getHistory: () => page.evaluate(() => window.__zpdTest!.getHistory()),
    getLayers: () => page.evaluate(() => window.__zpdTest!.getLayers()),
    getMaterialLayers: () => page.evaluate(() => window.__zpdTest!.getMaterialLayers()),
    getMaterialLayer: (id: string) =>
      page.evaluate((layerId) => window.__zpdTest!.getMaterialLayer(layerId), id),
    // Raw tree structure (#150/#158's primary group-structure assertion
    // surface) — see ZpdTestLayerTreeNode in test-bridge.ts. Distinct from
    // getLayers() (the flat leaf projection) and getLayerCount() (leaf count).
    getLayerTree: () => page.evaluate(() => window.__zpdTest!.getLayerTree()),
    getPcbLayerStack: () => page.evaluate(() => window.__zpdTest!.getPcbLayerStack()),
    getLayerCount: () => page.evaluate(() => window.__zpdTest!.getLayerCount()),
    getPanelHp: () => page.evaluate(() => window.__zpdTest!.getPanelHp()),
    getSelectedId: () => page.evaluate(() => window.__zpdTest!.getSelectedId()),
    getSelectedIds: () => page.evaluate(() => window.__zpdTest!.getSelectedIds()),
    getCamera: () => page.evaluate(() => window.__zpdTest!.getCamera()),
    getPreview: () => page.evaluate(() => window.__zpdTest!.getPreview()),
    fingerprintPreviewSurface: (map: 'baseColor' | 'metalness' | 'roughness') =>
      page.evaluate((mapName) => window.__zpdTest!.fingerprintPreviewSurface(mapName), map),
    samplePreviewSurface: (
      map: 'baseColor' | 'metalness' | 'roughness',
      normalizedX: number,
      normalizedY: number,
    ) =>
      page.evaluate(({ mapName, x, y }) => window.__zpdTest!.samplePreviewSurface(mapName, x, y), {
        mapName: map,
        x: normalizedX,
        y: normalizedY,
      }),
    getTextGeometry: (id: string) =>
      page.evaluate((layerId) => window.__zpdTest!.getTextGeometry(layerId), id),
    serialize: () => page.evaluate(() => window.__zpdTest!.serialize()),
  };
}

export function captureUnexpectedPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const sourceUrl = message.location().url;
    errors.push(`console: ${message.text()}${sourceUrl ? ` (${sourceUrl})` : ''}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  return errors;
}

export async function importPanelJson(page: Page, fixturePath: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTitle('Import panel config JSON').click(),
  ]);
  await chooser.setFiles(fixturePath);
  await page
    .getByRole('dialog', { name: 'Replace current panel?' })
    .getByRole('button', { name: 'Replace', exact: true })
    .click();
}

export async function openPreviewFromCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('Preview 3D');
  await palette.getByRole('option', { name: /Preview 3D/ }).click();
}

// mm -> page-viewport px, via the live camera + the canvas's own client rect —
// the same math Editor.tsx's toPointer() uses to go the other direction.
export async function toScreenPoint(
  page: Page,
  mm: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const camera: Camera | null = await bridge(page).getCamera();
  if (!camera) throw new Error('camera not ready');
  // testid, not bare 'canvas': the ruler strips (#33) added more <canvas>
  // elements, which would multi-match under Playwright strict mode
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return {
    x: box.x + mm.x * camera.pxPerMm + camera.offsetX,
    y: box.y + mm.y * camera.pxPerMm + camera.offsetY,
  };
}

// Reads an axis-aligned block of device pixels from the editor canvas.
// `from`/`to` are page-viewport px corners (the space toScreenPoint returns).
// Region reads exist for PATTERNED content (#97): dot-grid paint has gaps, so
// a single-pixel probe of "is the ghost there?" would be flaky — counting over
// a region that spans at least one pattern pitch is deterministic.
export async function readCanvasRegion(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const canvas = document.querySelector(
        '[data-testid="editor-canvas"]',
      ) as HTMLCanvasElement | null;
      if (!canvas) throw new Error('editor-canvas not found');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round((Math.min(x0, x1) - rect.left) * dpr);
      const py = Math.round((Math.min(y0, y1) - rect.top) * dpr);
      const w = Math.max(1, Math.round(Math.abs(x1 - x0) * dpr));
      const h = Math.max(1, Math.round(Math.abs(y1 - y0) * dpr));
      const img = ctx.getImageData(px, py, w, h);
      return { width: w, height: h, data: Array.from(img.data) };
    },
    { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
  );
}

// Count of pixels in a readCanvasRegion result whose RGB differs from `rgb`
// on any channel by more than `tolerance`. 0 == "the whole region is this
// color (within anti-aliasing noise)"; > 0 == "something else painted here".
export function countPixelsDiffering(
  region: { data: number[] },
  rgb: readonly [number, number, number],
  tolerance: number,
): number {
  let count = 0;
  for (let i = 0; i < region.data.length; i += 4) {
    if (
      Math.abs(region.data[i] - rgb[0]) > tolerance ||
      Math.abs(region.data[i + 1] - rgb[1]) > tolerance ||
      Math.abs(region.data[i + 2] - rgb[2]) > tolerance
    ) {
      count += 1;
    }
  }
  return count;
}
