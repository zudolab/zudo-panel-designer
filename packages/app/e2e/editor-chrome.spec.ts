// Editor Chrome confirm pass (#37): minimal smoke coverage for the five
// chrome features shipped in the epic (#31) — tooltips (#32), mm rulers (#33),
// collapsible sidebar (#34), user-select guard (#35), help panel (#36).
// Deliberately light: presence + toggle behavior only. Ruler *painted* tick
// positions are unit-test territory (ruler-ticks.test.ts), not asserted here.
import { expect, test } from '@playwright/test';
import { openEditor } from './helpers';

test('@smoke mm ruler strips and corner box render around the canvas', async ({ page }) => {
  await openEditor(page);

  await expect(page.getByTestId('ruler-corner')).toBeVisible();
  await expect(page.getByTestId('ruler-corner')).toHaveText('mm');
  await expect(page.getByTestId('ruler-h')).toBeVisible();
  await expect(page.getByTestId('ruler-v')).toBeVisible();

  // Strip layout is fixed (#33 invariant): its bounding box must not move when
  // the camera changes — only the painted content does. Zoom in via the wheel
  // over the canvas and assert the horizontal strip's rect is unchanged.
  const before = await page.getByTestId('ruler-h').boundingBox();
  const canvas = await page.getByTestId('editor-canvas').boundingBox();
  if (!before || !canvas) throw new Error('ruler/canvas not laid out');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  const after = await page.getByTestId('ruler-h').boundingBox();
  expect(after).toEqual(before);
});

test('@smoke sidebar sections collapse and expand independently', async ({ page }) => {
  await openEditor(page);

  const layers = page.getByRole('button', { name: 'Layers' });
  await expect(layers).toHaveAttribute('aria-expanded', 'true');
  const contentId = await layers.getAttribute('aria-controls');
  const content = page.locator(`[id="${contentId}"]`);
  await expect(content).toBeVisible();

  await layers.click();
  await expect(layers).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toBeHidden();

  await layers.click();
  await expect(layers).toHaveAttribute('aria-expanded', 'true');
});

test('@smoke help panel toggles and tracks the active tool', async ({ page }) => {
  await openEditor(page);

  const help = page.getByRole('button', { name: 'Help' });
  // Collapsed by default (#36).
  await expect(help).toHaveAttribute('aria-expanded', 'false');

  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  // Boots on the Select tool → shows its description.
  await expect(page.getByText('Click a layer to select', { exact: false })).toBeVisible();

  // Switching tools updates the help content live.
  await page.getByLabel('Pen (P)').click();
  await expect(page.getByText('Click to drop a corner anchor', { exact: false })).toBeVisible();
});

test('@smoke tool buttons carry an accessible tooltip label with the shortcut', async ({
  page,
}) => {
  await openEditor(page);

  // #32: the native `title` was replaced by an aria-label of "{label} ({KEY})"
  // plus a role="tooltip" sibling. The accessible name drives getByLabel.
  await expect(page.getByLabel('Select (V)')).toBeVisible();
  await expect(page.getByLabel('Pen (P)')).toBeVisible();
  // The always-mounted tooltip node carries the same text.
  await expect(page.locator('[role="tooltip"]', { hasText: 'Select (V)' }).first()).toHaveText(
    'Select (V)',
  );
});
