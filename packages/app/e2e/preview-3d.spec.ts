// Production-build confirmation for the manufactured PCB preview. Every
// state change uses trusted editor input; the window bridge is observation
// only. Assertions target geometry/state/material pixels rather than treating
// a screenshot as the oracle.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { PreviewDebugSummary } from '../src/editor/preview/contracts';
import {
  bridge,
  captureUnexpectedPageErrors,
  importPanelJson,
  openEditor,
  openPreviewFromCommandPalette,
} from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUFACTURING_FIXTURE = path.join(__dirname, 'fixtures', 'preview-manufacturing.json');
const FIXTURE_WIDTH_MM = 40.3;
const PANEL_HEIGHT_MM = 128.5;
const PANEL_THICKNESS_MM = 2.5;
const VIEWER_CHUNK_PATTERN = /\/assets\/viewer-[^/]+\.js(?:$|\?)/;
const PRESS_START_FONT_PATTERN = /\/assets\/press-start-2p-latin-400-normal-[^/]+\.woff2?(?:$|\?)/;
const ERROR_SETTLE_MS = 250;
const PREVIEW_READY_TIMEOUT_MS = 15_000;

const errorsByPage = new WeakMap<Page, string[]>();
const deferredReleasesByPage = new WeakMap<Page, () => void>();

test.beforeEach(async ({ page }) => {
  errorsByPage.set(page, captureUnexpectedPageErrors(page));
});

test.afterEach(async ({ page }) => {
  deferredReleasesByPage.get(page)?.();
  deferredReleasesByPage.delete(page);
  // wait-ok: this asserts the absence of late renderer/teardown errors; there
  // is no positive event to poll once the preview has already been disposed.
  if (!page.isClosed()) await page.waitForTimeout(ERROR_SETTLE_MS);
  expect(errorsByPage.get(page) ?? []).toEqual([]);
});

async function importManufacturingFixture(page: Page): Promise<void> {
  await importPanelJson(page, MANUFACTURING_FIXTURE);
  await expect.poll(() => bridge(page).getPanelHp()).toBe(8);
  await expect.poll(async () => (await bridge(page).getDoc()).layers.length).toBe(10);
}

async function waitForPreviewReady(page: Page): Promise<PreviewDebugSummary> {
  // Parsing the lazy Three.js chunk can contend with the rest of the fully
  // parallel production suite. Keep the output assertions strict while giving
  // this one heavyweight readiness boundary an explicit budget.
  await expect(page.locator('[data-preview-state="ready"]')).toBeVisible({
    timeout: PREVIEW_READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId('preview-webgl-canvas')).toHaveCount(1);
  await expect.poll(async () => (await bridge(page).getPreview()).sceneInstanceCount).toBe(1);
  const summary = await bridge(page).getPreview();
  expect(summary.activeCanvasCount).toBe(1);
  return summary;
}

async function expectPreviewDisposed(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: '3D PCB preview' })).toHaveCount(0);
  await expect(page.getByTestId('preview-webgl-canvas')).toHaveCount(0);
  await expect
    .poll(async () => {
      const preview = await bridge(page).getPreview();
      return {
        sceneInstanceCount: preview.sceneInstanceCount,
        activeCanvasCount: preview.activeCanvasCount,
        surfaceRevision: preview.surfaceRevision,
      };
    })
    .toEqual({ sceneInstanceCount: 0, activeCanvasCount: 0, surfaceRevision: null });
}

function normalizedPoint(xMm: number, yMm: number, widthMm = FIXTURE_WIDTH_MM) {
  return { x: xMm / widthMm, y: yMm / PANEL_HEIGHT_MM };
}

async function expectSurfacePixel(
  page: Page,
  map: 'baseColor' | 'metalness' | 'roughness',
  xMm: number,
  yMm: number,
  rgba: readonly [number, number, number, number],
  widthMm = FIXTURE_WIDTH_MM,
): Promise<void> {
  const point = normalizedPoint(xMm, yMm, widthMm);
  const sample = await bridge(page).samplePreviewSurface(map, point.x, point.y);
  expect(sample).not.toBeNull();
  expect(sample?.map).toBe(map);
  expect(sample?.rgba).toEqual(rgba);
}

