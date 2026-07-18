// Wave 6 (#13) smoke suite — the pen and text tools. Real trusted input only
// (page.mouse / page.keyboard): synthetic dispatchEvent PointerEvents are
// unreliable against React's event delegation.
import { expect, test } from '@playwright/test';
import { bridge, openEditor, toScreenPoint } from './helpers';

const CONSOLE_SETTLE_MS = 500;

test('@smoke pen tool draws a closed path', async ({ page }) => {
  await openEditor(page);
  const before = await bridge(page).getLayerCount();

  await page.keyboard.press('p');

  const anchors = [
    { x: 10, y: 10 },
    { x: 30, y: 12 },
    { x: 20, y: 30 },
  ];
  for (const mm of anchors) {
    const screen = await toScreenPoint(page, mm);
    await page.mouse.click(screen.x, screen.y);
  }
  await page.getByRole('button', { name: '⬠ Close path' }).click();

  await expect.poll(() => bridge(page).getLayerCount()).toBe(before + 1);
  const selectedId = await bridge(page).getSelectedId();
  const layer = (await bridge(page).getDoc()).layers.find((l) => l.id === selectedId);
  expect(layer).toMatchObject({ type: 'path', closed: true });
});

test('pen tool rapid reactivation keeps one hint root and reports no browser errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await openEditor(page);
  const hintRoots = page.locator('[data-pen-hint-root]');

  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('p');
    await page.keyboard.press('v');
    await page.keyboard.press('p');
    await expect(hintRoots).toHaveCount(1);
    await page.keyboard.press('v');
    await expect(hintRoots).toHaveCount(0);
  }

  await page.keyboard.press('p');
  await expect(hintRoots).toHaveCount(1);
  // wait-ok: the assertion is the absence of delayed React cleanup errors,
  // so allow every queued retirement to finish before reading the listener.
  await page.waitForTimeout(CONSOLE_SETTLE_MS);
  expect(errors).toEqual([]);
});

test('@smoke text tool places a layer and loads the Orbitron font', async ({ page }) => {
  await openEditor(page);

  await page.keyboard.press('t');
  const target = await toScreenPoint(page, { x: 20, y: 60 });
  await page.mouse.click(target.x, target.y);

  const selectedId = await bridge(page).getSelectedId();
  expect(selectedId).not.toBeNull();
  const placed = (await bridge(page).getDoc()).layers.find((l) => l.id === selectedId);
  expect(placed?.type).toBe('text');

  // Font <select> is the last <select> once a text layer's inspector is
  // showing — the panel-size <select> in the Panel section is always first.
  await page.getByRole('combobox').last().selectOption('Orbitron');

  // self-hosted @fontsource/orbitron — no external font network involved.
  await page.waitForFunction(() => document.fonts.check('16px "Orbitron"'));

  const updated = (await bridge(page).getDoc()).layers.find((l) => l.id === selectedId);
  expect(updated).toMatchObject({ fontFamily: 'Orbitron' });
});
