// Wave 6 (#13) smoke suite — the two dialog-driven content flows: image
// import + trace-to-vector, and the pattern picker. Real trusted input only:
// setInputFiles via a real filechooser, real clicks — no dispatchEvent.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { bridge, openEditor } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'tiny.png');

test('@smoke image import + trace-to-vector produces path layers', async ({ page }) => {
  await openEditor(page);

  // add-image.ts creates a detached <input type=file> and calls .click() on
  // it — Chromium still raises a real filechooser for that, so this needs no
  // access to the (non-existent, in-DOM) input element.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByLabel('Add image…').click(),
  ]);
  await chooser.setFiles(FIXTURE_PNG);

  // decoding the dropped file + probing its dimensions is async
  await expect.poll(() => bridge(page).getSelectedId()).not.toBeNull();
  const imageId = (await bridge(page).getSelectedId()) as string;
  const before = await bridge(page).getMaterialLayer(imageId);
  expect(before?.type).toBe('image');

  await page.getByRole('button', { name: 'Convert to vector…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const applyButton = page.getByRole('button', { name: 'Apply' });
  await expect(applyButton).toBeEnabled({ timeout: 15_000 });
  await applyButton.click();
  await expect(dialog).toBeHidden();

  const layers = await bridge(page).getMaterialLayers();
  expect(layers.find((l) => l.id === imageId)?.hidden).toBe(true);
  expect(layers.filter((l) => l.type === 'path').length).toBeGreaterThan(0);
});

test('@smoke pattern picker adds a new pattern layer', async ({ page }) => {
  await openEditor(page);
  const before = await bridge(page).getLayerCount();

  await page.getByLabel('Add pattern…').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Diagonal Stripes' }).click();

  await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
  const selectedId = await bridge(page).getSelectedId();
  const layer = await bridge(page).getMaterialLayer(selectedId!);
  expect(layer).toMatchObject({ type: 'pattern', patternType: 'diag-stripes' });
});