function vectorDistance(
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function cameraMatches(
  actual: PreviewDebugSummary['camera'],
  expected: PreviewDebugSummary['camera'],
  tolerance = 0.0001,
): boolean {
  return (
    vectorDistance(actual.position, expected.position) <= tolerance &&
    vectorDistance(actual.target, expected.target) <= tolerance &&
    Math.abs(actual.distance - expected.distance) <= tolerance
  );
}

async function dragPreview(page: Page, dx: number, dy: number): Promise<void> {
  const canvas = page.getByTestId('preview-webgl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('preview canvas is not laid out');
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.4 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function resourceUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

function consumeExpectedViewerAbortNoise(page: Page): void {
  const errors = errorsByPage.get(page) ?? [];
  const isExpectedNetworkError = (error: string): boolean => {
    const match =
      /^console: Failed to load resource: net::ERR_(?:CONNECTION_FAILED|FAILED) \((.+)\)$/.exec(
        error,
      );
    return match !== null && VIEWER_CHUNK_PATTERN.test(match[1]!);
  };
  const expected = errors.filter(isExpectedNetworkError);
  const unexpected = errors.filter((error) => !isExpectedNetworkError(error));

  // Chromium may emit one console-level resource error for the intentionally
  // aborted chunk. Consume only that exact, bounded message; every other
  // console/page error remains a failure and later-session errors stay armed.
  expect(expected.length).toBeLessThanOrEqual(1);
  expect(unexpected).toEqual([]);
  errors.length = 0;
}

test('@smoke 3D preview is lazy, physically faithful, interactive, and leak-free', async ({
  page,
}) => {
  // This production-build flow imports the full manufacturing corpus, samples
  // all three generated maps, drives every camera mode, and verifies three
  // complete scene mount/dispose cycles. Keep its budget local to this test.
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await openEditor(page);
  await importManufacturingFixture(page);

  // Keep a real selection active: its handles/chrome must never enter the
  // manufactured surface maps.
  await page.getByRole('button', { name: 'Select layer Gold base' }).click();
  expect(await bridge(page).getSelectedId()).toBe('gold-base');

  const editorHistory = await bridge(page).getHistory();
  const editorCamera = await bridge(page).getCamera();
  const resourcesBefore = await resourceUrls(page);
  expect(resourcesBefore.some((url) => VIEWER_CHUNK_PATTERN.test(url))).toBe(false);

  const viewerRequests: string[] = [];
  page.on('request', (request) => {
    if (VIEWER_CHUNK_PATTERN.test(request.url())) viewerRequests.push(request.url());
  });

  const opener = page.getByRole('button', { name: 'Preview 3D' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '3D PCB preview' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => viewerRequests.length).toBe(1);
  const initial = await waitForPreviewReady(page);
  expect(viewerRequests).toHaveLength(1);

  expect(initial).toMatchObject({
    sceneInstanceCount: 1,
    activeCanvasCount: 1,
    surfaceRevision: 1,
    physicalDimensions: {
      widthMm: FIXTURE_WIDTH_MM,
      heightMm: PANEL_HEIGHT_MM,
      thicknessMm: PANEL_THICKNESS_MM,
    },
    materialParameters: {
      metalness: 1,
      roughness: 0.24,
      environmentIntensity: 1.35,
    },
  });
  expect(initial.camera.position.x).toBeGreaterThan(0);
  expect(initial.camera.position.y).toBeGreaterThan(0);
  expect(initial.camera.position.z).toBeGreaterThan(0);
  expect(initial.camera.target).toEqual({ x: 0, y: 0, z: 0 });
  await expect(dialog.getByText(/40\.3 mm wide by 128\.5 mm high by 2\.5 mm thick/)).toBeVisible();

  // Stable interior points prove the document-order material overrides.
  await expectSurfacePixel(page, 'baseColor', 4, 4, [212, 175, 55, 255]);
  await expectSurfacePixel(page, 'metalness', 4, 4, [255, 255, 255, 255]);
  await expectSurfacePixel(page, 'roughness', 4, 4, [61, 61, 61, 255]);
  await expectSurfacePixel(page, 'baseColor', 10, 10, [21, 21, 21, 255]);
  await expectSurfacePixel(page, 'metalness', 10, 10, [0, 0, 0, 255]);
  await expectSurfacePixel(page, 'roughness', 10, 10, [163, 163, 163, 255]);
  await expectSurfacePixel(page, 'baseColor', 14, 14, [242, 240, 233, 255]);
  await expectSurfacePixel(page, 'metalness', 14, 14, [0, 0, 0, 255]);
  await expectSurfacePixel(page, 'roughness', 14, 14, [214, 214, 214, 255]);

  // The real bounded pattern generator paints only alternating interior cells
  // and never spills past its own 12 mm square.
  await expectSurfacePixel(page, 'baseColor', 27, 32, [212, 175, 55, 255]);
  await expectSurfacePixel(page, 'metalness', 27, 32, [255, 255, 255, 255]);
  await expectSurfacePixel(page, 'baseColor', 33, 32, [21, 21, 21, 255]);
  await expectSurfacePixel(page, 'baseColor', 38, 32, [21, 21, 21, 255]);
  await expectSurfacePixel(page, 'baseColor', 4, 40, [212, 175, 55, 255]);
  await expectSurfacePixel(page, 'baseColor', 12, 40, [21, 21, 21, 255]); // even-odd hole
  await expectSurfacePixel(page, 'baseColor', 30, 55, [212, 175, 55, 255]); // rotated ellipse

  // Design-only/hidden/off-panel/editor furniture stays the black substrate.
  await expectSurfacePixel(page, 'baseColor', 24, 94, [21, 21, 21, 255]); // image
  await expectSurfacePixel(page, 'baseColor', 11.5, 111.5, [21, 21, 21, 255]); // hidden
  await expectSurfacePixel(page, 'baseColor', 0.5, 110, [21, 21, 21, 255]); // off-panel
  await expectSurfacePixel(page, 'baseColor', 30, 64, [21, 21, 21, 255]); // guide
  await expectSurfacePixel(page, 'baseColor', 22.75, 4, [21, 21, 21, 255]); // selection chrome

  const zoomIn = page.getByRole('button', { name: 'Zoom in 3D preview' });
  const zoomOut = page.getByRole('button', { name: 'Zoom out 3D preview' });
  const pan = page.getByRole('button', { name: 'Pan 3D preview' });
  const reset = page.getByRole('button', { name: 'Reset 3D preview view' });

  await zoomIn.click();
  await expect
    .poll(async () => (await bridge(page).getPreview()).camera.distance)
    .toBeCloseTo(initial.camera.distance * 0.8, 4);
  await zoomOut.click();
  await expect
    .poll(async () => (await bridge(page).getPreview()).camera.distance)
    .toBeCloseTo(initial.camera.distance, 4);

  const canvasBox = await page.getByTestId('preview-webgl-canvas').boundingBox();
  if (!canvasBox) throw new Error('preview canvas is not visible');
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -500);
  await expect
    .poll(async () =>
      Math.abs((await bridge(page).getPreview()).camera.distance - initial.camera.distance),
    )
    .toBeGreaterThan(1);
  await reset.click();
  await expect
    .poll(async () => cameraMatches((await bridge(page).getPreview()).camera, initial.camera))
    .toBe(true);

  await dragPreview(page, 90, -45);
  await expect
    .poll(async () =>
      vectorDistance((await bridge(page).getPreview()).camera.position, initial.camera.position),
    )
    .toBeGreaterThan(10);
  const rotated = await bridge(page).getPreview();
  expect(vectorDistance(rotated.camera.target, initial.camera.target)).toBeLessThan(0.001);
  expect(rotated.camera.distance).toBeCloseTo(initial.camera.distance, 3);

  await pan.click();
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await bridge(page).getPreview()).camera.panModeEnabled).toBe(true);
  await dragPreview(page, 55, 35);
  await expect
    .poll(async () =>
      vectorDistance((await bridge(page).getPreview()).camera.target, initial.camera.target),
    )
    .toBeGreaterThan(1);

  // Repeated zoom-in attempts must clamp outside the physical board even
  // after the orbit target has moved.
  for (let index = 0; index < 12; index += 1) await zoomIn.click();
  const clamped = await bridge(page).getPreview();
  const radius = Math.hypot(FIXTURE_WIDTH_MM, PANEL_HEIGHT_MM, PANEL_THICKNESS_MM) / 2;
  expect(clamped.camera.distance).toBeGreaterThan(radius);
  expect(
    Math.hypot(clamped.camera.position.x, clamped.camera.position.y, clamped.camera.position.z),
  ).toBeGreaterThan(radius);

  await reset.click();
  await expect
    .poll(async () => cameraMatches((await bridge(page).getPreview()).camera, initial.camera))
    .toBe(true);
  await pan.click();
  await expect(pan).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => (await bridge(page).getPreview()).camera.panModeEnabled)
    .toBe(false);

  expect(await bridge(page).getHistory()).toEqual(editorHistory);
  expect(await bridge(page).getCamera()).toEqual(editorCamera);

  await page.getByRole('button', { name: 'Close 3D preview' }).click();
  await expectPreviewDisposed(page);
  await expect(opener).toBeFocused();

  // Repeated mount/unmount cycles retain exactly one scene/canvas while open
  // and return to the stable zero state after every close.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await opener.click();
    const reopened = await waitForPreviewReady(page);
    expect(reopened.sceneInstanceCount).toBe(1);
    expect(reopened.activeCanvasCount).toBe(1);
    await page.getByRole('button', { name: 'Close 3D preview' }).click();
    await expectPreviewDisposed(page);
  }
});

