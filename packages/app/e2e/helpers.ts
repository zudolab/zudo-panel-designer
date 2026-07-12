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
    getLayers: () => page.evaluate(() => window.__zpdTest!.getLayers()),
    getLayerCount: () => page.evaluate(() => window.__zpdTest!.getLayerCount()),
    getPanelHp: () => page.evaluate(() => window.__zpdTest!.getPanelHp()),
    getSelectedId: () => page.evaluate(() => window.__zpdTest!.getSelectedId()),
    getCamera: () => page.evaluate(() => window.__zpdTest!.getCamera()),
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
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return {
    x: box.x + mm.x * camera.pxPerMm + camera.offsetX,
    y: box.y + mm.y * camera.pxPerMm + camera.offsetY,
  };
}
