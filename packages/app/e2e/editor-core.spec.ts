// Wave 6 (#13) smoke suite — app load, direct-manipulation editing (add +
// drag + undo), panel resize, and the JSON export. Real trusted input only
// (page.mouse / page.keyboard / setInputFiles): synthetic dispatchEvent
// PointerEvents are unreliable against React's event delegation.
import fs from 'node:fs';
import { parsePanelConfig } from '@zpd/core';
import { expect, test } from '@playwright/test';
import { bridge, MOD, openEditor, toScreenPoint } from './helpers';

const CONSOLE_SETTLE_MS = 500;

test('@smoke app loads clean and boots the default document', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await openEditor(page);
  await expect(page.getByTestId('editor-canvas')).toBeVisible();

  // wait-ok: asserting ABSENCE of console errors past first paint — no
  // positive event to poll for, so hold a bounded settle window.
  await page.waitForTimeout(CONSOLE_SETTLE_MS);
  expect(errors).toEqual([]);

  // Editor.tsx boots from createDemoDoc(12) — createDefaultDoc(12) plus
  // fixture layers of every type for dev/QA (see demo-doc.ts) — not a bare
  // createDefaultDoc(12). Assert the piece createDemoDoc derives directly
  // from it: panelHp and the default dot-grid pattern layer stay in place.
  const doc = await bridge(page).getDoc();
  expect(doc.panelHp).toBe(12);
  expect(doc.layers[0]).toMatchObject({
    id: 'layer-default-dot-grid',
    type: 'pattern',
    patternType: 'dot-grid',
    color: 1,
  });
});

test('@smoke add rectangle, drag it, then undo restores its position', async ({ page }) => {
  await openEditor(page);

  await page.getByLabel('Add rectangle').click();
  const rectId = await bridge(page).getSelectedId();
  expect(rectId).not.toBeNull();

  const before = (await bridge(page).getDoc()).layers.find((l) => l.id === rectId);
  if (before?.type !== 'shape') throw new Error('expected a shape layer to be selected');

  const start = await toScreenPoint(page, {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 18, { steps: 8 });
  await page.mouse.up();

  const moved = (await bridge(page).getDoc()).layers.find((l) => l.id === rectId);
  if (moved?.type !== 'shape') throw new Error('rect layer disappeared during drag');
  expect(moved.x).not.toBe(before.x);
  expect(moved.y).not.toBe(before.y);

  await page.keyboard.press(`${MOD}+z`);

  const restored = (await bridge(page).getDoc()).layers.find((l) => l.id === rectId);
  if (restored?.type !== 'shape') throw new Error('rect layer disappeared after undo');
  expect(restored.x).toBe(before.x);
  expect(restored.y).toBe(before.y);
});

test('@smoke switching panel size re-fits the camera', async ({ page }) => {
  await openEditor(page);
  expect(await bridge(page).getPanelHp()).toBe(12);
  const before = await bridge(page).getCamera();

  await page.getByRole('combobox').first().selectOption('20');

  await expect.poll(() => bridge(page).getPanelHp()).toBe(20);
  const after = await bridge(page).getCamera();
  expect(after).not.toEqual(before);
});

test('@smoke download JSON round-trips through parsePanelConfig', async ({ page }) => {
  await openEditor(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTitle('Download panel config JSON').click(),
  ]);

  const filePath = await download.path();
  if (!filePath) throw new Error('download produced no file');
  const downloaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const onScreen = await bridge(page).serialize();
  expect(parsePanelConfig(downloaded)).toEqual(parsePanelConfig(onScreen));
});
