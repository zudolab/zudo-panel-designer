// Wave 4 (#143) of the SVG Vector Import epic (#137) -- the epic's CENTRAL
// heavy-verification pass. Every earlier sub-issue kept its own acceptance
// criteria cheap and deferred real end-to-end proof to this file.
//
// Why this suite matters more than usual: this repo's pinned jsdom (27.4.0)
// implements FileReader but not Blob.arrayBuffer()/text(), which
// classifyImportFile (svg-import/classify-file.ts) depends on. Every jsdom
// component/unit test that touches drop/picker/paste therefore MOCKS
// classification (route-import-file.test.ts, use-clipboard.test.ts,
// add-image.test.ts) -- this file is the only place real classification runs
// end to end, through a real Chromium DOM, exactly as a user's drop/pick/
// paste would.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { PathLayer } from '@zpd/core';
import { bridge, captureUnexpectedPageErrors, MOD, openEditor } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXDIR = path.join(__dirname, 'fixtures');

const ICON_MULTICOLOR_PATH = path.join(FIXDIR, 'icon-multicolor.svg');
const ICON_MULTICOLOR = fs.readFileSync(ICON_MULTICOLOR_PATH, 'utf-8');
const GRADIENT_FALLBACK = fs.readFileSync(path.join(FIXDIR, 'gradient-fallback.svg'), 'utf-8');
const INKSCAPE_MM = fs.readFileSync(path.join(FIXDIR, 'inkscape-mm.svg'), 'utf-8');
const MISLEADING_SVG_PATH = path.join(FIXDIR, 'misleading.svg');

// A builder-cap fixture (build-path-layers.ts's MAX_LAYERS = 300) is
// generated rather than committed -- one rect per layer, all the same color
// so it stays well under the safety gate's MAX_ELEMENTS (5,000) and
// extract-shapes.ts's MAX_COLORS (24), and only ever exercises the layer cap.
function manyShapesSvg(count: number): string {
  const rects = Array.from(
    { length: count },
    (_, i) => `<rect x="${i}" y="0" width="0.5" height="0.5" fill="#ff0000"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} 1">${rects}</svg>`;
}

const SVG_IMPORT_DIALOG = { name: 'Import SVG' } as const;

function importDialog(page: Page) {
  return page.getByRole('dialog', SVG_IMPORT_DIALOG);
}

// Real trusted DataTransfer + DragEvent (Chromium, not jsdom -- File.text()/
// arrayBuffer() both work here), same technique as
// editor-composer-parity.spec.ts's drop tests.
async function dropTextFile(
  page: Page,
  fileName: string,
  contents: string,
  mimeType: string,
): Promise<void> {
  await page.evaluate(
    ({ fileName, contents, mimeType }) => {
      const file = new File([contents], fileName, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      document.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    },
    { fileName, contents, mimeType },
  );
}

// Real File item on a paste DataTransfer -- exercises use-clipboard.ts's
// priority-1 (file) branch, the same dispatch path drop and the picker use.
async function pasteTextFile(
  page: Page,
  fileName: string,
  contents: string,
  mimeType: string,
): Promise<void> {
  await page.evaluate(
    ({ fileName, contents, mimeType }) => {
      const file = new File([contents], fileName, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    { fileName, contents, mimeType },
  );
}

// add-image.ts creates a detached <input type=file> and calls .click() on it
// -- Chromium still raises a real filechooser for that (same technique as
// editor-dialogs.spec.ts).
async function pickFile(page: Page, fixturePath: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByLabel('Add image…').click(),
  ]);
  await chooser.setFiles(fixturePath);
}

async function importFromDialog(page: Page, expectedShapeCount: number): Promise<void> {
  const dialog = importDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`${expectedShapeCount} editable shapes`)).toBeVisible();
  await dialog
    .getByRole('button', { name: `Import ${expectedShapeCount} shape${expectedShapeCount === 1 ? '' : 's'}` })
    .click();
  await expect(dialog).toBeHidden();
}

function pathLayer(doc: Awaited<ReturnType<ReturnType<typeof bridge>['getDoc']>>, name: string) {
  const layer = doc.layers.find((l) => l.name === name);
  if (!layer || layer.type !== 'path') throw new Error(`expected a path layer named "${name}"`);
  return layer as PathLayer;
}

