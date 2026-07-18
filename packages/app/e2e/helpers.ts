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

export function bridge(page: Page) {
  return {
    getDoc: () => page.evaluate(() => window.__zpdTest!.getDoc()),
    getHistory: () => page.evaluate(() => window.__zpdTest!.getHistory()),
    getLayers: () => page.evaluate(() => window.__zpdTest!.getLayers()),
    getLayerCount: () => page.evaluate(() => window.__zpdTest!.getLayerCount()),
    getPanelHp: () => page.evaluate(() => window.__zpdTest!.getPanelHp()),
    getSelectedId: () => page.evaluate(() => window.__zpdTest!.getSelectedId()),
    getSelectedIds: () => page.evaluate(() => window.__zpdTest!.getSelectedIds()),
    getCamera: () => page.evaluate(() => window.__zpdTest!.getCamera()),
    getTextGeometry: (id: string) =>
      page.evaluate((layerId) => window.__zpdTest!.getTextGeometry(layerId), id),
    serialize: () => page.evaluate(() => window.__zpdTest!.serialize()),
  };
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
