// Composer-parity central confirm (#79): cross-feature integration flows for
// the features landed by the Composer Parity epic (#61), asserted through the
// window.__zpdTest bridge. The Google Fonts CDN is intercepted so the suite
// never depends on the network — a canvas-rendered real font is covered by
// the manual visual smoke instead.
import { expect, test } from '@playwright/test';
import { bridge, MOD, openEditor, toScreenPoint } from './helpers';

async function selectAt(page: Parameters<typeof toScreenPoint>[0], mm: { x: number; y: number }) {
  const p = await toScreenPoint(page, mm);
  await page.mouse.click(p.x, p.y);
}

test('@smoke autosave: a nudge survives a full page reload via localStorage restore', async ({
  page,
}) => {
  await openEditor(page);
  const before = (await bridge(page).getMaterialLayer('demo-rect')) as {
    x: number;
  };

  // demo-rect spans x 8..32 / y 14..30 — click inside to select, then nudge
  // right 5 × 0.1mm.
  await selectAt(page, { x: 20, y: 22 });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-rect']);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');

  // Outlive the 500ms autosave debounce before reloading.
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__zpdTest !== undefined);

  const after = (await bridge(page).getMaterialLayer('demo-rect')) as {
    x: number;
  };
  expect(after.x).toBeCloseTo(before.x + 0.5, 5);
});

test('@smoke browser-zoom guard: ctrl+wheel and Cmd/Ctrl+= are prevented outside the canvas', async ({
  page,
}) => {
  await openEditor(page);
  const results = await page.evaluate(() => {
    const aside = document.querySelector('aside') ?? document.body;
    const ctrlWheel = new WheelEvent('wheel', {
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
      deltaY: -100,
    });
    aside.dispatchEvent(ctrlWheel);
    const plainWheel = new WheelEvent('wheel', {
      cancelable: true,
      bubbles: true,
      deltaY: -100,
    });
    aside.dispatchEvent(plainWheel);
    const zoomKey = new KeyboardEvent('keydown', {
      key: '=',
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(zoomKey);
    return {
      ctrlWheel: ctrlWheel.defaultPrevented,
      plainWheel: plainWheel.defaultPrevented,
      zoomKey: zoomKey.defaultPrevented,
    };
  });
  expect(results.ctrlWheel).toBe(true);
  expect(results.plainWheel).toBe(false);
  expect(results.zoomKey).toBe(true);
});

test('@smoke clipboard: a zpd envelope paste inserts fresh-id clones at the 2mm cascade', async ({
  page,
}) => {
  await openEditor(page);
  const before = await bridge(page).getLayerCount();

  await page.evaluate(() => {
    const envelope = {
      app: 'zpd',
      kind: 'layers',
      version: 1,
      layers: [
        {
          id: 'env-rect',
          name: 'Envelope rect',
          type: 'shape',
          shape: 'rect',
          x: 5,
          y: 5,
          width: 10,
          height: 10,
          color: 1,
        },
      ],
    };
    const dt = new DataTransfer();
    dt.setData('text/plain', JSON.stringify(envelope));
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });

  expect(await bridge(page).getLayerCount()).toBe(before + 1);
  const pastedId = await bridge(page).getSelectedId();
  expect(pastedId).not.toBeNull();
  const pasted = (await bridge(page).getMaterialLayer(pastedId!)) as {
    id: string;
    x: number;
    y: number;
    width: number;
  };
  expect(pasted.id).not.toBe('env-rect'); // fresh id, never the envelope's
  expect(pasted.x).toBeCloseTo(7, 5); // 5 + 2mm cascade
  expect(pasted.y).toBeCloseTo(7, 5);
  expect(pasted.width).toBeCloseTo(10, 5);
  // the paste is one undo entry — a single Cmd/Ctrl+Z removes it again
  await page.keyboard.press(`${MOD}+z`);
  expect(await bridge(page).getLayerCount()).toBe(before);
});

test('@smoke align panel: Align Left flushes both selected layers to the shared left edge', async ({
  page,
}) => {
  await openEditor(page);

  // Marquee (4,10)→(56,50) selects demo-rect (x 8..32) + demo-ellipse
  // (x 30..52) — same geometry as editor-select.spec.ts.
  const start = await toScreenPoint(page, { x: 4, y: 10 });
  const end = await toScreenPoint(page, { x: 56, y: 50 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-ellipse', 'demo-rect']);

  await page.getByRole('button', { name: 'Align Left' }).click();

  const rect = (await bridge(page).getMaterialLayer('demo-rect')) as { x: number };
  const ellipse = (await bridge(page).getMaterialLayer('demo-ellipse')) as { x: number };
  expect(rect.x).toBeCloseTo(8, 5);
  expect(ellipse.x).toBeCloseTo(8, 5); // was 30 — flushed to the selection's left edge
});

test('@smoke font explorer: picking a catalog family commits it to the text layer', async ({
  page,
}) => {
  // Deterministic run: never let the explorer reach the real fonts CDN.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await openEditor(page);

  // demo-text ('ZPD', 9mm) sits at x 8 / y 90 — click inside its glyph box.
  await selectAt(page, { x: 12, y: 94 });
  expect(await bridge(page).getSelectedIds()).toEqual(['demo-text']);

  await page.getByRole('button', { name: 'Browse Google Fonts…' }).click();
  await page.getByPlaceholder('Search Google Fonts…').fill('Roboto');
  await page.getByRole('button', { name: 'Use Roboto', exact: true }).click();

  const demoText = await bridge(page).getMaterialLayer('demo-text');
  expect(demoText?.type === 'text' && demoText.fontFamily).toBe('Roboto');
  // dialog closed itself after the pick
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('@smoke import round-trip: a dropped export restores the pre-mutation document', async ({
  page,
}) => {
  await openEditor(page);
  const exported = await bridge(page).serialize();
  const originalRect = (await bridge(page).getMaterialLayer('demo-rect')) as {
    x: number;
  };

  // Mutate: nudge demo-rect 1mm right (Shift = 1mm step).
  await selectAt(page, { x: 20, y: 22 });
  await page.keyboard.press('Shift+ArrowRight');
  const mutated = (await bridge(page).getMaterialLayer('demo-rect')) as {
    x: number;
  };
  expect(mutated.x).toBeCloseTo(originalRect.x + 1, 5);

  // Drop the earlier export back onto the page.
  await page.evaluate((json) => {
    const file = new File([json], 'panel.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    document.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, JSON.stringify(exported));

  // Confirm-gated replace, then the success toast.
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Panel imported')).toBeVisible();

  const restored = (await bridge(page).getMaterialLayer('demo-rect')) as {
    x: number;
  };
  expect(restored.x).toBeCloseTo(originalRect.x, 5);
});

test('@smoke import rejects garbage JSON with a toast and an untouched document', async ({
  page,
}) => {
  await openEditor(page);
  const before = await bridge(page).serialize();

  await page.evaluate(() => {
    const file = new File(['{}'], 'garbage.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    document.dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByText('Could not import panel JSON')).toBeVisible();
  expect(await bridge(page).serialize()).toStrictEqual(before);
});