test.describe('SVG vector import -- drop', () => {
  test('@smoke multi-color icon imports as selected path layers; one undo removes the whole import, redo restores it', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('icon.svg')).toBeVisible();
    // 4 source colors -> 4 mapping rows: donut, rect, circle, stroked path.
    await expect(dialog.locator('[data-testid="color-mapping-list"] > div')).toHaveCount(4);

    await importFromDialog(page, 4);

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 4);
    const selectedIds = await bridge(page).getSelectedIds();
    expect(selectedIds).toHaveLength(4);

    const doc = await bridge(page).getDoc();
    const newLayers = doc.layers.filter((l) => selectedIds.includes(l.id));
    expect(newLayers.every((l) => l.type === 'path')).toBe(true);

    const donut = pathLayer(doc, 'donut');
    expect(donut.extraSubpaths).toHaveLength(1); // the hole
    expect(selectedIds).toContain(donut.id);

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(() => bridge(page).getLayerCount()).toBe(before);

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 4);
    const redoDoc = await bridge(page).getDoc();
    expect(pathLayer(redoDoc, 'donut').extraSubpaths).toHaveLength(1);
  });

  test('@smoke a file with no extension and no MIME type that content-sniffs as SVG still reaches the dialog (#141 gap)', async ({
    page,
  }) => {
    // import.ts's isImportableImageFile gate used to reject a file that
    // claims neither an image/* MIME nor a .svg extension before
    // routeImportFile ever got a chance to content-sniff it -- fixed as part
    // of this integration pass (see import.ts). Same fixture text, no name
    // extension and an empty MIME, so this exercises exactly that gate.
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'no-extension-icon', ICON_MULTICOLOR, '');

    await expect(importDialog(page)).toBeVisible();
    await importFromDialog(page, 4);
    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 4);
  });

  test('@smoke unsupported gradient fill falls back to a raster image import', async ({ page }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'gradient.svg', GRADIENT_FALLBACK, 'image/svg+xml');
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Import as image instead' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Import \d+ shapes?$/ })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Import as image instead' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
    const doc = await bridge(page).getDoc();
    expect(doc.layers[doc.layers.length - 1]?.type).toBe('image');
  });

  test('@smoke exceeding the 300-layer builder cap falls back to a raster image import', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'many-shapes.svg', manyShapesSvg(301), 'image/svg+xml');
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    // Scoped to the summary paragraph -- the same text also appears in the
    // (collapsed) diagnostics list below it.
    await expect(dialog.getByText(/exceeding the 300 import limit/).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Import \d+ shapes?$/ })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Import as image instead' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
    const doc = await bridge(page).getDoc();
    expect(doc.layers[doc.layers.length - 1]?.type).toBe('image');
  });

  test('@smoke a misleading .svg (PNG bytes renamed) imports directly as an image, no dialog', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    // Binary PNG bytes -- picked (not dropped) so the raw file bytes go
    // straight through Playwright's filechooser instead of being serialized
    // into page.evaluate() as a JS string.
    await pickFile(page, MISLEADING_SVG_PATH);

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const doc = await bridge(page).getDoc();
    expect(doc.layers[doc.layers.length - 1]?.type).toBe('image');
    await expect(page.getByText('Raster content in .svg file — imported as image.')).toBeVisible();
  });

  test('@smoke Inkscape-style width="128mm" + a valid viewBox imports as vectors', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'inkscape.svg', INKSCAPE_MM, 'image/svg+xml');
    await expect(importDialog(page)).toBeVisible();
    await importFromDialog(page, 1);

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
    const doc = await bridge(page).getDoc();
    expect(doc.layers[doc.layers.length - 1]?.type).toBe('path');
  });
});

test.describe('SVG vector import -- picker and clipboard-paste reach the same dialog', () => {
  test('@smoke the file-picker (Add image…) reaches the same import dialog', async ({ page }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await pickFile(page, ICON_MULTICOLOR_PATH);

    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('4 editable shapes')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Cancel must leave the document untouched.
    expect(await bridge(page).getLayerCount()).toBe(before);
  });

  test('@smoke a clipboard-pasted SVG file reaches the same import dialog and imports', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await pasteTextFile(page, 'pasted.svg', ICON_MULTICOLOR, 'image/svg+xml');

    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('pasted.svg')).toBeVisible();
    await importFromDialog(page, 4);

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 4);
  });
});