test('@smoke 3D preview reload recovery restores the panel and starts a fresh renderer session', async ({
  page,
}) => {
  let viewerRequestCount = 0;
  let abortedFirstRequest = false;
  await page.route(VIEWER_CHUNK_PATTERN, async (route) => {
    viewerRequestCount += 1;
    if (!abortedFirstRequest) {
      abortedFirstRequest = true;
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await openEditor(page);
  await importManufacturingFixture(page);
  // Make a trusted last-moment edit without waiting for the debounced autosave.
  // The recovery action itself synchronously persists this exact in-memory
  // document before allowing the page to reload.
  await page.getByRole('combobox', { name: 'Size' }).selectOption('20');
  await expect.poll(() => bridge(page).getPanelHp()).toBe(20);
  const serializedBeforeReload = await bridge(page).serialize();

  await page.getByRole('button', { name: 'Preview 3D' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the 3D preview');
  await expect(alert).toContainText('reload the editor');
  const reload = alert.getByRole('button', { name: 'Save and reload editor' });
  await expect(reload).toBeVisible();
  await expect(reload).toBeEnabled();
  await expect(page.getByTestId('preview-webgl-canvas')).toHaveCount(0);
  await expect
    .poll(async () => {
      const preview = await bridge(page).getPreview();
      return {
        activeCanvasCount: preview.activeCanvasCount,
        sceneInstanceCount: preview.sceneInstanceCount,
      };
    })
    .toEqual({ activeCanvasCount: 0, sceneInstanceCount: 0 });
  expect(abortedFirstRequest).toBe(true);
  expect(viewerRequestCount).toBe(1);
  consumeExpectedViewerAbortNoise(page);

  const mainFrameReload = page.waitForEvent(
    'framenavigated',
    (frame) => frame === page.mainFrame(),
  );
  await reload.click();
  await mainFrameReload;
  await page.waitForFunction(() => window.__zpdTest !== undefined);

  const navigationType = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return navigation.type;
  });
  expect(navigationType).toBe('reload');
  await expect.poll(() => bridge(page).serialize()).toEqual(serializedBeforeReload);
  expect(await bridge(page).getPanelHp()).toBe(20);
  expect((await bridge(page).getDoc()).layers).toHaveLength(10);

  await page.getByRole('button', { name: 'Preview 3D' }).click();
  const ready = await waitForPreviewReady(page);
  expect(viewerRequestCount).toBe(2);
  expect(ready.physicalDimensions).toEqual({
    widthMm: 101.3,
    heightMm: PANEL_HEIGHT_MM,
    thicknessMm: PANEL_THICKNESS_MM,
  });
  await expectSurfacePixel(page, 'baseColor', 4, 4, [212, 175, 55, 255], 101.3);
  await expectSurfacePixel(page, 'metalness', 4, 4, [255, 255, 255, 255], 101.3);

  await page.getByRole('button', { name: 'Close 3D preview' }).click();
  await expectPreviewDisposed(page);
});

test('@smoke 3D preview refreshes font surfaces and reopens on current editor state', async ({
  page,
}) => {
  let fontRequestObserved = false;
  let releaseFontRequest: () => void = () => {};
  const fontRequestGate = new Promise<void>((resolve) => {
    releaseFontRequest = resolve;
  });
  deferredReleasesByPage.set(page, releaseFontRequest);
  await page.route(PRESS_START_FONT_PATTERN, async (route) => {
    if (!fontRequestObserved) {
      fontRequestObserved = true;
      await fontRequestGate;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await openEditor(page);
  await importManufacturingFixture(page);
  await expect.poll(() => fontRequestObserved).toBe(true);

  await page.getByRole('button', { name: 'Preview 3D' }).click();
  const beforeReady = await waitForPreviewReady(page);
  const fingerprintBefore = await bridge(page).fingerprintPreviewSurface('baseColor');
  if (!fingerprintBefore) throw new Error('expected a ready base-color surface fingerprint');

  releaseFontRequest();
  deferredReleasesByPage.delete(page);

  await expect
    .poll(async () => {
      const fingerprint = await bridge(page).fingerprintPreviewSurface('baseColor');
      return fingerprint !== null && fingerprint.hash !== fingerprintBefore.hash;
    })
    .toBe(true);
  const fingerprintAfter = await bridge(page).fingerprintPreviewSurface('baseColor');
  expect(fingerprintAfter).toMatchObject({ surfaceRevision: fingerprintBefore.surfaceRevision });
  expect(fingerprintAfter?.hash).not.toBe(fingerprintBefore.hash);
  const afterReady = await bridge(page).getPreview();
  expect(afterReady.surfaceRevision).toBe(beforeReady.surfaceRevision);
  expect(cameraMatches(afterReady.camera, beforeReady.camera)).toBe(true);

  await page.getByRole('button', { name: 'Close 3D preview' }).click();
  await expectPreviewDisposed(page);

  // Both changes go through real editor controls, then the command palette
  // opens a fresh preview from the latest document.
  await page.getByRole('combobox').first().selectOption('20');
  await expect.poll(() => bridge(page).getPanelHp()).toBe(20);
  await page.getByRole('button', { name: 'Select layer Gold base' }).click();
  await page.getByTitle(/^white — silkscreen$/).click();
  await expect
    .poll(async () =>
      (await bridge(page).getDoc()).layers.find((layer) => layer.id === 'gold-base'),
    )
    .toMatchObject({ color: 2 });

  await openPreviewFromCommandPalette(page);
  const reopened = await waitForPreviewReady(page);
  expect(reopened.physicalDimensions).toEqual({
    widthMm: 101.3,
    heightMm: PANEL_HEIGHT_MM,
    thicknessMm: PANEL_THICKNESS_MM,
  });
  await expectSurfacePixel(page, 'baseColor', 4, 4, [242, 240, 233, 255], 101.3);
  await expectSurfacePixel(page, 'metalness', 4, 4, [0, 0, 0, 255], 101.3);
  await expectSurfacePixel(page, 'roughness', 4, 4, [214, 214, 214, 255], 101.3);

  await page.getByRole('button', { name: 'Close 3D preview' }).click();
  await expectPreviewDisposed(page);
});

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function expectContained(inner: Box, outer: Box, tolerance = 1): void {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - tolerance);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - tolerance);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + tolerance);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + tolerance);
}

function boxesOverlap(left: Box, right: Box): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

async function requiredBox(locator: ReturnType<Page['getByRole']>, name: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} is not laid out`);
  return box;
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const pageBox = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyClientHeight: document.body.clientHeight,
    bodyScrollWidth: document.body.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
    rootClientWidth: document.documentElement.clientWidth,
    rootClientHeight: document.documentElement.clientHeight,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootScrollHeight: document.documentElement.scrollHeight,
  }));
  expect(pageBox.bodyScrollWidth).toBeLessThanOrEqual(pageBox.bodyClientWidth);
  expect(pageBox.bodyScrollHeight).toBeLessThanOrEqual(pageBox.bodyClientHeight);
  expect(pageBox.rootScrollWidth).toBeLessThanOrEqual(pageBox.rootClientWidth);
  expect(pageBox.rootScrollHeight).toBeLessThanOrEqual(pageBox.rootClientHeight);
}

test('@smoke 3D preview controls remain accessible and unclipped across viewports', async ({
  page,
}) => {
  // This flow creates a fresh renderer at three viewport sizes. It is expected
  // to approach the default test budget when the complete suite runs in
  // parallel, so keep the larger budget local to this scenario.
  test.slow();
  await page.setViewportSize({ width: 320, height: 568 });
  await openEditor(page);

  const viewports = [
    { name: 'narrow mobile', width: 320, height: 568 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 900 },
  ] as const;
  const cameraControlNames = [
    'Zoom in 3D preview',
    'Zoom out 3D preview',
    'Pan 3D preview',
    'Reset 3D preview view',
  ] as const;

  for (const [index, viewport] of viewports.entries()) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize(viewport);
      const viewportBox: Box = { x: 0, y: 0, width: viewport.width, height: viewport.height };

      if (index === 0) {
        await expect(page.getByRole('dialog', { name: '3D PCB preview' })).toHaveCount(0);
        const banner = page.getByRole('banner');
        const toolbar = banner.getByRole('toolbar', { name: 'Editor actions' });
        const headerTrigger = banner.getByRole('button', { name: 'Preview 3D' });
        await expect(toolbar).toBeVisible();
        await expect(headerTrigger).toBeVisible();
        await expect(headerTrigger).toBeEnabled();
        const bannerBox = await requiredBox(banner, 'editor header');
        const toolbarBox = await requiredBox(toolbar, 'editor actions');
        const triggerBox = await requiredBox(headerTrigger, 'Preview 3D header trigger');
        expect(triggerBox.width).toBeGreaterThanOrEqual(44);
        expect(triggerBox.height).toBeGreaterThanOrEqual(44);
        expectContained(triggerBox, bannerBox);
        expectContained(triggerBox, toolbarBox);
        expectContained(triggerBox, viewportBox);
        expect(await headerTrigger.evaluate((element) => element.tabIndex)).toBeGreaterThanOrEqual(
          0,
        );
        await headerTrigger.focus();
        await expect(headerTrigger).toBeFocused();
        const focusRing = await headerTrigger.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
            outlineOffset: Number.parseFloat(style.outlineOffset),
          };
        });
        expect(focusRing.outlineStyle).not.toBe('none');
        const focusClearance = focusRing.outlineWidth + focusRing.outlineOffset;
        expect(focusClearance).toBeGreaterThanOrEqual(4);
        expect(triggerBox.x - toolbarBox.x).toBeGreaterThanOrEqual(focusClearance);
        expect(triggerBox.y - toolbarBox.y).toBeGreaterThanOrEqual(focusClearance);
        expect(
          toolbarBox.x + toolbarBox.width - (triggerBox.x + triggerBox.width),
        ).toBeGreaterThanOrEqual(focusClearance);
        expect(
          toolbarBox.y + toolbarBox.height - (triggerBox.y + triggerBox.height),
        ).toBeGreaterThanOrEqual(focusClearance);
        await expectNoPageOverflow(page);
        await headerTrigger.click();
      } else {
        await openPreviewFromCommandPalette(page);
      }

      await waitForPreviewReady(page);
      const dialog = page.getByRole('dialog', { name: '3D PCB preview' });
      const stage = page.getByRole('region', { name: '3D PCB preview stage' });
      const group = page.getByRole('group', { name: '3D preview camera controls' });
      await expect(dialog).toBeVisible();
      await expect(stage).toBeVisible();
      await expect(group).toBeVisible();
      await expect(dialog.getByText(/Drag to rotate/)).toBeVisible();

      const dialogBox = await requiredBox(dialog, 'dialog');
      const stageBox = await requiredBox(stage, 'stage');
      const groupBox = await requiredBox(group, 'camera controls');
      expectContained(dialogBox, viewportBox);
      expectContained(stageBox, dialogBox);
      expectContained(groupBox, stageBox);

      const buttonBoxes: Box[] = [];
      for (const accessibleName of cameraControlNames) {
        const button = page.getByRole('button', { name: accessibleName });
        await expect(button).toBeVisible();
        await expect(button).toBeEnabled();
        const buttonBox = await requiredBox(button, accessibleName);
        expect(buttonBox.width).toBeGreaterThanOrEqual(44);
        expect(buttonBox.height).toBeGreaterThanOrEqual(44);
        expectContained(buttonBox, groupBox);
        expect(await button.evaluate((element) => element.tabIndex)).toBeGreaterThanOrEqual(0);
        await button.focus();
        await expect(button).toBeFocused();
        buttonBoxes.push(buttonBox);
      }

      for (let left = 0; left < buttonBoxes.length; left += 1) {
        for (let right = left + 1; right < buttonBoxes.length; right += 1) {
          expect(boxesOverlap(buttonBoxes[left]!, buttonBoxes[right]!)).toBe(false);
        }
      }

      const close = page.getByRole('button', { name: 'Close 3D preview' });
      const closeBox = await requiredBox(close, 'close button');
      expect(closeBox.width).toBeGreaterThanOrEqual(44);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      expectContained(closeBox, dialogBox);
      expect(await close.evaluate((element) => element.tabIndex)).toBeGreaterThanOrEqual(0);
      await close.focus();
      await expect(close).toBeFocused();

      await expectNoPageOverflow(page);

      await close.click();
      await expectPreviewDisposed(page);
    });
  }
});