test.describe('SVG vector import -- color remap', () => {
  test('@smoke remapping a color before import carries through to the imported layer', async ({
    page,
  }) => {
    await openEditor(page);
    const before = await bridge(page).getLayerCount();

    await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();

    // accent-circle's source fill is #0000ff -- force its mapping to a
    // different palette index than whatever nearestPaletteIndex seeded, so
    // this genuinely proves the edit round-trips rather than coincidentally
    // matching the default.
    const select = dialog.getByLabel('color for #0000ff');
    const seeded = Number(await select.inputValue());
    const remapped = (seeded + 1) % 3;
    await select.selectOption(String(remapped));

    await importFromDialog(page, 4);

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 4);
    const doc = await bridge(page).getDoc();
    expect(pathLayer(doc, 'accent-circle').fill).toBe(remapped);
  });
});

test.describe('SVG vector import -- persistence', () => {
  test('@smoke imported path layers survive save/reload', async ({ page }) => {
    await openEditor(page);
    await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
    await importFromDialog(page, 4);

    const beforeSerialize = await bridge(page).serialize();

    // Outlive the 500ms autosave debounce (use-autosave.ts) before reloading.
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForFunction(() => window.__zpdTest !== undefined);

    const afterSerialize = await bridge(page).serialize();
    expect(afterSerialize).toEqual(beforeSerialize);
    const donut = afterSerialize.layers.find((l) => l.name === 'donut');
    expect(donut?.type === 'path' && donut.extraSubpaths).toHaveLength(1);
  });

  test('@smoke an imported compound path survives copy/paste duplication', async ({ page }) => {
    await openEditor(page);
    await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
    await importFromDialog(page, 4);

    await page.getByRole('button', { name: 'Select layer donut' }).click();
    const originalDonut = pathLayer(await bridge(page).getDoc(), 'donut');
    expect(await bridge(page).getSelectedId()).toBe(originalDonut.id);

    await page.keyboard.press(`${MOD}+c`);
    const before = await bridge(page).getLayerCount();
    // A trusted-shaped paste with no OS clipboard payload -- exercises the
    // internal same-session clipboard use-clipboard.ts's real handleCopy
    // (above) just populated (its priority-3 fallback), without depending on
    // this sandbox actually having clipboard-write/read permission granted.
    await page.evaluate(() => {
      window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
    });

    await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
    const doc = await bridge(page).getDoc();
    const pasted = doc.layers.find((l) => l.name === 'donut' && l.id !== originalDonut.id) as
      | PathLayer
      | undefined;
    expect(pasted).toBeDefined();
    expect(pasted?.extraSubpaths).toHaveLength(1);
    expect(pasted?.fill).toBe(originalDonut.fill);
  });

  test('@smoke the 3D preview opens without error with imported layers present', async ({ page }) => {
    const errors = captureUnexpectedPageErrors(page);
    await openEditor(page);
    await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
    await importFromDialog(page, 4);

    await page.getByRole('button', { name: 'Preview 3D' }).click();
    const previewDialog = page.getByRole('dialog', { name: '3D PCB preview' });
    await expect(previewDialog).toBeVisible();
    // The 3D preview paints imported PathLayers through the same paint path
    // as every other layer type -- reaching the ready state without an error
    // is the whole assertion here (preview-3d.spec.ts owns the deep pixel
    // verification of that shared paint path).
    await expect(page.locator('[data-preview-state="ready"]')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Close 3D preview' }).click();
    await expect(previewDialog).toHaveCount(0);

    // wait-ok: asserting absence of late renderer/teardown errors, no
    // positive event to poll for (same pattern as preview-3d.spec.ts).
    await page.waitForTimeout(250);
    expect(errors).toEqual([]);
  });
});

test('@smoke SVG import: screenshot of the editor after the main import journey', async ({
  page,
}) => {
  await openEditor(page);
  await dropTextFile(page, 'icon.svg', ICON_MULTICOLOR, 'image/svg+xml');
  await importFromDialog(page, 4);
  await expect.poll(async () => (await bridge(page).getSelectedIds()).length).toBe(4);

  await page.screenshot({
    path: path.join(__dirname, '..', 'test-results', 'svg-import-main-journey.png'),
  });
});
